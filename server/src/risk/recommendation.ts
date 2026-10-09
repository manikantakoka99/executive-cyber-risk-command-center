import { query } from "../db.js";
import { getScenarioImpact } from "./scenarioImpact.js";

export type TreatmentType = "mitigate" | "transfer" | "avoid" | "accept" | "monitor";

/**
 * Deterministic executive recommendation — no LLM.
 */
export async function generateRecommendation(orgId: string, scenarioId: string) {
  const { rows: scen } = await query<{
    title: string;
    tolerance_state: string;
    velocity: string;
    priority: string | null;
    status: string;
  }>(
    `SELECT title, tolerance_state::text, velocity::text, priority::text, status::text
     FROM risk_scenarios WHERE org_id=$1 AND scenario_id=$2`,
    [orgId, scenarioId],
  );
  if (!scen[0]) throw Object.assign(new Error("Scenario not found"), { statusCode: 404 });

  const { rows: ra } = await query<{
    residual_risk: string | null;
    confidence: string | null;
    control_adjustment: string | null;
  }>(
    `SELECT residual_risk::text, confidence::text, control_adjustment::text
     FROM risk_assessments
     WHERE org_id=$1 AND scenario_id=$2 AND is_current = true LIMIT 1`,
    [orgId, scenarioId],
  );

  const { rows: ctrls } = await query<{ effectiveness: string }>(
    `SELECT effectiveness::text FROM scenario_controls
     WHERE org_id=$1 AND scenario_id=$2`,
    [orgId, scenarioId],
  );

  let impact = await getScenarioImpact(orgId, scenarioId);
  if (!impact) {
    const { deriveScenarioBusinessImpact } = await import("./scenarioImpact.js");
    impact = await deriveScenarioBusinessImpact(orgId, scenarioId);
  }

  const residual = ra[0]?.residual_risk != null ? Number(ra[0].residual_risk) : 0;
  const confidence = ra[0]?.confidence != null ? Number(ra[0].confidence) : 40;
  const controlIneffective = ctrls.some((c) => c.effectiveness === "ineffective");
  const reasonCodes: string[] = [];

  if (scen[0].tolerance_state === "outside") reasonCodes.push("OUTSIDE_TOLERANCE");
  if (impact?.businessCriticality === "critical")
    reasonCodes.push("CRITICAL_BUSINESS_PROCESS");
  if (impact?.financialKnown && (impact.financialExposureAed ?? 0) >= 1_000_000)
    reasonCodes.push("HIGH_FINANCIAL_EXPOSURE");
  if (controlIneffective) reasonCodes.push("CONTROL_INEFFECTIVE");
  if (scen[0].velocity === "increasing") reasonCodes.push("RISK_INCREASING");
  if (confidence < 50) reasonCodes.push("LOW_CONFIDENCE");

  // Economics: only when both cost estimate and exposure known — never invent cost
  const estimatedCost: number | null = null; // unknown unless treatment plan supplies
  let economicsJustified = false;
  if (
    impact?.financialKnown &&
    impact.financialExposureAed != null &&
    estimatedCost != null &&
    estimatedCost > 0 &&
    impact.financialExposureAed > estimatedCost * 2
  ) {
    reasonCodes.push("REMEDIATION_ECONOMICALLY_JUSTIFIED");
    economicsJustified = true;
  }

  let treatment: TreatmentType = "monitor";
  let recommendedAction =
    "Acknowledge and monitor; residual risk is within or near tolerance.";
  let priority: "critical" | "high" | "medium" | "low" =
    (scen[0].priority as any) ?? "medium";

  if (scen[0].tolerance_state === "outside" || residual >= 60) {
    treatment = "mitigate";
    recommendedAction =
      "Approve mitigation: assign remediation owner, improve ineffective controls, and verify risk reduction.";
    priority = residual >= 80 ? "critical" : "high";
  } else if (
    impact?.financialKnown &&
    !economicsJustified &&
    residual >= 45 &&
    impact.financialExposureAed != null &&
    impact.financialExposureAed > 5_000_000
  ) {
    // High exposure but we lack a costed remediation plan — surface transfer/accept consideration
    treatment = "transfer";
    recommendedAction =
      "Consider risk transfer or accept with compensating controls; remediation cost evidence is incomplete.";
    reasonCodes.push("REMEDIATION_COST_UNCERTAIN");
    priority = "high";
  } else if (scen[0].tolerance_state === "within" && residual < 45) {
    treatment = "monitor";
    recommendedAction =
      "Acknowledge and continue monitoring; no remediation required at this time.";
    priority = "low";
  } else if (scen[0].tolerance_state === "near") {
    treatment = "mitigate";
    recommendedAction =
      "Approve targeted mitigation before residual risk breaches tolerance.";
    priority = "medium";
  }

  if (treatment === "mitigate" && controlIneffective) {
    recommendedAction =
      "Approve mitigation focused on ineffective controls, then verify residual risk reduction.";
  }

  const rationale = [
    `Scenario "${scen[0].title}".`,
    `Residual risk ${residual}/100; tolerance ${scen[0].tolerance_state}.`,
    impact?.financialKnown
      ? `Financial exposure AED ${impact.financialExposureAed}.`
      : "Financial exposure unknown.",
    `Recommended treatment: ${treatment}.`,
    `Reasons: ${reasonCodes.join(", ") || "WITHIN_NORMAL_BAND"}.`,
  ].join(" ");

  await query(
    `UPDATE risk_recommendations SET is_current = false
     WHERE org_id=$1 AND scenario_id=$2 AND is_current = true`,
    [orgId, scenarioId],
  );

  const { rows } = await query<{ recommendation_id: string }>(
    `INSERT INTO risk_recommendations (
       org_id, scenario_id, recommended_treatment, recommended_priority,
       recommended_action, reason_codes, rationale, economics_summary, is_current
     ) VALUES ($1,$2,$3::risk_treatment_type,$4::priority_tier,$5,$6,$7,$8::jsonb,true)
     RETURNING recommendation_id`,
    [
      orgId,
      scenarioId,
      treatment,
      priority,
      recommendedAction,
      reasonCodes,
      rationale,
      JSON.stringify({
        financialKnown: impact?.financialKnown ?? false,
        financialExposureAed: impact?.financialExposureAed ?? null,
        estimatedRemediationCostAed: null,
        estimatedRoi: null,
        note: estimatedCost == null
          ? "Remediation cost unknown — ROI not computed"
          : "ROI computed from known cost and exposure",
        economicsJustified,
      }),
    ],
  );

  const decisionRequired =
    treatment !== "monitor" || scen[0].tolerance_state === "outside";

  await query(
    `UPDATE risk_scenarios SET
       current_recommendation_id = $3,
       decision_required = $4,
       updated_at = now()
     WHERE org_id=$1 AND scenario_id=$2`,
    [orgId, scenarioId, rows[0].recommendation_id, decisionRequired],
  );

  return getRecommendation(orgId, scenarioId);
}

export async function getRecommendation(orgId: string, scenarioId: string) {
  const { rows } = await query(
    `SELECT * FROM risk_recommendations
     WHERE org_id=$1 AND scenario_id=$2 AND is_current = true LIMIT 1`,
    [orgId, scenarioId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    recommendationId: r.recommendation_id,
    scenarioId: r.scenario_id,
    recommendedTreatment: r.recommended_treatment,
    recommendedPriority: r.recommended_priority,
    recommendedAction: r.recommended_action,
    reasonCodes: r.reason_codes ?? [],
    rationale: r.rationale,
    economicsSummary: r.economics_summary,
    createdAt: r.created_at,
  };
}
