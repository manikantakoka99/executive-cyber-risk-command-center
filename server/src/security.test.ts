import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { query } from "./db.js";
import { getOverview } from "./services/overview.js";
import { getDomain, getFinding, listReports } from "./services/catalog.js";
import {
  applyDecisionAction,
  getDecision,
} from "./services/decisions.js";
import type { TenantContext } from "./middleware/tenant.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FAL = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";

async function user(orgId: string, role: string) {
  const { rows } = await query<{ user_id: string; first_name: string; email: string }>(
    `SELECT user_id, first_name, email FROM users WHERE org_id=$1 AND role=$2::user_role_name LIMIT 1`,
    [orgId, role],
  );
  assert.ok(rows[0], `missing ${role} for ${orgId}`);
  return rows[0];
}

function tenant(orgId: string, u: { user_id: string; first_name: string; email: string }, role: TenantContext["role"], orgName: string): TenantContext {
  return {
    orgId,
    userId: u.user_id,
    role,
    firstName: u.first_name,
    lastName: null,
    email: u.email,
    orgName,
  };
}

describe("tenant isolation", () => {
  it("does not leak Falcon findings into Al Dhabi domain detail", async () => {
    const { rows: falFindings } = await query<{ finding_id: string; risk_domain_id: string }>(
      `SELECT finding_id, risk_domain_id FROM risk_findings WHERE org_id=$1 LIMIT 1`,
      [FAL],
    );
    const domainId = falFindings[0].risk_domain_id;
    const falFindingId = falFindings[0].finding_id;

    const alDomain = await getDomain(AL, domainId);
    assert.ok(alDomain);
    assert.ok(
      !alDomain.findings.some((f) => f.findingId === falFindingId),
      "Al Dhabi domain detail must not include Falcon finding IDs",
    );

    const alFinding = await getFinding(AL, falFindingId);
    assert.equal(alFinding, null);
  });

  it("scopes reports by organization", async () => {
    const al = await listReports(AL);
    const fal = await listReports(FAL);
    const alIds = new Set(al.map((r) => r.reportId));
    for (const r of fal) {
      assert.ok(!alIds.has(r.reportId));
    }
  });
});

describe("decision workflow + audit", () => {
  let decisionId = "";
  let falCxo: TenantContext;

  before(async () => {
    // restore a clean awaiting decision if prior tests mutated
    await query(
      `UPDATE executive_decisions SET status='awaiting_decision', decided_by=NULL, decided_at=NULL
       WHERE org_id=$1 AND status='approved'
       AND decision_id = (
         SELECT decision_id FROM executive_decisions
         WHERE org_id=$1 AND title ILIKE '%Falcon IT Outsourcing%'
         LIMIT 1
       )`,
      [FAL],
    );
    const { rows } = await query<{ decision_id: string }>(
      `SELECT decision_id FROM executive_decisions
       WHERE org_id=$1 AND status='awaiting_decision' LIMIT 1`,
      [FAL],
    );
    decisionId = rows[0].decision_id;
    const u = await user(FAL, "cxo");
    falCxo = tenant(FAL, u, "cxo", "Falcon National Bank");
  });

  it("request-info then approve with action log + audit", async () => {
    const before = await getOverview(FAL);
    assert.ok(before);
    const awaitingBefore = before.decisionsAwaitingCxo;

    const info = await applyDecisionAction(falCxo, decisionId, "request-info", "Need cost");
    assert.equal(info.ok, true);
    assert.equal(info.status, "info_requested");

    const mid = await getOverview(FAL);
    assert.ok(mid);
    assert.equal(mid.decisionsAwaitingCxo, awaitingBefore - 1);
    assert.ok(!mid.pendingDecisions.some((d) => d.decisionId === decisionId));

    // reopen to awaiting for approve path via direct SQL (info_requested is not awaiting KPI)
    await query(
      `UPDATE executive_decisions SET status='awaiting_decision', decided_by=NULL, decided_at=NULL WHERE decision_id=$1`,
      [decisionId],
    );

    const approved = await applyDecisionAction(falCxo, decisionId, "approve", "Board ok");
    assert.equal(approved.ok, true);
    assert.equal(approved.status, "approved");

    const detail = await getDecision(FAL, decisionId);
    assert.ok(detail);
    assert.ok(detail.history.some((h) => h.action === "approved"));
    assert.ok(detail.history.some((h) => h.action === "info_requested"));

    const { rows: audits } = await query(
      `SELECT action FROM audit_log WHERE org_id=$1 AND entity_id=$2 ORDER BY created_at`,
      [FAL, decisionId],
    );
    assert.ok(audits.some((a) => a.action === "approved"));
    assert.ok(audits.some((a) => a.action === "info_requested"));

    // Al Dhabi cannot see Falcon decision
    const leaked = await getDecision(AL, decisionId);
    assert.equal(leaked, null);
  });
});

describe("overview KPI integrity", () => {
  it("Al Dhabi empty awaiting is valid and list matches KPI", async () => {
    const o = await getOverview(AL);
    assert.ok(o);
    assert.equal(o.decisionsAwaitingCxo, 0);
    assert.equal(o.pendingDecisions.length, 0);
    assert.ok(o.enterpriseRisk?.score != null);
    assert.ok(o.businessImpactExposureAed > 0);
  });
});
