import { query } from "../db.js";
import { loadActivePolicy, loadToleranceMax } from "./policy.js";
import {
  buildExplanation,
  confidenceScore,
  inherentRisk,
  priorityFromResidual,
  residualRisk,
  severityScore,
  toleranceState,
  velocityFrom,
  weightedAverage,
  type FactorValue,
} from "./scoring.js";

/**
 * Recalculate likelihood/impact/inherent/residual/confidence/priority/tolerance.
 * Preserves prior assessments (is_current flipped); never invents AED figures.
 */
export async function recalculateScenario(orgId: string, scenarioId: string) {
  const { rows: scen } = await query<{
    scenario_id: string;
    title: string;
    primary_asset_id: string | null;
    business_process_id: string | null;
    first_seen_at: Date;
    last_seen_at: Date;
    current_assessment_id: string | null;
  }>(
    `SELECT scenario_id, title, primary_asset_id, business_process_id,
            first_seen_at, last_seen_at, current_assessment_id
     FROM risk_scenarios WHERE org_id = $1 AND scenario_id = $2`,
    [orgId, scenarioId],
  );
  if (!scen[0]) throw Object.assign(new Error("Scenario not found"), { statusCode: 404 });

  const policy = await loadActivePolicy(orgId);

  const { rows: signals } = await query<{
    severity: string;
    event_type: string;
    domain_code: string;
    observed_at: Date;
    asset_id: string | null;
  }>(
    `SELECT s.severity::text AS severity, s.event_type, d.code::text AS domain_code,
            s.observed_at, s.asset_id
     FROM risk_scenario_signals rs
     JOIN security_signals s ON s.signal_id = rs.signal_id AND s.org_id = rs.org_id
     JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     WHERE rs.org_id = $1 AND rs.scenario_id = $2`,
    [orgId, scenarioId],
  );

  const { rows: domains } = await query<{ code: string; short_label: string }>(
    `SELECT d.code::text AS code, d.short_label
     FROM risk_scenario_domains rd
     JOIN risk_domains d ON d.risk_domain_id = rd.risk_domain_id
     WHERE rd.org_id = $1 AND rd.scenario_id = $2`,
    [orgId, scenarioId],
  );

  const { rows: assets } = await query<{
    name: string;
    criticality: string;
    internet_exposed: boolean;
  }>(
    `SELECT a.name, a.criticality::text AS criticality, a.internet_exposed
     FROM risk_scenario_assets ra
     JOIN assets a ON a.asset_id = ra.asset_id AND a.org_id = ra.org_id
     WHERE ra.org_id = $1 AND ra.scenario_id = $2`,
    [orgId, scenarioId],
  );

  const { rows: ctrls } = await query<{
    effectiveness: string;
    effectiveness_score: string | null;
  }>(
    `SELECT effectiveness::text AS effectiveness, effectiveness_score::text
     FROM scenario_controls WHERE org_id = $1 AND scenario_id = $2`,
    [orgId, scenarioId],
  );

  // Linked finding impacts (existing MVP AED) — never invent
  const { rows: impacts } = await query<{
    financial_exposure_aed: string | null;
    downtime_cost_per_hour_aed: string | null;
    compliance_scope_impact: string | null;
  }>(
    `SELECT b.financial_exposure_aed::text, b.downtime_cost_per_hour_aed::text,
            b.compliance_scope_impact
     FROM risk_scenario_findings rf
     JOIN business_impact_assessments b ON b.finding_id = rf.finding_id AND b.org_id = rf.org_id
     WHERE rf.org_id = $1 AND rf.scenario_id = $2`,
    [orgId, scenarioId],
  );

  const maxSev = Math.max(0, ...signals.map((s) => severityScore(s.severity)), 0);
  const exposed = assets.some((a) => a.internet_exposed);
  const critAsset = assets.some((a) => a.criticality === "critical" || a.criticality === "high");
  const threatEvents = signals.filter((s) =>
    /malware|suspicious|privilege|ransomware|phishing|lateral|command/i.test(s.event_type),
  ).length;
  const vulnEvents = signals.filter((s) =>
    /vulnerab|exposure|misconfig|public_/i.test(s.event_type),
  ).length;

  let ctrlEff: "effective" | "partially_effective" | "ineffective" | "unknown" = "unknown";
  if (ctrls.length) {
    if (ctrls.some((c) => c.effectiveness === "ineffective")) ctrlEff = "ineffective";
    else if (ctrls.every((c) => c.effectiveness === "effective")) ctrlEff = "effective";
    else if (ctrls.some((c) => c.effectiveness === "partially_effective"))
      ctrlEff = "partially_effective";
    else if (ctrls.some((c) => c.effectiveness === "effective")) ctrlEff = "partially_effective";
  }

  const likelihoodFactors: FactorValue[] = [
    {
      code: "threat_activity",
      label: "Threat activity",
      raw: Math.min(100, 20 + threatEvents * 25 + maxSev * 0.3),
      note: `${threatEvents} threat-like signals; max severity score ${maxSev}`,
    },
    {
      code: "exposure_reachability",
      label: "Exposure / reachability",
      raw: exposed ? Math.min(100, 70 + (critAsset ? 15 : 0)) : critAsset ? 45 : 25,
      note: exposed ? "Internet-exposed asset present" : "No internet exposure flagged",
    },
    {
      code: "exploitability",
      label: "Exploitability",
      raw: Math.min(100, 15 + vulnEvents * 30 + (exposed ? 20 : 0)),
      note: `${vulnEvents} exposure/vuln-like signals`,
    },
    {
      code: "control_weakness",
      label: "Control weakness",
      raw:
        ctrlEff === "ineffective"
          ? 85
          : ctrlEff === "partially_effective"
            ? 55
            : ctrlEff === "effective"
              ? 20
              : 40,
      note: `Control effectiveness: ${ctrlEff}`,
    },
    {
      code: "attack_evidence",
      label: "Attack evidence",
      raw: Math.min(100, signals.length * 18 + (threatEvents > 0 ? 20 : 0)),
      note: `${signals.length} supporting signals`,
    },
  ];

  const financialVals = impacts
    .map((i) => Number(i.financial_exposure_aed))
    .filter((n) => !Number.isNaN(n) && n > 0);
  const hasFinancial = financialVals.length > 0;
  const financialRaw = hasFinancial
    ? Math.min(100, 40 + Math.log10(Math.max(...financialVals)) * 15)
    : 0; // unknown — do not invent

  const hasCompliance = impacts.some((i) => !!i.compliance_scope_impact);

  const impactFactors: FactorValue[] = [
    {
      code: "financial",
      label: "Financial",
      raw: hasFinancial ? financialRaw : 0,
      note: hasFinancial
        ? `Linked AED exposure present (max ${Math.max(...financialVals)})`
        : "Financial exposure unknown — not invented",
    },
    {
      code: "operational",
      label: "Operational",
      raw: impacts.some((i) => Number(i.downtime_cost_per_hour_aed) > 0)
        ? 70
        : critAsset
          ? 55
          : 30,
      note: "Derived from downtime impact linkage / asset criticality",
    },
    {
      code: "business_criticality",
      label: "Business criticality",
      raw: critAsset ? 85 : assets.length ? 50 : 35,
      note: critAsset ? "High/critical asset in scenario" : "Standard/unknown criticality",
    },
    {
      code: "regulatory_compliance",
      label: "Regulatory / compliance",
      raw: hasCompliance ? 80 : 25,
      note: hasCompliance
        ? "Compliance scope impact linked"
        : "No compliance scope on linked impacts",
    },
    {
      code: "data_impact",
      label: "Data impact",
      raw: hasCompliance || /pci|data|cardholder/i.test(scen[0].title) ? 65 : 30,
      note: "Heuristic from compliance/title cues",
    },
  ];

  // When financial unknown, redistribute weight among known impact factors
  const impactWeights = { ...policy.config.impact_weights };
  if (!hasFinancial && impactWeights.financial) {
    const fw = impactWeights.financial;
    delete impactWeights.financial;
    const keys = Object.keys(impactWeights);
    const share = fw / Math.max(1, keys.length);
    for (const k of keys) impactWeights[k] += share;
  }

  const L = weightedAverage(likelihoodFactors, policy.config.likelihood_weights);
  const I = weightedAverage(impactFactors, impactWeights);
  const inherent = inherentRisk(L.score, I.score);
  const { residual, reduction } = residualRisk(inherent, ctrlEff, policy.config);

  const assetCrit = assets[0]?.criticality ?? null;
  const tolMax = await loadToleranceMax(orgId, assetCrit);
  const tol = toleranceState(
    residual,
    tolMax.maxResidual,
    policy.config.tolerance.near_band,
  );

  const { rows: prior } = await query<{ residual_risk: string | null }>(
    `SELECT residual_risk::text FROM risk_assessments
     WHERE org_id = $1 AND scenario_id = $2 AND is_current = true
     LIMIT 1`,
    [orgId, scenarioId],
  );
  const priorResidual = prior[0]?.residual_risk != null ? Number(prior[0].residual_risk) : null;

  const lastSeen = scen[0].last_seen_at ?? new Date();
  const firstSeen = scen[0].first_seen_at ?? new Date();
  const freshnessHours = (Date.now() - lastSeen.getTime()) / 3600000;
  const conf = confidenceScore({
    signalCount: signals.length,
    domainCount: domains.length,
    assetResolved: assets.length > 0,
    hasBusinessContext: !!scen[0].business_process_id || assets.length > 0,
    hasFinancial,
    controlKnown: ctrlEff !== "unknown",
    freshnessHours,
  });

  const vel = velocityFrom(firstSeen, lastSeen, priorResidual, residual);
  const prio = priorityFromResidual(residual, policy.config.priority_bands, {
    criticalAsset: critAsset,
    outsideTolerance: tol.state === "outside",
    increasing: vel === "increasing",
  });

  const { rows: bp } = scen[0].business_process_id
    ? await query<{ name: string }>(
        `SELECT name FROM business_processes WHERE org_id=$1 AND business_process_id=$2`,
        [orgId, scen[0].business_process_id],
      )
    : { rows: [] as { name: string }[] };

  const explanation = buildExplanation({
    title: scen[0].title,
    residual,
    inherent,
    likelihood: L.score,
    impact: I.score,
    effectiveness: ctrlEff,
    tolerance: tol.reason,
    confidenceLabel: conf.label,
    confidenceNotes: conf.notes,
    domains: domains.map((d) => d.short_label || d.code),
    assetName: assets[0]?.name,
    processName: bp[0]?.name,
    financialKnown: hasFinancial,
  });

  // Clear previous current flag — history preserved
  await query(
    `UPDATE risk_assessments SET is_current = false
     WHERE org_id = $1 AND scenario_id = $2 AND is_current = true`,
    [orgId, scenarioId],
  );

  const { rows: lik } = await query<{ likelihood_id: string }>(
    `INSERT INTO likelihood_assessments
       (org_id, scenario_id, score, method, policy_version, notes)
     VALUES ($1,$2,$3,'policy_rules',$4,$5) RETURNING likelihood_id`,
    [orgId, scenarioId, L.score, policy.version, JSON.stringify(L.used)],
  );

  const { rows: imp } = await query<{ impact_assessment_id: string }>(
    `INSERT INTO impact_assessments
       (org_id, scenario_id, score, financial_aed, method, policy_version, notes)
     VALUES ($1,$2,$3,$4,'policy_rules',$5,$6) RETURNING impact_assessment_id`,
    [
      orgId,
      scenarioId,
      I.score,
      hasFinancial ? Math.max(...financialVals) : null,
      policy.version,
      JSON.stringify(I.used),
    ],
  );

  const { rows: ra } = await query<{ risk_assessment_id: string }>(
    `INSERT INTO risk_assessments (
       org_id, scenario_id, likelihood_id, impact_assessment_id,
       likelihood_score, impact_score, inherent_risk, residual_risk, confidence,
       control_adjustment, priority_score, priority_tier, tolerance_state, tolerance_reason,
       velocity, explanation, policy_version, is_current, calculation_meta
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::priority_tier,$13::tolerance_state,$14,
       $15::risk_velocity,$16,$17,true,$18::jsonb
     ) RETURNING risk_assessment_id`,
    [
      orgId,
      scenarioId,
      lik[0].likelihood_id,
      imp[0].impact_assessment_id,
      L.score,
      I.score,
      inherent,
      residual,
      conf.score,
      reduction,
      prio.score,
      prio.tier,
      tol.state,
      tol.reason,
      vel,
      explanation,
      policy.version,
      JSON.stringify({
        policyId: policy.policyId,
        policyVersion: policy.version,
        controlEffectiveness: ctrlEff,
        confidenceLabel: conf.label,
        confidenceNotes: conf.notes,
        hasFinancial,
        signalCount: signals.length,
        domainCount: domains.length,
      }),
    ],
  );

  const assessmentId = ra[0].risk_assessment_id;

  for (const f of [...L.used, ...I.used]) {
    await query(
      `INSERT INTO risk_assessment_factors
         (org_id, risk_assessment_id, factor_category, factor_code, factor_label,
          raw_value, normalized_value, contribution_note)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7)`,
      [
        orgId,
        assessmentId,
        policy.config.likelihood_weights[f.code] !== undefined ? "likelihood" : "impact",
        f.code,
        f.label,
        f.raw,
        f.note,
      ],
    );
  }

  const newStatus =
    tol.state === "outside"
      ? "active"
      : signals.length >= 2
        ? "active"
        : "candidate";

  await query(
    `UPDATE risk_scenarios SET
       current_assessment_id = $3,
       priority = $4::priority_tier,
       priority_score = $5,
       tolerance_state = $6::tolerance_state,
       tolerance_reason = $7,
       velocity = $8::risk_velocity,
       explanation = $9,
       status = CASE
         WHEN status IN ('accepted','closed','mitigated') THEN status
         ELSE $10::risk_scenario_status
       END,
       updated_at = now()
     WHERE org_id = $1 AND scenario_id = $2`,
    [
      orgId,
      scenarioId,
      assessmentId,
      prio.tier,
      prio.score,
      tol.state,
      tol.reason,
      vel,
      explanation,
      newStatus,
    ],
  );

  return {
    assessmentId,
    likelihood: L.score,
    impact: I.score,
    inherent,
    residual,
    confidence: conf.score,
    priority: prio.tier,
    tolerance: tol.state,
    explanation,
  };
}
