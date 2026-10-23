import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { hasPermission, homeFor, isRoleCode, ROLE_LABEL } from "../command/rbac.js";
import {
  clearEmailLoginFailures,
  loginBlocked,
  loginClientIp,
  recordLoginFailure,
} from "./loginThrottle.js";
import {
  acceptInvite,
  accountIdForEmail,
  confirmMfaSetup,
  createInvite,
  disableMfa,
  getMfaStatus,
  login,
  previewInvite,
  principalFromToken,
  readCookie,
  regenerateRecoveryCodes,
  revokeToken,
  sessionCookie,
  SESSION_COOKIE,
  setupMfa,
  switchOrg,
  verifyMfaChallengeAndLogin,
} from "./service.js";

function publicError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post("/api/ecc/auth/login", async (req, reply) => {
    const body = z.object({ email: z.string().min(3).max(200), password: z.string().min(1).max(200) }).safeParse(req.body ?? {});
    const email = body.success ? body.data.email : null;
    const ip = loginClientIp(req.ip, req.headers["x-forwarded-for"]);
    const blocked = loginBlocked(ip, email);
    if (!blocked.ok) {
      reply.header("retry-after", String(blocked.retryAfterSec));
      return publicError(reply, 429, "too_many_requests", "Too many sign-in attempts. Try again later.");
    }
    if (!body.success) {
      recordLoginFailure(ip, null);
      return publicError(reply, 401, "unauthorized", "Wrong email or password.");
    }
    const result = await login(body.data.email, body.data.password);
    if (!result) {
      recordLoginFailure(ip, email);
      return publicError(reply, 401, "unauthorized", "Wrong email or password.");
    }
    clearEmailLoginFailures(email);

    if (result.mfaRequired) {
      return reply.code(200).send({
        mfaRequired: true,
        mfaTicket: result.mfaTicket,
        expiresAt: result.expiresAt,
      });
    }

    reply.header("set-cookie", sessionCookie(result.token));
    return { user: publicUser(result.principal) };
  });

  app.post("/api/ecc/auth/mfa/verify", async (req, reply) => {
    const body = z
      .object({
        mfaTicket: z.string().min(10).max(256),
        code: z.string().min(6).max(64),
      })
      .safeParse(req.body ?? {});

    const ip = loginClientIp(req.ip, req.headers["x-forwarded-for"]);
    const blocked = loginBlocked(ip, null);
    if (!blocked.ok) {
      reply.header("retry-after", String(blocked.retryAfterSec));
      return publicError(reply, 429, "too_many_requests", "Too many verification attempts. Try again later.");
    }

    if (!body.success) {
      recordLoginFailure(ip, null);
      return publicError(reply, 400, "invalid_body", "Valid mfaTicket and verification code are required.");
    }

    const result = await verifyMfaChallengeAndLogin(body.data.mfaTicket, body.data.code);
    if (!result.ok) {
      recordLoginFailure(ip, null);
      return publicError(reply, result.status, result.code, result.message);
    }

    clearEmailLoginFailures(result.principal.email);
    reply.header("set-cookie", sessionCookie(result.token));
    return {
      user: publicUser(result.principal),
      usedRecoveryCode: result.usedRecoveryCode ?? false,
    };
  });

  app.get("/api/ecc/auth/mfa/status", async (req, reply) => {
    if (!req.tenant) return publicError(reply, 401, "unauthorized", "Sign in required.");
    const accountId = req.tenant.accountId ?? (await accountIdForEmail(req.tenant.email));
    if (!accountId) return publicError(reply, 404, "not_found", "Account not found.");
    const status = await getMfaStatus(accountId);
    return status;
  });

  app.post("/api/ecc/auth/mfa/setup", async (req, reply) => {
    if (!req.tenant) return publicError(reply, 401, "unauthorized", "Sign in required.");
    const body = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body ?? {});
    if (!body.success) return publicError(reply, 400, "invalid_body", "Password is required for reauthentication.");

    const accountId = req.tenant.accountId ?? (await accountIdForEmail(req.tenant.email));
    if (!accountId) return publicError(reply, 404, "not_found", "Account not found.");

    try {
      const result = await setupMfa(accountId, body.data.password);
      return result;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 400;
      const message = err instanceof Error ? err.message : "MFA setup failed.";
      return publicError(reply, status, status === 401 ? "unauthorized" : "invalid_body", message);
    }
  });

  app.post("/api/ecc/auth/mfa/confirm-setup", async (req, reply) => {
    if (!req.tenant) return publicError(reply, 401, "unauthorized", "Sign in required.");
    const body = z.object({ code: z.string().min(6).max(64) }).safeParse(req.body ?? {});
    if (!body.success) return publicError(reply, 400, "invalid_body", "A 6-digit verification code is required.");

    const accountId = req.tenant.accountId ?? (await accountIdForEmail(req.tenant.email));
    if (!accountId) return publicError(reply, 404, "not_found", "Account not found.");

    try {
      const result = await confirmMfaSetup(accountId, body.data.code);
      return result;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 400;
      const message = err instanceof Error ? err.message : "MFA confirmation failed.";
      return publicError(reply, status, "invalid_code", message);
    }
  });

  app.post("/api/ecc/auth/mfa/disable", async (req, reply) => {
    if (!req.tenant) return publicError(reply, 401, "unauthorized", "Sign in required.");
    const body = z
      .object({
        password: z.string().min(1).max(200),
        code: z.string().max(64).optional(),
        recoveryCode: z.string().max(64).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) return publicError(reply, 400, "invalid_body", "Password and either TOTP code or recovery code are required.");

    const accountId = req.tenant.accountId ?? (await accountIdForEmail(req.tenant.email));
    if (!accountId) return publicError(reply, 404, "not_found", "Account not found.");

    try {
      const result = await disableMfa(accountId, body.data.password, body.data.code, body.data.recoveryCode);
      return result;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 400;
      const message = err instanceof Error ? err.message : "Failed to disable MFA.";
      return publicError(reply, status, status === 401 ? "unauthorized" : "invalid_code", message);
    }
  });

  app.post("/api/ecc/auth/mfa/regenerate-recovery-codes", async (req, reply) => {
    if (!req.tenant) return publicError(reply, 401, "unauthorized", "Sign in required.");
    const body = z
      .object({
        password: z.string().min(1).max(200),
        code: z.string().min(6).max(64),
      })
      .safeParse(req.body ?? {});
    if (!body.success) return publicError(reply, 400, "invalid_body", "Password and a valid TOTP code are required.");

    const accountId = req.tenant.accountId ?? (await accountIdForEmail(req.tenant.email));
    if (!accountId) return publicError(reply, 404, "not_found", "Account not found.");

    try {
      const result = await regenerateRecoveryCodes(accountId, body.data.password, body.data.code);
      return result;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 400;
      const message = err instanceof Error ? err.message : "Failed to regenerate recovery codes.";
      return publicError(reply, status, status === 401 ? "unauthorized" : "invalid_code", message);
    }
  });

  app.post("/api/ecc/auth/logout", async (req, reply) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) await revokeToken(token);
    reply.header("set-cookie", sessionCookie("", true));
    return { ok: true };
  });

  app.post("/api/ecc/auth/switch-org", async (req, reply) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) return publicError(reply, 401, "unauthorized", "Sign in required.");
    const body = z.object({ orgId: z.string().uuid() }).safeParse(req.body ?? {});
    if (!body.success) return publicError(reply, 400, "invalid_body", "Organization id is required.");
    const principal = await switchOrg(token, body.data.orgId);
    if (!principal) {
      return publicError(reply, 403, "forbidden", "You are not a member of that organization.");
    }
    return { user: publicUser(principal) };
  });

  app.get("/api/ecc/auth/invite/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = await previewInvite(token);
    if (!invite) return publicError(reply, 404, "not_found", "This invite is invalid or has expired.");
    return {
      email: invite.email,
      orgId: invite.orgId,
      orgName: invite.orgName,
      role: invite.role,
      roleLabel: ROLE_LABEL[invite.role],
    };
  });

  app.post("/api/ecc/auth/invite/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const body = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body ?? {});
    if (!body.success) return publicError(reply, 400, "invalid_body", "Use at least 10 characters.");
    const result = await acceptInvite(token, body.data.password);
    if ("error" in result) return publicError(reply, 400, "invalid_body", result.error);
    reply.header("set-cookie", sessionCookie(result.token));
    return { user: publicUser(result.principal) };
  });

  app.post("/api/ecc/admin/invites", async (req, reply) => {
    if (!hasPermission(req.tenant.role, "admin.users")) {
      return publicError(reply, 403, "forbidden", `Role ${req.tenant.role} cannot perform this action.`);
    }
    const body = z
      .object({ email: z.string().min(3).max(200), role: z.string() })
      .safeParse(req.body ?? {});
    if (!body.success || !isRoleCode(body.data.role)) {
      return publicError(reply, 400, "invalid_body", "Email and a known role are required.");
    }
    try {
      const invite = await createInvite({
        orgId: req.tenant.orgId,
        email: body.data.email,
        role: body.data.role,
        invitedBy: req.tenant.userId,
      });
      return {
        email: invite.email,
        role: invite.role,
        roleLabel: ROLE_LABEL[invite.role],
        expiresAt: invite.expiresAt,
        invitePath: `/invite/${invite.token}`,
      };
    } catch (err) {
      const status = (err as { status?: number }).status ?? 400;
      const message = err instanceof Error ? err.message : "Invite failed";
      return publicError(reply, status, status === 409 ? "conflict" : "invalid_body", message);
    }
  });

}

export async function sessionPrincipal(cookieHeader: string | undefined) {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  return principalFromToken(token);
}

function publicUser(principal: {
  userId: string;
  orgId: string;
  orgName: string;
  role: string;
  title?: string;
  firstName: string;
  lastName: string | null;
  email: string;
  memberships: { orgId: string; orgName: string; role: string; userId: string }[];
}) {
  return {
    userId: principal.userId,
    orgId: principal.orgId,
    orgName: principal.orgName,
    role: principal.role,
    title: principal.title ?? principal.role,
    name: `${principal.firstName}${principal.lastName ? ` ${principal.lastName}` : ""}`,
    email: principal.email,
    home: homeFor(principal.role),
    memberships: principal.memberships,
  };
}
