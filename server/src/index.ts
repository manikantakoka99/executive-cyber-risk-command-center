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
    `SELECT user_id, first_name, last_name, email, role
     FROM users WHERE org_id = $1 ORDER BY role, first_name`,
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
  { preHandler: requireRoles("cxo", "program_office", "board_member") },
  async (req, reply) => {
    const body = z
      .object({
        reportType: z.enum(["board_briefing", "regulator_submission"]),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        error: { code: "invalid_body", message: body.error.message },
      });
    }
    const overview = await getOverview(req.tenant.orgId);
    if (!overview) {
      return reply.code(404).send({ error: { code: "not_found", message: "Org not found" } });
    }
    const report = await generateReport(
      req.tenant.orgId,
      req.tenant.userId,
      body.data.reportType,
      overview,
    );
    await mkdir(GENERATED_DIR, { recursive: true });
    const filePath = path.join(GENERATED_DIR, `${report.reportId}.md`);
    await writeFile(filePath, report.content, "utf8");
    return report;
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

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  console.log(`ECC API listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
