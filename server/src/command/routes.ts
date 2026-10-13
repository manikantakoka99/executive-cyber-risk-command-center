import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getCompliance } from "../services/catalog.js";
import { assignRole, listUsers } from "./directory.js";
import { actorLabel } from "./personas.js";
import { presentEvidence, presentWorkspace, type ComplianceLive } from "./present.js";
import { hasPermission, isRoleCode, type Permission } from "./rbac.js";
import {
  acceptQueue,
  approveQueue,
  convertScenario,
  deferQueue,
  getState,
  renewAcceptance,
  reopenQueue,
  reviewPack,
  revokeAcceptance,
  saveScenario,
  updateWhatIf,
  verifyFix,
  type ActionResult,
} from "./store.js";

function deny(reply: FastifyReply, permission: Permission, role: string) {
  return reply.code(403).send({
    error: {
      code: "forbidden",
      message: `Role ${role} cannot access ${permission}.`,
    },
  });
}

function requirePermission(req: FastifyRequest, reply: FastifyReply, permission: Permission) {
  if (!hasPermission(req.tenant.role, permission)) {
    deny(reply, permission, req.tenant.role);
    return false;
  }
  return true;
}

async function workspaceFor(req: FastifyRequest) {
  const state = getState(req.tenant.orgId);
  const workspace = presentWorkspace(req.tenant.role, state, req.tenant.orgName);
  if (hasPermission(req.tenant.role, "compliance.read")) {
    workspace.complianceLive = await loadCompliance(req.tenant.orgId);
  }
  return workspace;
}

async function loadCompliance(orgId: string): Promise<ComplianceLive | null> {
  try {
    const data = await getCompliance(orgId);
    return {
      posturePct: data.posturePct,
      frameworks: data.frameworks.map((row) => ({
        name: row.displayName,
        coveragePct: row.coveragePct,
      })),
    };
  } catch {
    return null;
  }
}

function sendAction(reply: FastifyReply, result: ActionResult, workspace: unknown) {
  if (!result.ok) {
    return reply.code(result.status).send({
      error: { code: result.status === 403 ? "forbidden" : "bad_request", message: result.message },
    });
  }
  return { toast: result.toast, workspace };
}

export async function registerCommandRoutes(app: FastifyInstance) {
  app.get("/api/ecc/command/workspace", async (req, reply) => {
    const views = presentWorkspace(req.tenant.role, getState(req.tenant.orgId)).views;
    if (!views.length && !hasPermission(req.tenant.role, "admin.users")) {
      return deny(reply, "command.headline", req.tenant.role);
    }
    if (!views.length) {
      return deny(reply, "command.headline", req.tenant.role);
    }
    return workspaceFor(req);
  });

  app.get("/api/ecc/command/domains/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const evidence = presentEvidence(req.tenant.role, id);
    if (!evidence) {
      return reply.code(403).send({
        error: { code: "forbidden", message: "Evidence is outside this role." },
      });
    }
    return { evidence };
  });

  app.patch("/api/ecc/command/whatif", async (req, reply) => {
    if (!requirePermission(req, reply, "command.whatif")) return;
    const body = z
      .object({
        edr: z.number().optional(),
        siem: z.number().optional(),
        imm: z.number().optional(),
        dr: z.number().optional(),
        cost: z.string().max(12).optional(),
        preset: z.enum(["now", "A", "B", "C"]).nullable().optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: { code: "invalid_body", message: body.error.message } });
    }
    const result = updateWhatIf(req.tenant.orgId, req.tenant.role, body.data);
    return sendAction(reply, result, await workspaceFor(req));
  });

  app.post("/api/ecc/command/whatif/scenarios", async (req, reply) => {
    const result = saveScenario(req.tenant.orgId, req.tenant.role);
    return sendAction(reply, result, await workspaceFor(req));
  });

  app.post("/api/ecc/command/whatif/scenarios/:index/decision", async (req, reply) => {
    const { index } = req.params as { index: string };
    const result = convertScenario(
      req.tenant.orgId,
      req.tenant.role,
      actorLabel(req.tenant.userId, req.tenant.role),
      Number(index),
    );
    return sendAction(reply, result, await workspaceFor(req));
  });

  app.post("/api/ecc/command/queue/:id/approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = approveQueue(req.tenant.orgId, req.tenant.role, actorLabel(req.tenant.userId, req.tenant.role), id);
    return sendAction(reply, result, await workspaceFor(req));
  });

  app.post("/api/ecc/command/queue/:id/defer", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = deferQueue(req.tenant.orgId, req.tenant.role, actorLabel(req.tenant.userId, req.tenant.role), id);
    return sendAction(reply, result, await workspaceFor(req));
  });

  app.post("/api/ecc/command/queue/:id/reopen", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = reopenQueue(req.tenant.orgId, req.tenant.role, actorLabel(req.tenant.userId, req.tenant.role), id);
    return sendAction(reply, result, await workspaceFor(req));
  });

  app.post("/api/ecc/command/queue/:id/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        reason: z.string().min(1).max(500),
        approver: z.enum(["CEO", "CFO", "COO"]),
        days: z.union([z.literal(30), z.literal(90), z.literal(180)]),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: { code: "invalid_body", message: "Reason, approver and expiry are required." } });
    }
    const result = acceptQueue(
      req.tenant.orgId,
      req.tenant.role,
      actorLabel(req.tenant.userId, req.tenant.role),
      id,
      body.data,
    );
    return sendAction(reply, result, await workspaceFor(req));
  });

  app.post("/api/ecc/command/fixes/:id/verify", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = verifyFix(req.tenant.orgId, req.tenant.role, id);
    return sendAction(reply, result, await workspaceFor(req));
  });

  app.post("/api/ecc/command/acceptances/:id/renew", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = renewAcceptance(req.tenant.orgId, req.tenant.role, id);
    return sendAction(reply, result, await workspaceFor(req));
  });

  app.post("/api/ecc/command/acceptances/:id/revoke", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = revokeAcceptance(req.tenant.orgId, req.tenant.role, id);
    return sendAction(reply, result, await workspaceFor(req));
  });

  app.post("/api/ecc/command/pack/review", async (req, reply) => {
    const result = reviewPack(
      req.tenant.orgId,
      req.tenant.role,
      actorLabel(req.tenant.userId, req.tenant.role),
    );
    return sendAction(reply, result, await workspaceFor(req));
  });

  app.get("/api/ecc/admin/users", async (req, reply) => {
    if (!requirePermission(req, reply, "admin.users")) return;
    return { users: await listUsers(req.tenant.orgId) };
  });

  app.patch("/api/ecc/admin/users/:id", async (req, reply) => {
    if (!requirePermission(req, reply, "admin.roles")) return;
    const { id } = req.params as { id: string };
    const body = z.object({ role: z.string() }).safeParse(req.body ?? {});
    if (!body.success || !isRoleCode(body.data.role)) {
      return reply.code(400).send({ error: { code: "invalid_body", message: "A known role code is required." } });
    }
    const ok = await assignRole(id, req.tenant.orgId, body.data.role);
    if (!ok) return reply.code(404).send({ error: { code: "not_found", message: "User not found in this organization." } });
    return { ok: true, users: await listUsers(req.tenant.orgId) };
  });
}
