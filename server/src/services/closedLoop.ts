import { query, pool } from "../db.js";
import type { TenantContext } from "../middleware/tenant.js";
import { recalculateScenario } from "../risk/assessment.js";
import {
  deriveScenarioBusinessImpact,
  getScenarioImpact,
} from "../risk/scenarioImpact.js";
import {
  generateRecommendation,
  getRecommendation,
  type TreatmentType,
} from "../risk/recommendation.js";

async function audit(
  orgId: string,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  oldValue: unknown,
  newValue: unknown,
  reason?: string,
) {
  await query(
    `INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, old_value, new_value, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
    [
      orgId,
      userId,
      action,
      entityType,
      entityId,
      JSON.stringify(oldValue ?? {}),
      JSON.stringify({ ...(newValue as object), reason: reason ?? null }),
      `p4-${Date.now()}`,
    ],
  );
}

export async function refreshScenarioIntelligence(orgId: string, scenarioId: string) {
  const impact = await deriveScenarioBusinessImpact(orgId, scenarioId);
  const recommendation = await generateRecommendation(orgId, scenarioId);
  return { impact, recommendation };
}

export async function upsertTreatmentPlan(
  tenant: TenantContext,
  scenarioId: string,
  body: {
    treatmentType: TreatmentType;
    rationale: string;
    targetResidualRisk?: number | null;
    targetDate?: string | null;
    ownerUserId?: string | null;
    estimatedCostAed?: number | null;
    status?: string;
  },
) {
  const { rows: scen } = await query(
    `SELECT scenario_id, current_recommendation_id FROM risk_scenarios
     WHERE org_id=$1 AND scenario_id=$2`,
    [tenant.orgId, scenarioId],
  );
  if (!scen[0]) return null;

  const impact = await getScenarioImpact(tenant.orgId, scenarioId);
  const residualRow = await query<{ residual_risk: string | null }>(
    `SELECT residual_risk::text FROM risk_assessments
     WHERE org_id=$1 AND scenario_id=$2 AND is_current LIMIT 1`,
    [tenant.orgId, scenarioId],
  );
  const residual = residualRow.rows[0]?.residual_risk
    ? Number(residualRow.rows[0].residual_risk)
    : null;
  const target =
    body.targetResidualRisk ??
    (residual != null ? Math.max(10, Math.round(residual * 0.6)) : null);

  const cost = body.estimatedCostAed ?? null;
  const exposure = impact?.financialKnown ? impact.financialExposureAed : null;
  let riskReduction: number | null = null;
  let exposureReduction: number | null = null;
  let roi: number | null = null;
  let economicsKnown = false;
  let economicsNote = "not enough evidence";

  if (residual != null && target != null) {
    riskReduction = Math.max(0, residual - target);
  }
  if (exposure != null && cost != null && cost > 0 && riskReduction != null) {
    exposureReduction = Math.round(exposure * (riskReduction / Math.max(residual ?? 1, 1)));
    roi = Math.round(((exposureReduction - cost) / cost) * 10000) / 10000;
    economicsKnown = true;
    economicsNote = "ROI from known exposure and estimated remediation cost";
  } else if (cost == null) {
    economicsNote = "estimated remediation cost unknown";
  } else if (!impact?.financialKnown) {
    economicsNote = "financial exposure unknown — ROI not computed";
  }

  await query(
    `UPDATE treatment_plans SET is_current = false
     WHERE org_id=$1 AND scenario_id=$2 AND is_current = true`,
    [tenant.orgId, scenarioId],
  );

  const { rows } = await query<{ treatment_plan_id: string }>(
    `INSERT INTO treatment_plans (
       org_id, scenario_id, treatment_type, rationale, target_residual_risk,
       target_date, owner_user_id, estimated_cost_aed,
       estimated_remaining_exposure_aed, estimated_risk_reduction,
       estimated_exposure_reduction_aed, estimated_roi, economics_known,
       economics_note, status, recommendation_id, is_current
     ) VALUES (
       $1,$2,$3::risk_treatment_type,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
       $15::treatment_plan_status,$16,true
     ) RETURNING treatment_plan_id`,
    [
      tenant.orgId,
      scenarioId,
      body.treatmentType,
      body.rationale,
      target,
      body.targetDate ?? null,
      body.ownerUserId ?? null,
      cost,
      exposure != null && riskReduction != null && residual
        ? Math.round(exposure * (target! / residual))
        : null,
      riskReduction,
      exposureReduction,
      roi,
      economicsKnown,
      economicsNote,
      body.status ?? "proposed",
      scen[0].current_recommendation_id,
    ],
  );

  await query(
    `UPDATE risk_scenarios SET current_treatment_plan_id=$3, updated_at=now()
     WHERE org_id=$1 AND scenario_id=$2`,
    [tenant.orgId, scenarioId, rows[0].treatment_plan_id],
  );

  await audit(
    tenant.orgId,
    tenant.userId,
    "treatment_changed",
    "treatment_plan",
    rows[0].treatment_plan_id,
    {},
    { treatmentType: body.treatmentType, status: body.status ?? "proposed" },
    body.rationale,
  );

  return getTreatmentPlan(tenant.orgId, scenarioId);
}

export async function getTreatmentPlan(orgId: string, scenarioId: string) {
  const { rows } = await query(
    `SELECT tp.*, u.first_name, u.last_name
     FROM treatment_plans tp
     LEFT JOIN users u ON u.user_id = tp.owner_user_id
     WHERE tp.org_id=$1 AND tp.scenario_id=$2 AND tp.is_current = true
     LIMIT 1`,
    [orgId, scenarioId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    treatmentPlanId: r.treatment_plan_id,
    scenarioId: r.scenario_id,
    treatmentType: r.treatment_type,
    rationale: r.rationale,
    targetResidualRisk:
      r.target_residual_risk != null ? Number(r.target_residual_risk) : null,
    targetDate: r.target_date,
    ownerUserId: r.owner_user_id,
    ownerName:
      r.first_name != null
        ? `${r.first_name}${r.last_name ? ` ${r.last_name}` : ""}`
        : null,
    estimatedCostAed:
      r.estimated_cost_aed != null ? Number(r.estimated_cost_aed) : null,
    estimatedRemainingExposureAed:
      r.estimated_remaining_exposure_aed != null
        ? Number(r.estimated_remaining_exposure_aed)
        : null,
    estimatedRiskReduction:
      r.estimated_risk_reduction != null
        ? Number(r.estimated_risk_reduction)
        : null,
    estimatedExposureReductionAed:
      r.estimated_exposure_reduction_aed != null
        ? Number(r.estimated_exposure_reduction_aed)
        : null,
    estimatedRoi: r.estimated_roi != null ? Number(r.estimated_roi) : null,
    economicsKnown: !!r.economics_known,
    economicsNote: r.economics_note,
    status: r.status,
    recommendationId: r.recommendation_id,
  };
}

const DECISION_OUTCOME: Record<
  string,
  { status: string; log: string }
> = {
  approve: { status: "approved", log: "approved" },
  request_information: { status: "info_requested", log: "info_requested" },
  "request-info": { status: "info_requested", log: "info_requested" },
  decline: { status: "declined", log: "declined" },
  acknowledge: { status: "acknowledged", log: "acknowledged" },
  accept_risk: { status: "accepted_risk", log: "accepted_risk" },
  monitor: { status: "monitoring", log: "monitoring" },
};

export async function createScenarioDecision(
  tenant: TenantContext,
  scenarioId: string,
  body: {
    outcome: string;
    treatmentType?: TreatmentType;
    rationale?: string;
    notes?: string;
    ownerUserId?: string | null;
    createAction?: boolean;
    actionTitle?: string;
    dueDate?: string | null;
    estimatedCostAed?: number | null;
  },
) {
  const outcome = DECISION_OUTCOME[body.outcome];
  if (!outcome) {
    throw Object.assign(new Error(`Unsupported decision outcome: ${body.outcome}`), {
      statusCode: 400,
    });
  }

  const { rows: scen } = await query<{
    title: string;
    explanation: string | null;
    priority: string | null;
    current_recommendation_id: string | null;
    current_treatment_plan_id: string | null;
    current_impact_id: string | null;
  }>(
    `SELECT title, explanation, priority::text, current_recommendation_id,
            current_treatment_plan_id, current_impact_id
     FROM risk_scenarios WHERE org_id=$1 AND scenario_id=$2`,
    [tenant.orgId, scenarioId],
  );
  if (!scen[0]) return null;

  const rec = await getRecommendation(tenant.orgId, scenarioId);
  const impact = await getScenarioImpact(tenant.orgId, scenarioId);
  const treatmentType =
    body.treatmentType ??
    (rec?.recommendedTreatment as TreatmentType) ??
    "monitor";

  let treatmentPlanId = scen[0].current_treatment_plan_id;
  if (outcome.status === "approved" && treatmentType !== "monitor") {
    const plan = await upsertTreatmentPlan(tenant, scenarioId, {
      treatmentType,
      rationale:
        body.rationale ??
        rec?.rationale ??
        `Executive approved ${treatmentType}`,
      ownerUserId: body.ownerUserId ?? null,
      estimatedCostAed: body.estimatedCostAed ?? null,
      targetDate: body.dueDate ?? null,
      status: "approved",
    });
    treatmentPlanId = plan?.treatmentPlanId ?? treatmentPlanId;
  }

  const { rows: dec } = await query<{ decision_id: string }>(
    `INSERT INTO executive_decisions (
       org_id, scenario_id, title, priority, risk_summary, impact_summary,
       recommended_action, status, decided_by, decided_at, decision_notes,
       treatment_type, rationale, recommendation_id, treatment_plan_id,
       decision_owner_user_id
     ) VALUES (
       $1,$2,$3,$4::decision_priority,$5,$6,$7,$8::decision_status,$9,now(),$10,
       $11::risk_treatment_type,$12,$13,$14,$15
     ) RETURNING decision_id`,
    [
      tenant.orgId,
      scenarioId,
      scen[0].title,
      scen[0].priority ?? rec?.recommendedPriority ?? "medium",
      scen[0].explanation?.slice(0, 500) ?? scen[0].title,
      impact?.explanation ??
        (impact?.financialKnown
          ? `Financial exposure AED ${impact.financialExposureAed}`
          : "Financial exposure unknown"),
      rec?.recommendedAction ?? "Review scenario",
      outcome.status,
      tenant.userId,
      body.notes ?? null,
      treatmentType,
      body.rationale ?? rec?.rationale ?? null,
      rec?.recommendationId ?? scen[0].current_recommendation_id,
      treatmentPlanId,
      body.ownerUserId ?? tenant.userId,
    ],
  );

  await query(
    `INSERT INTO decision_action_log (decision_id, actor_user_id, action, notes)
     VALUES ($1,$2,$3,$4)`,
    [dec[0].decision_id, tenant.userId, outcome.log, body.notes ?? null],
  );

  await audit(
    tenant.orgId,
    tenant.userId,
    "decision_created",
    "executive_decision",
    dec[0].decision_id,
    {},
    { status: outcome.status, treatmentType, scenarioId },
    body.rationale,
  );

  await query(
    `INSERT INTO command_center_activity (org_id, activity_type, summary)
     VALUES ($1,'decision_resolved'::activity_type,$2)`,
    [
      tenant.orgId,
      `Scenario decision ${outcome.log.replaceAll("_", " ")}: ${scen[0].title}`,
    ],
  );

  await query(
    `UPDATE risk_scenarios SET decision_required = false, updated_at = now()
     WHERE org_id=$1 AND scenario_id=$2`,
    [tenant.orgId, scenarioId],
  );

  let action = null;
  if (
    body.createAction !== false &&
    outcome.status === "approved" &&
    (treatmentType === "mitigate" || treatmentType === "avoid")
  ) {
    action = await createAction(tenant, scenarioId, {
      decisionId: dec[0].decision_id,
      title:
        body.actionTitle ??
        `Remediate: ${scen[0].title}`.slice(0, 300),
      description: body.rationale ?? rec?.recommendedAction ?? "Execute approved treatment",
      ownerUserId: body.ownerUserId ?? null,
      priority: (scen[0].priority as string) ?? "high",
      dueDate: body.dueDate ?? null,
      treatmentPlanId: treatmentPlanId,
    });
  }

  return {
    decision: await getScenarioDecision(tenant.orgId, dec[0].decision_id),
    action,
  };
}

export async function listScenarioDecisions(orgId: string, scenarioId: string) {
  const { rows } = await query(
    `SELECT ed.*, u.first_name, u.last_name
     FROM executive_decisions ed
     LEFT JOIN users u ON u.user_id = COALESCE(ed.decision_owner_user_id, ed.decided_by)
     WHERE ed.org_id=$1 AND ed.scenario_id=$2
     ORDER BY ed.escalated_at DESC`,
    [orgId, scenarioId],
  );
  return rows.map(mapScenarioDecision);
}

async function getScenarioDecision(orgId: string, decisionId: string) {
  const { rows } = await query(
    `SELECT ed.*, u.first_name, u.last_name
     FROM executive_decisions ed
     LEFT JOIN users u ON u.user_id = COALESCE(ed.decision_owner_user_id, ed.decided_by)
     WHERE ed.org_id=$1 AND ed.decision_id=$2`,
    [orgId, decisionId],
  );
  if (!rows[0]) return null;
  return mapScenarioDecision(rows[0]);
}

function mapScenarioDecision(r: Record<string, unknown>) {
  return {
    decisionId: r.decision_id,
    scenarioId: r.scenario_id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    treatmentType: r.treatment_type,
    rationale: r.rationale ?? r.decision_notes,
    riskSummary: r.risk_summary,
    impactSummary: r.impact_summary,
    recommendedAction: r.recommended_action,
    decidedAt: r.decided_at,
    ownerName:
      r.first_name != null
        ? `${r.first_name}${r.last_name ? ` ${r.last_name}` : ""}`
        : null,
    treatmentPlanId: r.treatment_plan_id,
  };
}

export async function createAction(
  tenant: TenantContext,
  scenarioId: string,
  body: {
    decisionId?: string | null;
    title: string;
    description: string;
    ownerUserId?: string | null;
    priority?: string;
    dueDate?: string | null;
    treatmentPlanId?: string | null;
    estimatedCostAed?: number | null;
  },
) {
  const { rows: scen } = await query(
    `SELECT 1 FROM risk_scenarios WHERE org_id=$1 AND scenario_id=$2`,
    [tenant.orgId, scenarioId],
  );
  if (!scen[0]) return null;

  if (body.ownerUserId) {
    const { rows: ou } = await query(
      `SELECT 1 FROM users WHERE org_id=$1 AND user_id=$2`,
      [tenant.orgId, body.ownerUserId],
    );
    if (!ou[0]) {
      throw Object.assign(new Error("Action owner must belong to this organization"), {
        statusCode: 403,
      });
    }
  }

  const status = "open"; // Phase 4 enum value
  const { rows } = await query<{ action_id: string }>(
    `INSERT INTO actions (
       org_id, decision_id, scenario_id, owner_user_id, action_type, title,
       description, status, priority, due_at, estimated_cost_aed,
       treatment_plan_id, verification_required
     ) VALUES (
       $1,$2,$3,$4,'remediation',$5,$6,$7::action_status,$8::decision_priority,
       $9,$10,$11,true
     ) RETURNING action_id`,
    [
      tenant.orgId,
      body.decisionId ?? null,
      scenarioId,
      body.ownerUserId ?? null,
      body.title.slice(0, 300),
      body.description,
      status,
      body.priority ?? "medium",
      body.dueDate ?? null,
      body.estimatedCostAed ?? null,
      body.treatmentPlanId ?? null,
    ],
  );

  await audit(
    tenant.orgId,
    tenant.userId,
    "action_created",
    "action",
    rows[0].action_id,
    {},
    { scenarioId, title: body.title, status },
  );

  return getAction(tenant.orgId, rows[0].action_id);
}

export async function listActions(orgId: string, scenarioId: string) {
  const { rows } = await query(
    `SELECT a.*, u.first_name, u.last_name
     FROM actions a
     LEFT JOIN users u ON u.user_id = a.owner_user_id
     WHERE a.org_id=$1 AND a.scenario_id=$2
     ORDER BY a.created_at DESC`,
    [orgId, scenarioId],
  );
  return rows.map(mapAction);
}

export async function getAction(orgId: string, actionId: string) {
  const { rows } = await query(
    `SELECT a.*, u.first_name, u.last_name
     FROM actions a
     LEFT JOIN users u ON u.user_id = a.owner_user_id
     WHERE a.org_id=$1 AND a.action_id=$2`,
    [orgId, actionId],
  );
  if (!rows[0]) return null;
  return mapAction(rows[0]);
}

function mapAction(r: Record<string, unknown>) {
  return {
    actionId: String(r.action_id),
    scenarioId: (r.scenario_id as string | null) ?? null,
    decisionId: (r.decision_id as string | null) ?? null,
    title: String(r.title ?? r.description ?? ""),
    description: String(r.description ?? ""),
    status: String(r.status),
    priority: String(r.priority),
    ownerUserId: (r.owner_user_id as string | null) ?? null,
    ownerName:
      r.first_name != null
        ? `${r.first_name}${r.last_name ? ` ${r.last_name}` : ""}`
        : null,
    dueDate: r.due_at,
    completedAt: r.completed_at,
    blocker: r.blocker,
    verificationRequired: r.verification_required,
    estimatedCostAed:
      r.estimated_cost_aed != null ? Number(r.estimated_cost_aed) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function patchAction(
  tenant: TenantContext,
  actionId: string,
  body: {
    status?: string;
    ownerUserId?: string | null;
    blocker?: string | null;
    title?: string;
    dueDate?: string | null;
  },
) {
  const cur = await getAction(tenant.orgId, actionId);
  if (!cur) return null;

  if (body.status === "completed" || body.status === "verified") {
    // Completing action does NOT reduce residual risk — verification required
  }

  if (body.ownerUserId) {
    const { rows: ou } = await query(
      `SELECT 1 FROM users WHERE org_id=$1 AND user_id=$2`,
      [tenant.orgId, body.ownerUserId],
    );
    if (!ou[0]) {
      throw Object.assign(new Error("Cannot assign Org B user to Org A action"), {
        statusCode: 403,
      });
    }
  }

  const newStatus = body.status === "open" ? "open" : body.status;
  await query(
    `UPDATE actions SET
       status = COALESCE($3::action_status, status),
       owner_user_id = COALESCE($4, owner_user_id),
       blocker = COALESCE($5, blocker),
       title = COALESCE($6, title),
       due_at = COALESCE($7, due_at),
       completed_at = CASE
         WHEN $3::text IN ('completed','verified') THEN COALESCE(completed_at, now())
         ELSE completed_at END,
       updated_at = now()
     WHERE org_id=$1 AND action_id=$2`,
    [
      tenant.orgId,
      actionId,
      newStatus ?? null,
      body.ownerUserId ?? null,
      body.blocker ?? null,
      body.title ?? null,
      body.dueDate ?? null,
    ],
  );

  await audit(
    tenant.orgId,
    tenant.userId,
    body.ownerUserId && body.ownerUserId !== cur.ownerUserId
      ? "action_reassigned"
      : "action_status_changed",
    "action",
    actionId,
    { status: cur.status, ownerUserId: cur.ownerUserId },
    {
      status: newStatus ?? cur.status,
      ownerUserId: body.ownerUserId ?? cur.ownerUserId,
      blocker: body.blocker,
    },
  );

  return getAction(tenant.orgId, actionId);
}

/**
 * Submit verification for a completed action.
 * Only a successful verification triggers control improvement + recalculation.
 * Completing an action alone never reduces residual risk.
 */
export async function submitVerification(
  tenant: TenantContext,
  actionId: string,
  body: {
    result: "verified" | "failed" | "inconclusive" | "pass" | "fail";
    notes?: string;
    improveControls?: boolean;
    evidenceReference?: string;
  },
) {
  const action = await getAction(tenant.orgId, actionId);
  if (!action) return null;
  const scenarioId = action.scenarioId as string | null;
  if (!scenarioId) {
    throw Object.assign(new Error("Action has no scenario"), { statusCode: 400 });
  }
  if (action.status !== "completed" && action.status !== "verified") {
    throw Object.assign(
      new Error("Verification requires action status completed (risk not auto-reduced)"),
      { statusCode: 409 },
    );
  }

  const statusMap: Record<string, { vs: string; result: string }> = {
    verified: { vs: "verified", result: "pass" },
    pass: { vs: "verified", result: "pass" },
    failed: { vs: "failed", result: "fail" },
    fail: { vs: "failed", result: "fail" },
    inconclusive: { vs: "inconclusive", result: "inconclusive" },
  };
  const mapped = statusMap[body.result];
  if (!mapped) {
    throw Object.assign(new Error("Invalid verification result"), { statusCode: 400 });
  }

  const { rows: prior } = await query<{
    risk_assessment_id: string;
    residual_risk: string | null;
  }>(
    `SELECT risk_assessment_id, residual_risk::text FROM risk_assessments
     WHERE org_id=$1 AND scenario_id=$2 AND is_current = true LIMIT 1`,
    [tenant.orgId, scenarioId],
  );
  const previousResidual =
    prior[0]?.residual_risk != null ? Number(prior[0].residual_risk) : null;
  const previousAssessmentId = prior[0]?.risk_assessment_id ?? null;

  let evidenceId: string | null = null;
  if (body.evidenceReference) {
    const { rows: ev } = await query<{ evidence_id: string }>(
      `INSERT INTO evidence (org_id, source, evidence_type, source_reference, metadata)
       VALUES ($1,'verification','remediation_proof',$2,$3::jsonb)
       RETURNING evidence_id`,
      [
        tenant.orgId,
        body.evidenceReference,
        JSON.stringify({ actionId, notes: body.notes ?? null }),
      ],
    );
    evidenceId = ev[0].evidence_id;
    await query(
      `INSERT INTO scenario_evidence (scenario_id, evidence_id, org_id, link_reason)
       VALUES ($1,$2,$3,'verification') ON CONFLICT DO NOTHING`,
      [scenarioId, evidenceId, tenant.orgId],
    );
  }

  let newAssessmentId: string | null = null;
  let verifiedResidual = previousResidual;

  if (mapped.vs === "verified") {
    // Improve controls only on successful verification (closed loop)
    if (body.improveControls !== false) {
      await query(
        `UPDATE scenario_controls SET
           effectiveness = 'effective'::control_effectiveness,
           evidence_note = COALESCE(evidence_note,'') || ' | Verified remediation'
         WHERE org_id=$1 AND scenario_id=$2
           AND effectiveness IN ('ineffective','partially_effective','unknown')`,
        [tenant.orgId, scenarioId],
      );
    }
    const recalc = await recalculateScenario(tenant.orgId, scenarioId);
    verifiedResidual = recalc.residual;
    newAssessmentId = recalc.assessmentId;

    await query(
      `UPDATE actions SET status = 'verified'::action_status, updated_at = now()
       WHERE org_id=$1 AND action_id=$2`,
      [tenant.orgId, actionId],
    );
    await query(
      `UPDATE treatment_plans SET status = 'completed'::treatment_plan_status, updated_at = now()
       WHERE org_id=$1 AND scenario_id=$2 AND is_current = true`,
      [tenant.orgId, scenarioId],
    );
  }

  const { rows: ver } = await query<{ verification_id: string }>(
    `INSERT INTO risk_verifications (
       org_id, scenario_id, action_id, verification_type, source, result,
       verification_status, verified_by, notes, evidence_id,
       previous_residual_risk, verified_residual_risk,
       previous_assessment_id, new_assessment_id, gates_risk_reduction
     ) VALUES (
       $1,$2,$3,'remediation_effectiveness','closed_loop',$4::verification_result,
       $5::verification_status,$6,$7,$8,$9,$10,$11,$12,true
     ) RETURNING verification_id`,
    [
      tenant.orgId,
      scenarioId,
      actionId,
      mapped.result,
      mapped.vs,
      tenant.userId,
      body.notes ?? null,
      evidenceId,
      previousResidual,
      verifiedResidual,
      previousAssessmentId,
      newAssessmentId,
    ],
  );

  await audit(
    tenant.orgId,
    tenant.userId,
    mapped.vs === "verified" ? "verification_approved" : "verification_submitted",
    "risk_verification",
    ver[0].verification_id,
    { residual: previousResidual },
    {
      status: mapped.vs,
      residual: verifiedResidual,
      assessmentPreserved: previousAssessmentId,
      newAssessmentId,
    },
    body.notes,
  );

  if (mapped.vs === "verified") {
    await audit(
      tenant.orgId,
      tenant.userId,
      "risk_recalculated",
      "risk_scenario",
      scenarioId,
      { residual: previousResidual },
      { residual: verifiedResidual, via: "verification" },
    );
    await refreshScenarioIntelligence(tenant.orgId, scenarioId);
  }

  return {
    verificationId: ver[0].verification_id,
    status: mapped.vs,
    previousResidualRisk: previousResidual,
    verifiedResidualRisk: verifiedResidual,
    previousAssessmentId,
    newAssessmentId,
    riskReduced:
      previousResidual != null &&
      verifiedResidual != null &&
      verifiedResidual < previousResidual,
    explanation:
      mapped.vs === "verified"
        ? `Residual risk ${
            previousResidual != null && verifiedResidual != null
              ? `decreased from ${previousResidual} to ${verifiedResidual}`
              : "recalculated"
          } after verified remediation.`
        : `Verification ${mapped.vs}; residual risk unchanged until verification succeeds.`,
  };
}

export async function listVerifications(orgId: string, scenarioId: string) {
  const { rows } = await query(
    `SELECT * FROM risk_verifications
     WHERE org_id=$1 AND scenario_id=$2
     ORDER BY verified_at DESC`,
    [orgId, scenarioId],
  );
  return rows.map((r) => ({
    verificationId: r.verification_id,
    actionId: r.action_id,
    status: r.verification_status,
    result: r.result,
    previousResidualRisk:
      r.previous_residual_risk != null ? Number(r.previous_residual_risk) : null,
    verifiedResidualRisk:
      r.verified_residual_risk != null ? Number(r.verified_residual_risk) : null,
    notes: r.notes,
    verifiedAt: r.verified_at,
    verifiedBy: r.verified_by,
  }));
}

/** Isolated scenario for tests (does not wipe shared demos). */
export async function createIsolatedScenario(
  orgId: string,
  opts: { title?: string; ineffectiveControl?: boolean } = {},
) {
  const title =
    opts.title ?? `P4 isolated ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  await query(
    `INSERT INTO assets (org_id, name, asset_type, criticality, environment, internet_exposed, status)
     VALUES ($1,$2,'application','critical','production',true,'active')
     ON CONFLICT (org_id, name) DO NOTHING`,
    [orgId, `${title}-asset`],
  );
  const { rows: assets } = await query<{ asset_id: string }>(
    `SELECT asset_id FROM assets WHERE org_id=$1 AND name=$2`,
    [orgId, `${title}-asset`],
  );
  const { rows: domains } = await query<{ risk_domain_id: string }>(
    `SELECT risk_domain_id FROM risk_domains WHERE code='soc_mdr' LIMIT 1`,
  );
  const { rows: sc } = await query<{ scenario_id: string }>(
    `INSERT INTO risk_scenarios (
       org_id, title, description, status, scenario_type, primary_asset_id,
       primary_domain_id, first_seen_at, last_seen_at, is_demo
     ) VALUES ($1,$2,$3,'active','isolated_test',$4,$5,now(),now(),false)
     RETURNING scenario_id`,
    [orgId, title, "Isolated Phase 4 test scenario", assets[0].asset_id, domains[0].risk_domain_id],
  );
  const sid = sc[0].scenario_id;
  await query(
    `INSERT INTO risk_scenario_assets (scenario_id, asset_id, org_id) VALUES ($1,$2,$3)`,
    [sid, assets[0].asset_id, orgId],
  );
  await query(
    `INSERT INTO risk_scenario_domains (scenario_id, risk_domain_id, org_id) VALUES ($1,$2,$3)`,
    [sid, domains[0].risk_domain_id, orgId],
  );
  await query(
    `INSERT INTO controls (org_id, name, control_type, status)
     VALUES ($1,$2,'preventive','implemented') ON CONFLICT (org_id, name) DO NOTHING`,
    [orgId, `${title}-ctrl`],
  );
  const { rows: ctrl } = await query<{ control_id: string }>(
    `SELECT control_id FROM controls WHERE org_id=$1 AND name=$2`,
    [orgId, `${title}-ctrl`],
  );
  await query(
    `INSERT INTO scenario_controls
       (scenario_id, control_id, org_id, effectiveness, assessment_status, evidence_note)
     VALUES ($1,$2,$3,$4::control_effectiveness,'assessed','isolated test')`,
    [
      sid,
      ctrl[0].control_id,
      orgId,
      opts.ineffectiveControl === false ? "effective" : "ineffective",
    ],
  );
  const { rows: sig } = await query<{ signal_id: string }>(
    `INSERT INTO security_signals (
       org_id, risk_domain_id, event_type, severity, asset_id, observed_at,
       title, source_type, source_name, lifecycle_status, evidence_refs, vendor_extensions
     ) VALUES (
       $1,$2,'suspicious_process','critical',$3,now(),$4,'soc','p4_test',
       'ready_for_correlation','[]'::jsonb,'{}'::jsonb
     ) RETURNING signal_id`,
    [orgId, domains[0].risk_domain_id, assets[0].asset_id, `${title} signal`],
  );
  await query(
    `INSERT INTO risk_scenario_signals (scenario_id, signal_id, org_id) VALUES ($1,$2,$3)`,
    [sid, sig[0].signal_id, orgId],
  );
  await recalculateScenario(orgId, sid);
  await refreshScenarioIntelligence(orgId, sid);
  return sid;
}

/** Synthetic closed-loop demos for an org */
export async function seedClosedLoopDemos(tenant: TenantContext) {
  const { seedDemoScenarios } = await import("./scenarios.js");
  const seeded = await seedDemoScenarios(tenant.orgId);
  const results: unknown[] = [];

  // Ensure intelligence on all
  for (const sid of seeded.scenarioIds) {
    await recalculateScenario(tenant.orgId, sid);
    await refreshScenarioIntelligence(tenant.orgId, sid);
  }

  // Demo 1: ransomware-like (title match) → mitigate → approve → action → verify → reduce
  const { rows: scens } = await query<{ scenario_id: string; title: string }>(
    `SELECT scenario_id, title FROM risk_scenarios
     WHERE org_id=$1 AND is_demo = true ORDER BY title`,
    [tenant.orgId],
  );

  const ransom =
    scens.find((s) => /ransomware/i.test(s.title)) ?? scens[0];
  const medium =
    scens.find((s) => /credential|phishing/i.test(s.title)) ?? scens[1];
  const transferCand =
    scens.find((s) => /vulnerab|API/i.test(s.title)) ?? scens[2];

  if (ransom) {
    await query(
      `UPDATE scenario_controls SET effectiveness='ineffective'
       WHERE org_id=$1 AND scenario_id=$2`,
      [tenant.orgId, ransom.scenario_id],
    );
    await recalculateScenario(tenant.orgId, ransom.scenario_id);
    await refreshScenarioIntelligence(tenant.orgId, ransom.scenario_id);
    const before = await query<{ residual_risk: string }>(
      `SELECT residual_risk::text FROM risk_assessments
       WHERE org_id=$1 AND scenario_id=$2 AND is_current LIMIT 1`,
      [tenant.orgId, ransom.scenario_id],
    );
    const dec = await createScenarioDecision(tenant, ransom.scenario_id, {
      outcome: "approve",
      treatmentType: "mitigate",
      rationale: "Demo 1: outside-tolerance ransomware path — mitigate",
      createAction: true,
      actionTitle: "Restore immutable backups and EDR coverage",
      dueDate: "2026-11-15",
      estimatedCostAed: 250000,
    });
    const actionId = (dec?.action as any)?.actionId;
    if (actionId) {
      await patchAction(tenant, actionId, { status: "completed" });
      const ver = await submitVerification(tenant, actionId, {
        result: "verified",
        notes: "Demo verification — backups proven immutable",
        evidenceReference: "demo://verification/ransomware-1",
        improveControls: true,
      });
      results.push({
        demo: 1,
        name: "ransomware_closed_loop",
        scenarioId: ransom.scenario_id,
        residualBefore: before.rows[0] ? Number(before.rows[0].residual_risk) : null,
        verification: ver,
      });
    }
  }

  if (medium) {
    await refreshScenarioIntelligence(tenant.orgId, medium.scenario_id);
    // Force within-tolerance monitoring path if needed by accepting lower residual narrative
    const dec = await createScenarioDecision(tenant, medium.scenario_id, {
      outcome: "acknowledge",
      treatmentType: "monitor",
      rationale: "Demo 2: within/near tolerance — monitor, no remediation",
      createAction: false,
    });
    results.push({
      demo: 2,
      name: "monitor_acknowledge",
      scenarioId: medium.scenario_id,
      decision: dec?.decision,
    });
  }

  if (transferCand) {
    await upsertTreatmentPlan(tenant, transferCand.scenario_id, {
      treatmentType: "transfer",
      rationale:
        "Demo 3: high risk with incomplete remediation cost evidence — transfer/accept consideration",
      estimatedCostAed: null,
      status: "proposed",
    });
    await generateRecommendation(tenant.orgId, transferCand.scenario_id);
    const dec = await createScenarioDecision(tenant, transferCand.scenario_id, {
      outcome: "request_information",
      treatmentType: "transfer",
      rationale: "Need costed remediation options before approve/transfer/accept",
      createAction: false,
    });
    results.push({
      demo: 3,
      name: "transfer_consideration",
      scenarioId: transferCand.scenario_id,
      decision: dec?.decision,
    });
  }

  return { scenarioIds: seeded.scenarioIds, demos: results };
}

export { pool };
