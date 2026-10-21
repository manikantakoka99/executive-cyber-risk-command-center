import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getCompliance } from "../services/catalog.js";
import { listAccess } from "../auth/service.js";
import { assignRole } from "./directory.js";
import { actorLabel } from "./personas.js";
import {
  approveAppetite,
  approvePolicy,
  editPolicy,
  listPolicyBundle,
  proposeAppetite,
  proposePolicy,
  withdrawPolicy,
} from "./policyStore.js";
import { presentEvidence, presentWorkspace, type ComplianceLive } from "./present.js";
import {
  canAcceptRisk,
  hasPermission,
  isRoleCode,
  redactFinancial,
  type Permission,
} from "./rbac.js";
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
import { getRegister, getRemediation } from "./workspaceExtras.js";

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
  const workspace = presentWorkspace(
    req.tenant.role,
    state,
    req.tenant.orgName,
    req.tenant.orgId,
  );
  if (hasPermission(req.tenant.role, "compliance.read")) {
    workspace.complianceLive = await loadCompliance(req.tenant.orgId);
  }
  // Belt-and-suspenders: never emit AED / loss figures without command.loss.
  return redactFinancial(req.tenant.role, workspace);
}

async function loadCompliance(orgId: string): Promise<ComplianceLive | null> {
  try {
    const data = await getCompliance(orgId);
    return {
      posturePct: data.posturePct,
      frameworks: data.frameworks.map((row) => ({
        name: row.displayName,
        code: row.code,
        coveragePct: row.coveragePct,
      })),
      nist: data.nist,
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
    return { evidence: redactFinancial(req.tenant.role, evidence) };
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
    // Authorization before input validation so unauthorized roles always get 403.
    if (!canAcceptRisk(req.tenant.role) || !hasPermission(req.tenant.role, "command.queue.accept")) {
      return reply.code(403).send({
        error: { code: "forbidden", message: `Role ${req.tenant.role} cannot accept risk.` },
      });
    }
    const { id } = req.params as { id: string };
    const body = z
      .object({
        reason: z.string().min(1).max(500),
        approver: z.enum(["CEO", "CFO", "COO", "Risk Lead"]),
        days: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
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
    return { users: await listAccess(req.tenant.orgId) };
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
    return { ok: true, users: await listAccess(req.tenant.orgId) };
  });

  // ---- Scoring policy & appetite (CISO proposes, Board/CxO approve + lock) ----
  app.get("/api/ecc/policy", async (req, reply) => {
    if (!requirePermission(req, reply, "policy.read")) return;
    return listPolicyBundle(req.tenant.orgId);
  });

  app.post("/api/ecc/policy", async (req, reply) => {
    if (!requirePermission(req, reply, "policy.propose")) return;
    const body = z
      .object({
        notes: z.string().max(2000).optional(),
        unobservedDefault: z.number().min(0).max(100).optional(),
        bandMediumMin: z.number().min(0).max(100).optional(),
        bandHighMin: z.number().min(0).max(100).optional(),
        bandCriticalMin: z.number().min(0).max(100).optional(),
        floorEnabled: z.boolean().optional(),
        floorBand: z.enum(["high", "critical"]).optional(),
        replaceDraft: z.boolean().optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: { code: "invalid_body", message: body.error.message } });
    }
    const result = proposePolicy(req.tenant.orgId, req.tenant.role, {
      userId: req.tenant.userId,
      name: actorLabel(req.tenant.userId, req.tenant.role),
    }, body.data);
    if (!result.ok) {
      return reply.code(result.status).send({
        error: {
          code: result.status === 400 ? "invalid" : "forbidden",
          message: result.message,
        },
      });
    }
    return { ok: true, policy: result.policy, ...listPolicyBundle(req.tenant.orgId) };
  });

  app.delete("/api/ecc/policy/:id", async (req, reply) => {
    if (!requirePermission(req, reply, "policy.propose")) return;
    const { id } = req.params as { id: string };
    const result = withdrawPolicy(
      req.tenant.orgId,
      req.tenant.role,
      { userId: req.tenant.userId, name: actorLabel(req.tenant.userId, req.tenant.role) },
      id,
    );
    if (!result.ok) {
      return reply.code(result.status).send({
        error: {
          code: result.status === 404 ? "not_found" : result.status === 400 ? "invalid" : "forbidden",
          message: result.message,
        },
      });
    }
    return { ok: true, ...listPolicyBundle(req.tenant.orgId) };
  });

  app.patch("/api/ecc/policy/:id", async (req, reply) => {
    if (!requirePermission(req, reply, "policy.propose")) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        notes: z.string().max(2000).optional(),
        unobservedDefault: z.number().min(0).max(100).optional(),
        bandMediumMin: z.number().min(0).max(100).optional(),
        bandHighMin: z.number().min(0).max(100).optional(),
        bandCriticalMin: z.number().min(0).max(100).optional(),
        floorEnabled: z.boolean().optional(),
        floorBand: z.enum(["high", "critical"]).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: { code: "invalid_body", message: body.error.message } });
    }
    const result = editPolicy(
      req.tenant.orgId,
      req.tenant.role,
      { userId: req.tenant.userId, name: actorLabel(req.tenant.userId, req.tenant.role) },
      id,
      body.data,
    );
    if (!result.ok) {
      return reply.code(result.status).send({
        error: {
          code: result.status === 400 ? "immutable" : "forbidden",
          message: result.message,
        },
      });
    }
    return { ok: true, policy: result.policy, ...listPolicyBundle(req.tenant.orgId) };
  });

  app.post("/api/ecc/policy/:id/approve", async (req, reply) => {
    if (!requirePermission(req, reply, "policy.approve")) return;
    const { id } = req.params as { id: string };
    const result = approvePolicy(req.tenant.orgId, req.tenant.role, {
      userId: req.tenant.userId,
      name: actorLabel(req.tenant.userId, req.tenant.role),
    }, id);
    if (!result.ok) {
      const code =
        result.status === 409
          ? "conflict"
          : result.status === 404
            ? "not_found"
            : result.status === 400
              ? "invalid"
              : "forbidden";
      return reply.code(result.status).send({ error: { code, message: result.message } });
    }
    return { ok: true, policy: result.policy, ...listPolicyBundle(req.tenant.orgId) };
  });

  app.get("/api/ecc/appetite", async (req, reply) => {
    if (!requirePermission(req, reply, "policy.read")) return;
    const bundle = listPolicyBundle(req.tenant.orgId);
    return { appetites: bundle.appetites, rules: bundle.rules };
  });

  app.post("/api/ecc/appetite", async (req, reply) => {
    if (!requirePermission(req, reply, "policy.propose")) return;
    const body = z
      .object({
        domainCode: z.string().nullable(),
        maxScore: z.number().min(0).max(100),
        rationale: z.string().max(2000).optional(),
        reviewDate: z.string().optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: { code: "invalid_body", message: body.error.message } });
    }
    const result = proposeAppetite(req.tenant.orgId, req.tenant.role, {
      userId: req.tenant.userId,
      name: actorLabel(req.tenant.userId, req.tenant.role),
    }, body.data);
    if (!result.ok) return reply.code(result.status).send({ error: { code: "forbidden", message: result.message } });
    return { ok: true, appetite: result.appetite, appetites: listPolicyBundle(req.tenant.orgId).appetites };
  });

  app.post("/api/ecc/appetite/:id/approve", async (req, reply) => {
    if (!requirePermission(req, reply, "policy.approve")) return;
    const { id } = req.params as { id: string };
    const result = approveAppetite(req.tenant.orgId, req.tenant.role, {
      userId: req.tenant.userId,
      name: actorLabel(req.tenant.userId, req.tenant.role),
    }, id);
    if (!result.ok) return reply.code(result.status).send({ error: { code: "forbidden", message: result.message } });
    return { ok: true, appetite: result.appetite, appetites: listPolicyBundle(req.tenant.orgId).appetites };
  });

  app.get("/api/ecc/register", async (req, reply) => {
    if (!requirePermission(req, reply, "register.read")) return;
    return getRegister(req.tenant.orgId, req.tenant.role);
  });

  app.get("/api/ecc/remediation", async (req, reply) => {
    if (!requirePermission(req, reply, "remediation.read")) return;
    return getRemediation(req.tenant.orgId, req.tenant.role);
  });
}
