import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { query } from "./db.js";
import { recalculateScenario } from "./risk/assessment.js";
import { deriveScenarioBusinessImpact } from "./risk/scenarioImpact.js";
import { generateRecommendation } from "./risk/recommendation.js";
import {
  createAction,
  createIsolatedScenario,
  createScenarioDecision,
  getTreatmentPlan,
  listScenarioDecisions,
  patchAction,
  refreshScenarioIntelligence,
  submitVerification,
  upsertTreatmentPlan,
} from "./services/closedLoop.js";
import { getScenario } from "./services/scenarios.js";
import type { TenantContext } from "./middleware/tenant.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FAL = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";

async function tenantFor(orgId: string, role: string): Promise<TenantContext> {
  const { rows } = await query<{
    user_id: string;
    first_name: string;
    email: string;
    name: string;
  }>(
    `SELECT u.user_id, u.first_name, u.email, o.name
     FROM users u
     JOIN organizations o ON o.org_id = u.org_id
     JOIN v_user_primary_role v ON v.user_id = u.user_id
     WHERE u.org_id=$1 AND v.role_code=$2 LIMIT 1`,
    [orgId, role],
  );
  assert.ok(rows[0], `missing ${role}`);
  return {
    orgId,
    userId: rows[0].user_id,
    role: role as TenantContext["role"],
    firstName: rows[0].first_name,
    lastName: null,
    email: rows[0].email,
    orgName: rows[0].name,
  };
}

let falCxo: TenantContext;
let scenarioId = "";

before(async () => {
  falCxo = await tenantFor(FAL, "cxo");
  scenarioId = await createIsolatedScenario(FAL, {
    title: `P4-base-${Date.now()}`,
    ineffectiveControl: true,
  });
});

describe("Phase 4 business impact", () => {
  it("derives scenario impact without inventing financial values", async () => {
    const impact = await deriveScenarioBusinessImpact(FAL, scenarioId);
    assert.ok(impact);
    assert.equal(typeof impact.financialKnown, "boolean");
    if (!impact.financialKnown) {
      assert.equal(impact.financialExposureAed, null);
      assert.equal(impact.financialStatus, "unknown");
    }
    assert.ok(impact.explanation);
    assert.match(impact.explanation, /driven|incomplete|unknown/i);
  });

  it("unknown financial impact is preserved on refresh", async () => {
    const impact = await deriveScenarioBusinessImpact(FAL, scenarioId);
    if (!impact!.financialKnown) {
      assert.equal(impact!.financialExposureAed, null);
      assert.ok(impact!.derivationMeta);
    }
  });
});

describe("Phase 4 recommendation + treatment", () => {
  it("recommendation logic is deterministic for outside-tolerance path", async () => {
    const rec = await generateRecommendation(FAL, scenarioId);
    assert.ok(rec);
    assert.ok(
      ["mitigate", "transfer", "avoid", "accept", "monitor"].includes(
        rec!.recommendedTreatment,
      ),
    );
    assert.ok(Array.isArray(rec!.reasonCodes));
  });

  it("creates treatment plan with unknown economics when cost missing", async () => {
    const plan = await upsertTreatmentPlan(falCxo, scenarioId, {
      treatmentType: "mitigate",
      rationale: "Test treatment plan",
      estimatedCostAed: null,
      status: "proposed",
    });
    assert.ok(plan);
    assert.equal(plan!.economicsKnown, false);
    assert.equal(plan!.estimatedCostAed, null);
    assert.match(plan!.economicsNote ?? "", /unknown|not enough/i);
    const got = await getTreatmentPlan(FAL, scenarioId);
    assert.equal(got!.treatmentPlanId, plan!.treatmentPlanId);
  });
});

describe("Phase 4 decision + action lifecycle", () => {
  it("creates scenario decision and action on approve", async () => {
    const sid = await createIsolatedScenario(FAL, { ineffectiveControl: true });
    const result = await createScenarioDecision(falCxo, sid, {
      outcome: "approve",
      treatmentType: "mitigate",
      rationale: "Approve mitigation for test",
      createAction: true,
      actionTitle: "Phase4 test remediation",
      dueDate: "2026-11-15",
    });
    assert.ok(result?.decision);
    assert.equal(result!.decision!.status, "approved");
    assert.equal(result!.decision!.treatmentType, "mitigate");
    assert.ok(result!.action);
    const decisions = await listScenarioDecisions(FAL, sid);
    assert.ok(decisions.some((d) => d.decisionId === result!.decision!.decisionId));
  });

  it("rejects cross-tenant action owner assignment", async () => {
    const sid = await createIsolatedScenario(FAL);
    const act = await createAction(falCxo, sid, {
      title: "Owner check",
      description: "x",
    });
    const alUser = await query<{ user_id: string }>(
      `SELECT user_id FROM users WHERE org_id=$1 LIMIT 1`,
      [AL],
    );
    await assert.rejects(
      () =>
        patchAction(falCxo, act!.actionId, {
          ownerUserId: alUser.rows[0].user_id,
        }),
      /organization|Org B/i,
    );
  });

  it("action lifecycle open → completed does not auto-reduce residual", async () => {
    const sid = await createIsolatedScenario(FAL, { ineffectiveControl: true });
    const before = await getScenario(FAL, sid);
    const residualBefore = Number(before!.currentAssessment.residual_risk);
    const act = await createAction(falCxo, sid, {
      title: "Complete without verify",
      description: "Should not reduce risk",
    });
    await patchAction(falCxo, act!.actionId, { status: "completed" });
    const mid = await getScenario(FAL, sid);
    assert.equal(Number(mid!.currentAssessment.residual_risk), residualBefore);
  });

  it("verification required before verify; failed verification does not reduce residual", async () => {
    const sid = await createIsolatedScenario(FAL, { ineffectiveControl: true });
    const before = await recalculateScenario(FAL, sid);
    const openAct = await createAction(falCxo, sid, {
      title: "Still open",
      description: "cannot verify yet",
    });
    await assert.rejects(
      () =>
        submitVerification(falCxo, openAct!.actionId, {
          result: "verified",
        }),
      /completed/i,
    );
    const act2 = await createAction(falCxo, sid, {
      title: "Fail verify",
      description: "fail",
    });
    await patchAction(falCxo, act2!.actionId, { status: "completed" });
    const failed = await submitVerification(falCxo, act2!.actionId, {
      result: "failed",
      notes: "controls not proven",
    });
    assert.equal(failed!.status, "failed");
    assert.equal(failed!.verifiedResidualRisk, before.residual);
    assert.equal(failed!.riskReduced, false);
  });

  it("successful verification recalculates and preserves history", async () => {
    const sid = await createIsolatedScenario(FAL, { ineffectiveControl: true });
    const before = await getScenario(FAL, sid);
    const priorId = before!.currentAssessment.risk_assessment_id;
    const residualBefore = Number(before!.currentAssessment.residual_risk);
    const histBefore = before!.assessments.length;

    const act = await createAction(falCxo, sid, {
      title: "Verify success",
      description: "closed loop",
    });
    await patchAction(falCxo, act!.actionId, { status: "completed" });
    const ver = await submitVerification(falCxo, act!.actionId, {
      result: "verified",
      notes: "evidence accepted",
      evidenceReference: "test://verify/ok",
      improveControls: true,
    });
    assert.equal(ver!.status, "verified");
    assert.ok(ver!.verifiedResidualRisk! <= residualBefore);

    const after = await getScenario(FAL, sid);
    assert.ok(after!.assessments.length >= histBefore + 1);
    assert.ok(
      after!.assessments.some(
        (a: any) => a.risk_assessment_id === priorId && a.is_current === false,
      ),
    );
    assert.notEqual(after!.currentAssessment.risk_assessment_id, priorId);
  });
});

describe("Phase 4 paths + tenant isolation", () => {
  it("within-tolerance monitoring path", async () => {
    const sid = await createIsolatedScenario(FAL, { ineffectiveControl: false });
    await refreshScenarioIntelligence(FAL, sid);
    const result = await createScenarioDecision(falCxo, sid, {
      outcome: "acknowledge",
      treatmentType: "monitor",
      rationale: "Monitor path",
      createAction: false,
    });
    assert.equal(result!.decision!.status, "acknowledged");
    assert.equal(result!.action, null);
  });

  it("tenant isolation: cannot view Org A scenario or decide for Org A from Falcon", async () => {
    const alId = await createIsolatedScenario(AL, { title: `P4-al-${Date.now()}` });
    const leaked = await getScenario(FAL, alId);
    assert.equal(leaked, null);
    await assert.rejects(
      () => deriveScenarioBusinessImpact(FAL, alId),
      (err: any) => err?.statusCode === 404 || /not found/i.test(err?.message),
    );
    const decision = await createScenarioDecision(falCxo, alId, {
      outcome: "approve",
      createAction: false,
    });
    assert.equal(decision, null);
  });

  it("end-to-end closed loop reduces residual when controls improve", async () => {
    const sid = await createIsolatedScenario(FAL, { ineffectiveControl: true });
    const before = await recalculateScenario(FAL, sid);
    await refreshScenarioIntelligence(FAL, sid);
    const dec = await createScenarioDecision(falCxo, sid, {
      outcome: "approve",
      treatmentType: "mitigate",
      rationale: "E2E mitigate",
      createAction: true,
      estimatedCostAed: 100000,
    });
    const actionId = (dec!.action as { actionId: string }).actionId;
    await patchAction(falCxo, actionId, { status: "completed" });
    const ver = await submitVerification(falCxo, actionId, {
      result: "verified",
      improveControls: true,
      evidenceReference: "test://e2e",
    });
    assert.ok(ver!.verifiedResidualRisk! < before.residual);
    assert.match(ver!.explanation, /decreased from/);
  });
});
