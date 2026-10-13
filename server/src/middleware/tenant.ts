import type { FastifyRequest, FastifyReply } from "fastify";
import { query } from "../db.js";
import { DEMO_ORG_NAME, findPersona, roleOverride } from "../command/personas.js";
import { isRoleCode, type RoleCode } from "../command/rbac.js";

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
}

declare module "fastify" {
  interface FastifyRequest {
    tenant: TenantContext;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function tenantMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
) {
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

  if (!dbUser && (!persona || persona.orgId !== orgId)) {
    return reply.code(403).send({
      error: {
        code: "forbidden",
        message: "User does not belong to the requested organization.",
      },
    });
  }

  const roleSource = roleOverride(userId) ?? dbUser?.role ?? persona?.role ?? "domain_analyst";
  const role: UserRole = isRoleCode(roleSource) ? roleSource : "domain_analyst";
  req.tenant = {
    orgId,
    userId,
    role,
    firstName: dbUser?.first_name ?? persona?.firstName ?? "User",
    lastName: dbUser?.last_name ?? persona?.lastName ?? null,
    email: dbUser?.email ?? persona?.email ?? "",
    orgName: dbUser?.org_name ?? (persona ? DEMO_ORG_NAME : "Organization"),
    title: persona?.title ?? role,
  };
}

export function requireRoles(...roles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(req.tenant.role)) {
      return reply.code(403).send({
        error: {
          code: "forbidden",
          message: `Role ${req.tenant.role} cannot perform this action.`,
        },
      });
    }
  };
}
