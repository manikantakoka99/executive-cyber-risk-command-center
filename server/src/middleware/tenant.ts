import type { FastifyRequest, FastifyReply } from "fastify";
import { query } from "../db.js";

export type UserRole =
  | "cxo"
  | "board_member"
  | "program_office"
  | "domain_analyst"
  | "auditor";

export interface TenantContext {
  orgId: string;
  userId: string;
  role: UserRole;
  firstName: string;
  lastName: string | null;
  email: string;
  orgName: string;
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

  const { rows } = await query<{
    user_id: string;
    org_id: string;
    role: UserRole;
    first_name: string;
    last_name: string | null;
    email: string;
    org_name: string;
  }>(
    `SELECT u.user_id, u.org_id, u.role, u.first_name, u.last_name, u.email, o.name AS org_name
     FROM users u
     JOIN organizations o ON o.org_id = u.org_id
     WHERE u.user_id = $1 AND u.org_id = $2`,
    [userId, orgId],
  );

  if (!rows[0]) {
    return reply.code(403).send({
      error: {
        code: "forbidden",
        message: "User does not belong to the requested organization.",
      },
    });
  }

  const u = rows[0];
  req.tenant = {
    orgId: u.org_id,
    userId: u.user_id,
    role: u.role,
    firstName: u.first_name,
    lastName: u.last_name,
    email: u.email,
    orgName: u.org_name,
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
