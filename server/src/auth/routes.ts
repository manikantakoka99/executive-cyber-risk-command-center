import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { hasPermission, isRoleCode, ROLE_LABEL } from "../command/rbac.js";
import {
  clearEmailLoginFailures,
  loginBlocked,
  loginClientIp,
  recordLoginFailure,
} from "./loginThrottle.js";
import {
  acceptInvite,
  createInvite,
  login,
  previewInvite,
  principalFromToken,
  readCookie,
  revokeToken,
  sessionCookie,
  SESSION_COOKIE,
  switchOrg,
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
    reply.header("set-cookie", sessionCookie(result.token));
    return { user: publicUser(result.principal) };
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
    memberships: principal.memberships,
  };
}
