import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

import { query } from "./db.js";
import { requireRoles, tenantMiddleware } from "./middleware/tenant.js";
import { getOverview } from "./services/overview.js";
import {
  applyDecisionAction,
  getDecision,
  listDecisions,
} from "./services/decisions.js";
import {
  generateReport,
  getActivity,
  getAudit,
  getCompliance,
  getDomain,
  getFinding,
  listDomains,
  listFindings,
  listReports,
} from "./services/catalog.js";
import {
  createConnector,
  getConnector,
  ingestRawEventsForConnector,
  listConnectors,
  listSyncRuns,
  runConnectorSync,
  testConnector,
} from "./services/connectors.js";
import { getSignal, listSignals } from "./services/signals.js";
import {
  correlateReadySignals,
  getScenario,
  listAssessments,
  listScenarios,
  recalculate,
  seedDemoScenarios,
} from "./services/scenarios.js";
import {
  createAction,
  createScenarioDecision,
  getTreatmentPlan,
  listActions,
  listScenarioDecisions,
  patchAction,
  refreshScenarioIntelligence,
  seedClosedLoopDemos,
  submitVerification,
  upsertTreatmentPlan,
} from "./services/closedLoop.js";
import { getScenarioImpact } from "./risk/scenarioImpact.js";
import {
  detectMaterialChanges,
  generateExecutiveReport,
  getBusinessProcessView,
  getBusinessUnitView,
  getCompliancePosture,
  getConnectorCatalog,
  getControlPosture,
  getDecisionCenter,
  getExecutiveBriefing,
  getHotspots,
  getOrgSettings,
  getPortfolio,
  getReportSnapshot,
  getTrends,
  listMaterialChanges,
  listReportSnapshots,
  seedExecutiveIntelligence,
} from "./services/intelligence.js";
import {
  getDemoContext,
  prepareManagerDemo,
  resetDemo,
  seedDemo,
  verifyDemo,
} from "./services/demoMode.js";
import {
  getIngestionTrace,
  getSampleWorkbookResults,
  getSampleWorkbookStatus,
  resetSampleWorkbookIngestion,
  runSampleWorkbookIngestion,
} from "./services/sampleWorkbookIngestion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = path.join(__dirname, "..", "generated");

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(",") ?? true,
});
await app.register(rateLimit, {
  max: 300,
  timeWindow: "1 minute",
});

app.get("/health", async () => ({ ok: true }));

app.get("/api/ecc/organizations", async () => {
  const { rows } = await query(
    `SELECT org_id, name, industry, hq_country FROM organizations ORDER BY name`,
  );
  return {
    organizations: rows.map((o) => ({
      orgId: o.org_id,
      name: o.name,
      industry: o.industry,
      hqCountry: o.hq_country,
    })),
  };
});

app.get("/api/ecc/organizations/:orgId/users", async (req, reply) => {
  const { orgId } = req.params as { orgId: string };
  const { rows } = await query(
    `SELECT u.user_id, u.first_name, u.last_name, u.email,
            COALESCE(v.role_code, 'domain_analyst') AS role
     FROM users u
     LEFT JOIN v_user_primary_role v ON v.user_id = u.user_id
     WHERE u.org_id = $1
     ORDER BY role, u.first_name`,
    [orgId],
  );
  return {
    users: rows.map((u) => ({
      userId: u.user_id,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      role: u.role,
    })),
  };
});

app.addHook("preHandler", async (req, reply) => {
  if (
    req.url === "/health" ||
    req.url.startsWith("/api/ecc/organizations")
  ) {
    return;
  }
  if (!req.url.startsWith("/api/ecc")) return;
  await tenantMiddleware(req, reply);
});

app.get("/api/ecc/me", async (req) => ({
  user: {
    userId: req.tenant.userId,
    orgId: req.tenant.orgId,
    orgName: req.tenant.orgName,
    role: req.tenant.role,
    name: `${req.tenant.firstName}${req.tenant.lastName ? ` ${req.tenant.lastName}` : ""}`,
    email: req.tenant.email,
  },
}));

app.get("/api/ecc/overview", async (req, reply) => {
  const data = await getOverview(req.tenant.orgId);
  if (!data) return reply.code(404).send({ error: { code: "not_found", message: "Org not found" } });
  return data;
});

app.get("/api/ecc/risk-domains", async (req) => ({
  domains: await listDomains(req.tenant.orgId),
}));

app.get("/api/ecc/risk-domains/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const data = await getDomain(req.tenant.orgId, id);
  if (!data) return reply.code(404).send({ error: { code: "not_found", message: "Domain not found" } });
  return data;
});

app.get("/api/ecc/findings", async (req) => ({
  findings: await listFindings(req.tenant.orgId),
}));

app.get("/api/ecc/findings/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const data = await getFinding(req.tenant.orgId, id);
  if (!data) return reply.code(404).send({ error: { code: "not_found", message: "Finding not found" } });
  return data;
});

app.get("/api/ecc/decisions", async (req) => {
  const q = req.query as { status?: string };
  return { decisions: await listDecisions(req.tenant.orgId, q.status) };
});

app.get("/api/ecc/decisions/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const data = await getDecision(req.tenant.orgId, id);
  if (!data) return reply.code(404).send({ error: { code: "not_found", message: "Decision not found" } });
  return data;
});

const actionBody = z.object({ notes: z.string().max(2000).optional() });

function decisionActionHandler(
  action: "approve" | "request-info" | "decline" | "close",
) {
  return async (req: any, reply: any) => {
    const parsed = actionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: "invalid_body", message: parsed.error.message },
      });
    }
    const { id } = req.params as { id: string };
    const result = await applyDecisionAction(
      req.tenant,
      id,
      action,
      parsed.data.notes,
    );
    if (result.error === "not_found") {
      return reply.code(404).send({ error: { code: "not_found", message: "Decision not found" } });
    }
    if (result.error === "terminal") {
      return reply.code(409).send({
        error: {
          code: "conflict",
          message: `Decision already in terminal status: ${result.status}`,
        },
      });
    }
    const detail = await getDecision(req.tenant.orgId, id);
    return { ok: true, status: result.status, decision: detail };
  };
}

app.post(
  "/api/ecc/decisions/:id/approve",
  { preHandler: requireRoles("cxo") },
  decisionActionHandler("approve"),
);
app.post(
  "/api/ecc/decisions/:id/request-info",
  { preHandler: requireRoles("cxo", "program_office") },
  decisionActionHandler("request-info"),
);
app.post(
  "/api/ecc/decisions/:id/decline",
  { preHandler: requireRoles("cxo") },
  decisionActionHandler("decline"),
);
app.post(
  "/api/ecc/decisions/:id/close",
  { preHandler: requireRoles("cxo", "program_office") },
  decisionActionHandler("close"),
);

app.get("/api/ecc/compliance", async (req) => getCompliance(req.tenant.orgId));
app.get("/api/ecc/activity", async (req) => ({
  activity: await getActivity(req.tenant.orgId),
}));
app.get("/api/ecc/audit", async (req) => ({
  audit: await getAudit(req.tenant.orgId),
}));
app.get("/api/ecc/reports", async (req) => ({
  reports: await listReports(req.tenant.orgId),
}));

app.post(
  "/api/ecc/reports/generate",
  { preHandler: requireRoles("cxo", "ciso", "program_office", "board_member") },
  async (req, reply) => {
    const body = z
      .object({
        reportType: z
          .enum(["board_briefing", "regulator_submission", "executive_report"])
          .default("executive_report"),
        window: z.enum(["7d", "30d", "90d", "quarter", "year"]).optional(),
        /** false = legacy markdown-only path */
        snapshot: z.boolean().optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        error: { code: "invalid_body", message: body.error.message },
      });
    }
    if (
      body.data.snapshot === false &&
      (body.data.reportType === "board_briefing" ||
        body.data.reportType === "regulator_submission")
    ) {
      const overview = await getOverview(req.tenant.orgId);
      if (!overview) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Org not found" } });
      }
      const report = await generateReport(
        req.tenant.orgId,
        req.tenant.userId,
        body.data.reportType,
        overview,
      );
      await mkdir(GENERATED_DIR, { recursive: true });
      await writeFile(
        path.join(GENERATED_DIR, `${report.reportId}.md`),
        report.content,
        "utf8",
      );
      return report;
    }
    try {
      const report = await generateExecutiveReport(
        req.tenant.orgId,
        req.tenant.userId,
        body.data.reportType === "regulator_submission"
          ? "regulator_submission"
          : "board_briefing",
        body.data.window ?? "30d",
      );
      await mkdir(GENERATED_DIR, { recursive: true });
      await writeFile(
        path.join(GENERATED_DIR, `${report.reportId}.md`),
        report.contentMarkdown,
        "utf8",
      );
      return { report };
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send({
        error: { code: "report_error", message: err.message },
      });
    }
  },
);

app.get("/api/ecc/reports/:id/content", async (req, reply) => {
  const { id } = req.params as { id: string };
  const { rows } = await query(
    `SELECT report_id FROM generated_reports WHERE org_id = $1 AND report_id = $2`,
    [req.tenant.orgId, id],
  );
  if (!rows[0]) {
    return reply.code(404).send({ error: { code: "not_found", message: "Report not found" } });
  }
  const filePath = path.join(GENERATED_DIR, `${id}.md`);
  try {
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(filePath, "utf8");
    reply.header("content-type", "text/markdown; charset=utf-8");
    return content;
  } catch {
    return reply.code(404).send({
      error: {
        code: "not_found",
        message: "Report content not available (imported historical reports lack local files).",
      },
    });
  }
});

// ---------------------------------------------------------------------------
// Phase 2 — Connector + Canonical Signal ingestion APIs
// ---------------------------------------------------------------------------
app.get("/api/ecc/connectors", async (req) => ({
  connectors: await listConnectors(req.tenant.orgId),
}));

app.post("/api/ecc/connectors", async (req, reply) => {
  const body = z
    .object({
      name: z.string().min(1).max(160),
      riskDomainId: z.string().uuid(),
      adapterKey: z.string().max(80).optional(),
      connectorType: z.string().max(80).optional(),
      vendor: z.string().max(120).optional(),
      credentialsReference: z.string().max(250).optional(),
      configuration: z.record(z.unknown()).optional(),
      pollingIntervalSeconds: z.number().int().positive().optional(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) {
    return reply.code(400).send({
      error: { code: "invalid_body", message: body.error.message },
    });
  }
  try {
    const connector = await createConnector(req.tenant.orgId, body.data);
    return reply.code(201).send({ connector });
  } catch (err: any) {
    return reply.code(err.statusCode ?? 500).send({
      error: { code: "connector_error", message: err.message },
    });
  }
});

app.get("/api/ecc/connectors/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const connector = await getConnector(req.tenant.orgId, id);
  if (!connector) {
    return reply.code(404).send({ error: { code: "not_found", message: "Connector not found" } });
  }
  return { connector };
});

app.post("/api/ecc/connectors/:id/test", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    const result = await testConnector(req.tenant.orgId, id);
    if (!result) {
      return reply.code(404).send({ error: { code: "not_found", message: "Connector not found" } });
    }
    return result;
  } catch (err: any) {
    return reply.code(err.statusCode ?? 500).send({
      error: { code: "connector_error", message: err.message },
    });
  }
});

app.post("/api/ecc/connectors/:id/sync", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    const out = await runConnectorSync(req.tenant.orgId, id);
    if (!out) {
      return reply.code(404).send({ error: { code: "not_found", message: "Connector not found" } });
    }
    return out;
  } catch (err: any) {
    return reply.code(err.statusCode ?? 500).send({
      error: { code: "sync_error", message: err.message },
    });
  }
});

app.get("/api/ecc/connectors/:id/runs", async (req, reply) => {
  const { id } = req.params as { id: string };
  const connector = await getConnector(req.tenant.orgId, id);
  if (!connector) {
    return reply.code(404).send({ error: { code: "not_found", message: "Connector not found" } });
  }
  return { runs: await listSyncRuns(req.tenant.orgId, id) };
});

app.post("/api/ecc/ingestion/raw-events", async (req, reply) => {
  const body = z
    .object({
      connectorId: z.string().uuid(),
      events: z
        .array(
          z.object({
            externalEventId: z.string().max(250).optional(),
            observedAt: z.string().optional(),
            contentType: z.string().optional(),
            payload: z.record(z.unknown()),
            sourceMetadata: z.record(z.unknown()).optional(),
          }),
        )
        .min(1)
        .max(100),
    })
    .safeParse(req.body ?? {});
  if (!body.success) {
    return reply.code(400).send({
      error: { code: "invalid_body", message: body.error.message },
    });
  }
  try {
    const result = await ingestRawEventsForConnector(
      req.tenant.orgId,
      body.data.connectorId,
      body.data.events,
    );
    if (!result) {
      return reply.code(404).send({ error: { code: "not_found", message: "Connector not found" } });
    }
    return { result };
  } catch (err: any) {
    return reply.code(err.statusCode ?? 500).send({
      error: { code: "ingestion_error", message: err.message },
    });
  }
});

app.get("/api/ecc/signals", async (req) => {
  const q = req.query as { lifecycle?: string; limit?: string };
  return {
    signals: await listSignals(req.tenant.orgId, {
      lifecycle: q.lifecycle,
      limit: q.limit ? Number(q.limit) : undefined,
    }),
  };
});

app.get("/api/ecc/signals/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const signal = await getSignal(req.tenant.orgId, id);
  if (!signal) {
    return reply.code(404).send({ error: { code: "not_found", message: "Signal not found" } });
  }
  return { signal };
});

// ---------------------------------------------------------------------------
// Phase 3 — Risk scenarios
// ---------------------------------------------------------------------------
app.get("/api/ecc/scenarios", async (req) => {
  const q = req.query as Record<string, string | undefined>;
  return {
    scenarios: await listScenarios(req.tenant.orgId, {
      status: q.status,
      priority: q.priority,
      domain: q.domain,
      businessUnit: q.business_unit,
      businessProcess: q.business_process,
      asset: q.asset,
      toleranceState: q.tolerance_state,
      limit: q.limit ? Number(q.limit) : undefined,
    }),
  };
});

app.get("/api/ecc/scenarios/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const scenario = await getScenario(req.tenant.orgId, id);
  if (!scenario) {
    return reply.code(404).send({ error: { code: "not_found", message: "Scenario not found" } });
  }
  return { scenario };
});

app.post("/api/ecc/scenarios/:id/recalculate", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    const result = await recalculate(req.tenant.orgId, id);
    if (!result) {
      return reply.code(404).send({ error: { code: "not_found", message: "Scenario not found" } });
    }
    return { result, scenario: await getScenario(req.tenant.orgId, id) };
  } catch (err: any) {
    return reply.code(err.statusCode ?? 500).send({
      error: { code: "recalculate_error", message: err.message },
    });
  }
});

app.get("/api/ecc/scenarios/:id/assessments", async (req, reply) => {
  const { id } = req.params as { id: string };
  const data = await listAssessments(req.tenant.orgId, id);
  if (!data) {
    return reply.code(404).send({ error: { code: "not_found", message: "Scenario not found" } });
  }
  return data;
});

app.get("/api/ecc/scenarios/:id/evidence", async (req, reply) => {
  const { id } = req.params as { id: string };
  const scenario = await getScenario(req.tenant.orgId, id);
  if (!scenario) {
    return reply.code(404).send({ error: { code: "not_found", message: "Scenario not found" } });
  }
  return { evidence: scenario.evidence };
});

app.get("/api/ecc/scenarios/:id/relationships", async (req, reply) => {
  const { id } = req.params as { id: string };
  const scenario = await getScenario(req.tenant.orgId, id);
  if (!scenario) {
    return reply.code(404).send({ error: { code: "not_found", message: "Scenario not found" } });
  }
  return {
    domains: scenario.domains,
    signals: scenario.signals,
    findings: scenario.findings,
    assets: scenario.assets,
    controls: scenario.controls,
    correlationEvents: scenario.correlationEvents,
  };
});

app.post("/api/ecc/scenarios/demo/seed", async (req) => {
  const seeded = await seedDemoScenarios(req.tenant.orgId);
  return seeded;
});

app.post(
  "/api/ecc/scenarios/demo/closed-loop",
  { preHandler: requireRoles("cxo", "program_office") },
  async (req) => seedClosedLoopDemos(req.tenant),
);

// Manager demo — synthetic data only (reset → seed → verify)
app.post(
  "/api/ecc/demo/reset",
  { preHandler: requireRoles("cxo", "ciso", "program_office") },
  async (req) => resetDemo(req.tenant.orgId),
);
app.post(
  "/api/ecc/demo/seed",
  { preHandler: requireRoles("cxo", "ciso", "program_office") },
  async (req) => seedDemo(req.tenant.orgId),
);
app.post(
  "/api/ecc/demo/prepare",
  { preHandler: requireRoles("cxo", "ciso", "program_office") },
  async (req) => prepareManagerDemo(req.tenant.orgId),
);
app.get("/api/ecc/demo/verify", async (req) => verifyDemo(req.tenant.orgId));
app.get("/api/ecc/demo/hero", async (req) => getDemoContext(req.tenant.orgId));

app.post("/api/ecc/scenarios/correlate", async (req) => {
  const n = await correlateReadySignals(req.tenant.orgId);
  return { correlated: n };
});

// ---------------------------------------------------------------------------
// Phase 4 — Business impact, treatment, decision, action, verification
// ---------------------------------------------------------------------------
app.get("/api/ecc/scenarios/:id/impact", async (req, reply) => {
  const { id } = req.params as { id: string };
  let impact = await getScenarioImpact(req.tenant.orgId, id);
  if (!impact) {
    const scenario = await getScenario(req.tenant.orgId, id);
    if (!scenario) {
      return reply.code(404).send({ error: { code: "not_found", message: "Scenario not found" } });
    }
    const intel = await refreshScenarioIntelligence(req.tenant.orgId, id);
    impact = intel.impact;
  }
  return { impact };
});

app.get("/api/ecc/scenarios/:id/treatment", async (req, reply) => {
  const { id } = req.params as { id: string };
  const scenario = await getScenario(req.tenant.orgId, id);
  if (!scenario) {
    return reply.code(404).send({ error: { code: "not_found", message: "Scenario not found" } });
  }
  return {
    treatment: await getTreatmentPlan(req.tenant.orgId, id),
    recommendation: scenario.recommendation,
  };
});

app.post(
  "/api/ecc/scenarios/:id/treatment",
  { preHandler: requireRoles("cxo", "program_office") },
  async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        treatmentType: z.enum(["mitigate", "transfer", "avoid", "accept", "monitor"]),
        rationale: z.string().min(1).max(4000),
        targetResidualRisk: z.number().min(0).max(100).nullable().optional(),
        targetDate: z.string().nullable().optional(),
        ownerUserId: z.string().uuid().nullable().optional(),
        estimatedCostAed: z.number().nonnegative().nullable().optional(),
        status: z
          .enum([
            "proposed",
            "approved",
            "in_progress",
            "blocked",
            "completed",
            "cancelled",
          ])
          .optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        error: { code: "invalid_body", message: body.error.message },
      });
    }
    try {
      const treatment = await upsertTreatmentPlan(req.tenant, id, body.data);
      if (!treatment) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Scenario not found" } });
      }
      return { treatment };
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send({
        error: { code: "treatment_error", message: err.message },
      });
    }
  },
);

app.get("/api/ecc/scenarios/:id/decisions", async (req, reply) => {
  const { id } = req.params as { id: string };
  const scenario = await getScenario(req.tenant.orgId, id);
  if (!scenario) {
    return reply.code(404).send({ error: { code: "not_found", message: "Scenario not found" } });
  }
  return { decisions: await listScenarioDecisions(req.tenant.orgId, id) };
});

app.post(
  "/api/ecc/scenarios/:id/decision",
  { preHandler: requireRoles("cxo", "program_office") },
  async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        outcome: z.enum([
          "approve",
          "request_information",
          "request-info",
          "decline",
          "acknowledge",
          "accept_risk",
          "monitor",
        ]),
        treatmentType: z
          .enum(["mitigate", "transfer", "avoid", "accept", "monitor"])
          .optional(),
        rationale: z.string().max(4000).optional(),
        notes: z.string().max(2000).optional(),
        ownerUserId: z.string().uuid().nullable().optional(),
        createAction: z.boolean().optional(),
        actionTitle: z.string().max(300).optional(),
        dueDate: z.string().nullable().optional(),
        estimatedCostAed: z.number().nonnegative().nullable().optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        error: { code: "invalid_body", message: body.error.message },
      });
    }
    if (
      ["approve", "decline", "accept_risk"].includes(body.data.outcome) &&
      req.tenant.role !== "cxo"
    ) {
      return reply.code(403).send({
        error: { code: "forbidden", message: "CXO role required for this outcome" },
      });
    }
    try {
      const result = await createScenarioDecision(req.tenant, id, body.data);
      if (!result) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Scenario not found" } });
      }
      return result;
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send({
        error: { code: "decision_error", message: err.message },
      });
    }
  },
);

app.get("/api/ecc/scenarios/:id/actions", async (req, reply) => {
  const { id } = req.params as { id: string };
  const scenario = await getScenario(req.tenant.orgId, id);
  if (!scenario) {
    return reply.code(404).send({ error: { code: "not_found", message: "Scenario not found" } });
  }
  return { actions: await listActions(req.tenant.orgId, id) };
});

app.post(
  "/api/ecc/scenarios/:id/actions",
  { preHandler: requireRoles("cxo", "program_office") },
  async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().min(1).max(300),
        description: z.string().min(1).max(4000),
        ownerUserId: z.string().uuid().nullable().optional(),
        priority: z.enum(["critical", "high", "medium", "low"]).optional(),
        dueDate: z.string().nullable().optional(),
        decisionId: z.string().uuid().nullable().optional(),
        estimatedCostAed: z.number().nonnegative().nullable().optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        error: { code: "invalid_body", message: body.error.message },
      });
    }
    try {
      const action = await createAction(req.tenant, id, body.data);
      if (!action) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Scenario not found" } });
      }
      return { action };
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send({
        error: { code: "action_error", message: err.message },
      });
    }
  },
);

app.patch(
  "/api/ecc/actions/:id",
  { preHandler: requireRoles("cxo", "program_office", "domain_analyst") },
  async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        status: z
          .enum(["open", "pending", "in_progress", "blocked", "completed", "cancelled"])
          .optional(),
        ownerUserId: z.string().uuid().nullable().optional(),
        blocker: z.string().max(2000).nullable().optional(),
        title: z.string().max(300).optional(),
        dueDate: z.string().nullable().optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        error: { code: "invalid_body", message: body.error.message },
      });
    }
    try {
      const action = await patchAction(req.tenant, id, body.data);
      if (!action) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Action not found" } });
      }
      return { action };
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send({
        error: { code: "action_error", message: err.message },
      });
    }
  },
);

app.post(
  "/api/ecc/actions/:id/verification",
  { preHandler: requireRoles("cxo", "program_office") },
  async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        result: z.enum(["verified", "failed", "inconclusive", "pass", "fail"]),
        notes: z.string().max(4000).optional(),
        improveControls: z.boolean().optional(),
        evidenceReference: z.string().max(500).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        error: { code: "invalid_body", message: body.error.message },
      });
    }
    try {
      const verification = await submitVerification(req.tenant, id, body.data);
      if (!verification) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Action not found" } });
      }
      return { verification };
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send({
        error: { code: "verification_error", message: err.message },
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Phase 5 — Enterprise intelligence + governance
// ---------------------------------------------------------------------------
app.get("/api/ecc/portfolio", async (req) => {
  const q = req.query as Record<string, string | undefined>;
  return getPortfolio(req.tenant.orgId, {
    businessUnit: q.business_unit,
    businessProcess: q.business_process,
    domain: q.domain,
    assetCriticality: q.asset_criticality,
    priority: q.priority,
    tolerance: q.tolerance,
    status: q.status,
    periodDays: q.period_days ? Number(q.period_days) : undefined,
  });
});

app.get("/api/ecc/trends", async (req) => {
  const q = req.query as { window?: string };
  return getTrends(req.tenant.orgId, q.window ?? "30d");
});

app.get("/api/ecc/hotspots", async (req) => getHotspots(req.tenant.orgId));

app.get("/api/ecc/decision-center", async (req) => {
  if (
    !["cxo", "ciso", "program_office", "board_member"].includes(req.tenant.role)
  ) {
    return {
      awaitingAction: [],
      note: "Decision center summary limited for this role",
    };
  }
  return getDecisionCenter(req.tenant.orgId);
});

app.get("/api/ecc/compliance/posture", async (req) =>
  getCompliancePosture(req.tenant.orgId),
);

app.get("/api/ecc/controls/posture", async (req) =>
  getControlPosture(req.tenant.orgId),
);

app.get("/api/ecc/business-units/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const data = await getBusinessUnitView(req.tenant.orgId, id);
  if (!data) {
    return reply.code(404).send({ error: { code: "not_found", message: "Business unit not found" } });
  }
  return data;
});

app.get("/api/ecc/business-processes/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const data = await getBusinessProcessView(req.tenant.orgId, id);
  if (!data) {
    return reply
      .code(404)
      .send({ error: { code: "not_found", message: "Business process not found" } });
  }
  return data;
});

app.get("/api/ecc/executive-briefing", async (req) =>
  getExecutiveBriefing(req.tenant.orgId),
);

app.get("/api/ecc/material-changes", async (req) => ({
  changes: await listMaterialChanges(req.tenant.orgId),
}));

app.post(
  "/api/ecc/material-changes/detect",
  { preHandler: requireRoles("cxo", "ciso", "program_office") },
  async (req) => ({ changes: await detectMaterialChanges(req.tenant.orgId) }),
);

app.get("/api/ecc/connectors/catalog", async (req) =>
  getConnectorCatalog(req.tenant.orgId),
);

app.get("/api/ecc/org/settings", async (req) => getOrgSettings(req.tenant.orgId));

app.get("/api/ecc/reports/snapshots", async (req) => ({
  reports: await listReportSnapshots(req.tenant.orgId),
}));

app.get("/api/ecc/reports/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  // Prefer immutable snapshot payload when present
  const snap = await getReportSnapshot(req.tenant.orgId, id);
  if (snap?.snapshot && Object.keys(snap.snapshot as object).length > 0) {
    return { report: snap };
  }
  if (!snap) {
    return reply.code(404).send({ error: { code: "not_found", message: "Report not found" } });
  }
  return { report: snap };
});

app.post(
  "/api/ecc/intelligence/demo/seed",
  { preHandler: requireRoles("cxo", "ciso", "program_office") },
  async (req) => seedExecutiveIntelligence(req.tenant.orgId),
);

// ---------------------------------------------------------------------------
// Phase 6 — Sample workbook ingestion proof (dev/demo only)
// ---------------------------------------------------------------------------
function sampleIngestionEnabled() {
  return process.env.ECC_ENABLE_SAMPLE_INGESTION !== "false";
}

app.post(
  "/api/ecc/ingestion/sample-workbook/reset",
  { preHandler: requireRoles("cxo", "ciso", "program_office") },
  async (req, reply) => {
    if (!sampleIngestionEnabled()) {
      return reply.code(403).send({ error: { code: "disabled", message: "Sample ingestion disabled" } });
    }
    return resetSampleWorkbookIngestion(req.tenant.orgId);
  },
);

app.post(
  "/api/ecc/ingestion/sample-workbook/run",
  { preHandler: requireRoles("cxo", "ciso", "program_office") },
  async (req, reply) => {
    if (!sampleIngestionEnabled()) {
      return reply.code(403).send({ error: { code: "disabled", message: "Sample ingestion disabled" } });
    }
    const body = (req.body ?? {}) as { correlate?: boolean };
    return runSampleWorkbookIngestion(req.tenant.orgId, {
      correlate: body.correlate !== false,
    });
  },
);

app.get("/api/ecc/ingestion/sample-workbook/status", async (req, reply) => {
  if (!sampleIngestionEnabled()) {
    return reply.code(403).send({ error: { code: "disabled", message: "Sample ingestion disabled" } });
  }
  return getSampleWorkbookStatus(req.tenant.orgId);
});

app.get("/api/ecc/ingestion/sample-workbook/results", async (req, reply) => {
  if (!sampleIngestionEnabled()) {
    return reply.code(403).send({ error: { code: "disabled", message: "Sample ingestion disabled" } });
  }
  return getSampleWorkbookResults(req.tenant.orgId);
});

app.get("/api/ecc/ingestion/sample-workbook/trace/:signalId", async (req, reply) => {
  if (!sampleIngestionEnabled()) {
    return reply.code(403).send({ error: { code: "disabled", message: "Sample ingestion disabled" } });
  }
  const { signalId } = req.params as { signalId: string };
  if (!/^[0-9a-f-]{36}$/i.test(signalId)) {
    return reply.code(400).send({ error: { code: "bad_request", message: "Invalid signal id" } });
  }
  try {
    const trace = await getIngestionTrace(req.tenant.orgId, signalId);
    if (!trace) {
      return reply.code(404).send({ error: { code: "not_found", message: "Signal not found" } });
    }
    return trace;
  } catch (err: any) {
    req.log.error({ err }, "sample workbook trace failed");
    return reply.code(500).send({
      error: { code: "trace_failed", message: err?.message ?? "Trace failed" },
    });
  }
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  console.log(`ECC API listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
