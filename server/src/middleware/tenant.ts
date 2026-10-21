import type { FastifyRequest, FastifyReply } from "fastify";
import { query } from "../db.js";
import { findPersona, orgNameFor, roleOverride } from "../command/personas.js";
import { canonicalRole, type RoleCode } from "../command/rbac.js";
import { setTenantContext } from "../db.js";
import type { Membership } from "../auth/service.js";
import { sessionPrincipal } from "../auth/routes.js";

export type UserRole = RoleCode;

export interface TenantContext {
  orgId: string;
  userId: string;
  role: UserRole;
  firstName: string;
  lastName: string | null;
  email: string;
  orgName: string;
  title?: string;
  accountId?: string;
  memberships?: Membership[];
}

declare module "fastify" {
  interface FastifyRequest {
    tenant: TenantContext;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Header impersonation is local QA only. The product UI uses the session cookie. */
export function demoHeaderAuthEnabled(): boolean {
  return process.env.DEMO_AUTH === "true";
}

export function isPublicEccPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  if (path === "/health") return true;
  // Login, logout, and invite acceptance are public. Any other /auth path
  // (including a signup URL) is also unauthenticated so a missing route is 404.
  // Switching org still requires a session.
  if (path.startsWith("/api/ecc/auth/") && path !== "/api/ecc/auth/switch-org") return true;
  return false;
}

export async function tenantMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const principal = await sessionPrincipal(req.headers.cookie);
  if (req.headers.cookie?.includes("ecc_session=") && !principal) {
    return reply.code(401).send({
      error: { code: "unauthorized", message: "Session expired. Sign in again." },
    });
  }
  if (principal) {
    req.tenant = {
      orgId: principal.orgId,
      userId: principal.userId,
      role: principal.role,
      firstName: principal.firstName,
      lastName: principal.lastName,
      email: principal.email,
      orgName: principal.orgName,
      title: principal.title,
      accountId: principal.accountId,
      memberships: principal.memberships,
    };
    try {
      await setTenantContext(principal.orgId, principal.userId);
    } catch {
      /* pool may be unavailable; app-layer org filters still apply */
    }
    return;
  }

  if (!demoHeaderAuthEnabled()) {
    return reply.code(401).send({
      error: { code: "unauthorized", message: "Sign in required." },
    });
  }

  const orgId = String(req.headers["x-org-id"] ?? "");
  const userId = String(req.headers["x-user-id"] ?? "");

  if (!UUID_RE.test(orgId) || !UUID_RE.test(userId)) {
    return reply.code(401).send({
      error: {
        code: "unauthorized",
        message: "X-Org-Id and X-User-Id headers are required (demo auth).",
      },
    });
  }

  const persona = findPersona(userId);
  let dbUser: {
    user_id: string;
    org_id: string;
    role: string;
    first_name: string;
    last_name: string | null;
    email: string;
    org_name: string;
  } | null = null;
  try {
    const { rows } = await query<{
      user_id: string;
      org_id: string;
      role: string;
      first_name: string;
      last_name: string | null;
      email: string;
      org_name: string;
    }>(
      `SELECT u.user_id, u.org_id,
              COALESCE(v.role_code, 'domain_analyst') AS role,
              u.first_name, u.last_name, u.email, o.name AS org_name
       FROM users u
       JOIN organizations o ON o.org_id = u.org_id
       LEFT JOIN v_user_primary_role v ON v.user_id = u.user_id
       WHERE u.user_id = $1 AND u.org_id = $2`,
      [userId, orgId],
    );
    dbUser = rows[0] ?? null;
  } catch {
    dbUser = null;
  }

  // Cross-tenant: persona or DB user must belong to the requested org.
  if (persona && persona.orgId !== orgId) {
    return reply.code(403).send({
      error: {
        code: "forbidden",
        message: "User does not belong to the requested organization.",
      },
    });
  }
  if (!dbUser && !persona) {
    return reply.code(403).send({
      error: {
        code: "forbidden",
        message: "User does not belong to the requested organization.",
      },
    });
  }
  if (dbUser && dbUser.org_id !== orgId) {
    return reply.code(403).send({
      error: {
        code: "forbidden",
        message: "User does not belong to the requested organization.",
      },
    });
  }

  // Always store a schema role (legacy aliases normalized).
  const roleSource = roleOverride(userId) ?? dbUser?.role ?? persona?.role ?? "domain_analyst";
  const role: UserRole = canonicalRole(roleSource);
  req.tenant = {
    orgId,
    userId,
    role,
    firstName: dbUser?.first_name ?? persona?.firstName ?? "User",
    lastName: dbUser?.last_name ?? persona?.lastName ?? null,
    email: dbUser?.email ?? persona?.email ?? "",
    orgName: dbUser?.org_name ?? (persona ? orgNameFor(persona.orgId) : "Organization"),
    title: persona?.title ?? role,
  };

  // Bind Postgres session for RLS (dwan schema) on subsequent queries in this request.
  try {
    await setTenantContext(orgId, userId);
  } catch {
    /* pool may be unavailable; app-layer org filters still apply */
  }
}

export function requireRoles(...roles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const allowed = new Set(roles.map((r) => canonicalRole(r)));
    if (!allowed.has(canonicalRole(req.tenant.role))) {
      return reply.code(403).send({
        error: {
          code: "forbidden",
          message: `Role ${req.tenant.role} cannot perform this action.`,
        },
      });
    }
  };
}
