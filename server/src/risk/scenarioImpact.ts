import { query } from "../db.js";

/**
 * Deterministic scenario-level business impact.
 * Finding-level BIAs are inputs only — never double-counted as scenario money
 * when already rolled into linked finding exposure (max, not sum across overlapping).
 * Never invents AED values.
 */
export async function deriveScenarioBusinessImpact(
  orgId: string,
  scenarioId: string,
) {
  const { rows: scen } = await query<{
    title: string;
    business_unit_id: string | null;
    business_process_id: string | null;
    primary_asset_id: string | null;
  }>(
    `SELECT title, business_unit_id, business_process_id, primary_asset_id
     FROM risk_scenarios WHERE org_id=$1 AND scenario_id=$2`,
    [orgId, scenarioId],
  );
  if (!scen[0]) throw Object.assign(new Error("Scenario not found"), { statusCode: 404 });

  const { rows: assets } = await query<{
    name: string;
    criticality: string;
    internet_exposed: boolean;
  }>(
    `SELECT a.name, a.criticality::text, a.internet_exposed
     FROM risk_scenario_assets ra
     JOIN assets a ON a.asset_id = ra.asset_id AND a.org_id = ra.org_id
     WHERE ra.org_id=$1 AND ra.scenario_id=$2`,
    [orgId, scenarioId],
  );

  const { rows: bp } = await query<{
    business_process_id: string;
    name: string;
    criticality: string;
  }>(
    `SELECT bp.business_process_id, bp.name, bp.criticality::text
     FROM business_processes bp
     WHERE bp.org_id=$1 AND (
       bp.business_process_id = $2
       OR bp.business_process_id IN (
         SELECT abp.business_process_id FROM asset_business_processes abp
         JOIN risk_scenario_assets ra ON ra.asset_id = abp.asset_id AND ra.org_id = abp.org_id
         WHERE ra.org_id=$1 AND ra.scenario_id=$3
       )
     )
     LIMIT 5`,
    [orgId, scen[0].business_process_id, scenarioId],
  );

  const { rows: bu } = await query<{ business_unit_id: string; name: string }>(
    `SELECT business_unit_id, name FROM business_units
     WHERE org_id=$1 AND business_unit_id = $2`,
    [orgId, scen[0].business_unit_id],
  );

  // Linked finding impacts — take MAX financial (not sum) to avoid double-count
  const { rows: findingImpacts } = await query<{
    financial_exposure_aed: string | null;
    downtime_cost_per_hour_aed: string | null;
    affected_business_unit: string | null;
    compliance_scope_impact: string | null;
  }>(
    `SELECT b.financial_exposure_aed::text, b.downtime_cost_per_hour_aed::text,
            b.affected_business_unit, b.compliance_scope_impact
     FROM risk_scenario_findings rf
     JOIN business_impact_assessments b
       ON b.finding_id = rf.finding_id AND b.org_id = rf.org_id
     WHERE rf.org_id=$1 AND rf.scenario_id=$2`,
    [orgId, scenarioId],
  );

  const financialVals = findingImpacts
    .map((i) => Number(i.financial_exposure_aed))
    .filter((n) => !Number.isNaN(n) && n > 0);
  const financialKnown = financialVals.length > 0;
  const financialExposure = financialKnown ? Math.max(...financialVals) : null;

  const downtimeVals = findingImpacts
    .map((i) => Number(i.downtime_cost_per_hour_aed))
    .filter((n) => !Number.isNaN(n) && n > 0);
  const downtimeKnown = downtimeVals.length > 0;
  const downtimePerHour = downtimeKnown ? Math.max(...downtimeVals) : null;

  const critAsset = assets.some(
    (a) => a.criticality === "critical" || a.criticality === "high",
  );
  const exposed = assets.some((a) => a.internet_exposed);
  const critProcess = bp.some(
    (p) => p.criticality === "critical" || p.criticality === "high",
  );
  const compliance = findingImpacts
    .map((i) => i.compliance_scope_impact)
    .filter(Boolean)
    .join("; ");

  const buName =
    bu[0]?.name ??
    findingImpacts.find((i) => i.affected_business_unit)?.affected_business_unit ??
    null;
  const bpName = bp[0]?.name ?? null;

  let businessCriticality: string = "unknown";
  if (critProcess || assets.some((a) => a.criticality === "critical"))
    businessCriticality = "critical";
  else if (critAsset) businessCriticality = "high";
  else if (assets.length) businessCriticality = "medium";

  const drivers: string[] = [];
  if (critProcess && bpName)
    drivers.push(`critical business process "${bpName}"`);
  else if (bpName) drivers.push(`business process "${bpName}"`);
  if (exposed)
    drivers.push(
      `internet-facing asset "${assets.find((a) => a.internet_exposed)?.name ?? "asset"}"`,
    );
  else if (assets[0]) drivers.push(`affected asset "${assets[0].name}"`);
  if (compliance) drivers.push("linked compliance scope");
  if (!financialKnown) drivers.push("financial exposure unknown");

  const explanation = drivers.length
    ? `Exposure is primarily driven by the ${drivers.slice(0, 3).join(" and the ")}.`
    : "Business impact context is incomplete; financial exposure remains unknown.";

  let confidence = 35;
  if (assets.length) confidence += 15;
  if (bpName) confidence += 15;
  if (buName) confidence += 10;
  if (financialKnown) confidence += 15;
  else confidence -= 5;
  if (compliance) confidence += 10;
  confidence = Math.max(5, Math.min(95, confidence));

  const expectedDowntime =
    critProcess || critAsset ? (exposed ? 8 : 4) : null; // hours heuristic only — not money

  await query(
    `UPDATE scenario_business_impacts SET is_current = false
     WHERE org_id=$1 AND scenario_id=$2 AND is_current = true`,
    [orgId, scenarioId],
  );

  const { rows: ins } = await query<{ scenario_impact_id: string }>(
    `INSERT INTO scenario_business_impacts (
       org_id, scenario_id, financial_exposure_aed, financial_known,
       downtime_cost_per_hour_aed, expected_downtime_hours,
       affected_business_unit_id, affected_business_process_id,
       affected_business_unit, affected_business_process,
       business_criticality, regulatory_impact, data_impact,
       operational_impact, reputational_impact, confidence, explanation,
       evidence_refs, derivation_meta, is_current
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18::jsonb,$19::jsonb,true
     ) RETURNING scenario_impact_id`,
    [
      orgId,
      scenarioId,
      financialExposure,
      financialKnown,
      downtimePerHour,
      expectedDowntime,
      bu[0]?.business_unit_id ?? scen[0].business_unit_id,
      bp[0]?.business_process_id ?? scen[0].business_process_id,
      buName,
      bpName,
      businessCriticality,
      compliance || null,
      compliance ? "Potential data/compliance scope impact from linked findings" : null,
      critAsset || critProcess
        ? "Operational disruption risk on critical assets/processes"
        : "Operational impact not fully characterized",
      critProcess || exposed
        ? "Reputational exposure if customer-facing services are disrupted"
        : null,
      confidence,
      explanation,
      JSON.stringify(
        findingImpacts.length
          ? [{ type: "finding_bia", count: findingImpacts.length }]
          : [{ type: "asset_context", count: assets.length }],
      ),
      JSON.stringify({
        financialAggregation: "max_linked_finding_bia",
        financialKnown,
        assetCount: assets.length,
        processCount: bp.length,
        doubleCountAvoidance: "max_not_sum",
      }),
    ],
  );

  await query(
    `UPDATE risk_scenarios SET current_impact_id = $3, updated_at = now()
     WHERE org_id=$1 AND scenario_id=$2`,
    [orgId, scenarioId, ins[0].scenario_impact_id],
  );

  return getScenarioImpact(orgId, scenarioId);
}

export async function getScenarioImpact(orgId: string, scenarioId: string) {
  const { rows } = await query(
    `SELECT * FROM scenario_business_impacts
     WHERE org_id=$1 AND scenario_id=$2 AND is_current = true
     LIMIT 1`,
    [orgId, scenarioId],
  );
  if (!rows[0]) return null;
  return mapImpact(rows[0]);
}

function mapImpact(r: Record<string, unknown>) {
  return {
    scenarioImpactId: r.scenario_impact_id,
    scenarioId: r.scenario_id,
    financialExposureAed:
      r.financial_exposure_aed != null ? Number(r.financial_exposure_aed) : null,
    financialKnown: !!r.financial_known,
    financialStatus: r.financial_known ? "known" : "unknown",
    downtimeCostPerHourAed:
      r.downtime_cost_per_hour_aed != null
        ? Number(r.downtime_cost_per_hour_aed)
        : null,
    expectedDowntimeHours:
      r.expected_downtime_hours != null ? Number(r.expected_downtime_hours) : null,
    affectedBusinessUnit: r.affected_business_unit,
    affectedBusinessProcess: r.affected_business_process,
    businessCriticality: r.business_criticality,
    regulatoryImpact: r.regulatory_impact,
    dataImpact: r.data_impact,
    operationalImpact: r.operational_impact,
    reputationalImpact: r.reputational_impact,
    confidence: r.confidence != null ? Number(r.confidence) : null,
    explanation: String(r.explanation ?? ""),
    evidenceRefs: r.evidence_refs,
    derivationMeta: r.derivation_meta,
    calculatedAt: r.calculated_at,
  };
}
