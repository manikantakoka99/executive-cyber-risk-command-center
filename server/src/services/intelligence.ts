import { createHash } from "node:crypto";
import { query } from "../db.js";
import { getOverview } from "./overview.js";

export type PortfolioFilters = {
  businessUnit?: string;
  businessProcess?: string;
  domain?: string;
  assetCriticality?: string;
  priority?: string;
  tolerance?: string;
  status?: string;
  periodDays?: number;
};

/** Enterprise portfolio — never averages domain scores. */
export async function getPortfolio(orgId: string, filters: PortfolioFilters = {}) {
  const params: unknown[] = [orgId];
  const activeWhere = ["s.org_id = $1"];

  if (filters.businessUnit) {
    params.push(filters.businessUnit);
    activeWhere.push(`s.business_unit_id::text = $${params.length}`);
  }
  if (filters.businessProcess) {
    params.push(filters.businessProcess);
    activeWhere.push(`s.business_process_id::text = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    activeWhere.push(`s.priority::text = $${params.length}`);
  }
  if (filters.tolerance) {
    params.push(filters.tolerance);
    activeWhere.push(`s.tolerance_state::text = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    activeWhere.push(`s.status::text = $${params.length}`);
  }
  if (filters.domain) {
    params.push(filters.domain);
    activeWhere.push(`EXISTS (
      SELECT 1 FROM risk_scenario_domains rd
      JOIN risk_domains d ON d.risk_domain_id = rd.risk_domain_id
      WHERE rd.scenario_id = s.scenario_id AND rd.org_id = s.org_id
        AND d.code::text = $${params.length})`);
  }
  if (filters.assetCriticality) {
    params.push(filters.assetCriticality);
    activeWhere.push(`EXISTS (
      SELECT 1 FROM risk_scenario_assets ra
      JOIN assets a ON a.asset_id = ra.asset_id AND a.org_id = ra.org_id
      WHERE ra.scenario_id = s.scenario_id AND ra.org_id = s.org_id
        AND a.criticality::text = $${params.length})`);
  }
  if (filters.periodDays) {
    params.push(filters.periodDays);
    activeWhere.push(`s.last_seen_at >= now() - ($${params.length}::text || ' days')::interval`);
  }

  const { rows: stats } = await query<{
    active: string;
    critical: string;
    high: string;
    medium: string;
    low: string;
    outside: string;
    increasing: string;
    aging: string;
    accepted: string;
    mitigated: string;
    closed: string;
    known_exposure: string | null;
    unknown_financial: string;
    conf_high: string;
    conf_med: string;
    conf_low: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE s.status NOT IN ('closed','accepted','mitigated'))::text AS active,
       COUNT(*) FILTER (WHERE s.priority = 'critical')::text AS critical,
       COUNT(*) FILTER (WHERE s.priority = 'high')::text AS high,
       COUNT(*) FILTER (WHERE s.priority = 'medium')::text AS medium,
       COUNT(*) FILTER (WHERE s.priority = 'low' OR s.priority IS NULL)::text AS low,
       COUNT(*) FILTER (WHERE s.tolerance_state = 'outside')::text AS outside,
       COUNT(*) FILTER (WHERE s.velocity = 'increasing')::text AS increasing,
       COUNT(*) FILTER (WHERE s.velocity = 'aging')::text AS aging,
       COUNT(*) FILTER (WHERE s.status = 'accepted')::text AS accepted,
       COUNT(*) FILTER (WHERE s.status IN ('mitigated','mitigating'))::text AS mitigated,
       COUNT(*) FILTER (WHERE s.status = 'closed')::text AS closed,
       SUM(CASE WHEN sbi.financial_known THEN sbi.financial_exposure_aed ELSE 0 END)::text AS known_exposure,
       COUNT(*) FILTER (WHERE sbi.scenario_impact_id IS NOT NULL AND NOT sbi.financial_known)::text AS unknown_financial,
       COUNT(*) FILTER (WHERE ra.confidence >= 75)::text AS conf_high,
       COUNT(*) FILTER (WHERE ra.confidence >= 50 AND ra.confidence < 75)::text AS conf_med,
       COUNT(*) FILTER (WHERE ra.confidence IS NOT NULL AND ra.confidence < 50)::text AS conf_low
     FROM risk_scenarios s
     LEFT JOIN risk_assessments ra ON ra.risk_assessment_id = s.current_assessment_id
     LEFT JOIN scenario_business_impacts sbi ON sbi.scenario_impact_id = s.current_impact_id
     WHERE ${activeWhere.join(" AND ")}`,
    params,
  );

  const { rows: backlog } = await query<{ open_actions: string; overdue: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE a.status IN ('open','pending','in_progress','blocked'))::text AS open_actions,
       COUNT(*) FILTER (
         WHERE a.status IN ('open','pending','in_progress','blocked')
           AND a.due_at IS NOT NULL AND a.due_at < now()
       )::text AS overdue
     FROM actions a
     WHERE a.org_id = $1`,
    [orgId],
  );

  const { rows: top } = await query(
    `SELECT s.scenario_id, s.title, s.priority::text, s.tolerance_state::text,
            s.velocity::text, s.status::text, ra.residual_risk::text, ra.confidence::text,
            sbi.financial_exposure_aed::text, sbi.financial_known,
            sbi.explanation AS impact_explanation,
            rr.recommended_treatment::text, tp.status::text AS treatment_status,
            CASE WHEN u.first_name IS NOT NULL
              THEN trim(u.first_name || ' ' || COALESCE(u.last_name,'')) END AS owner_name,
            ed.status::text AS decision_status
     FROM risk_scenarios s
     LEFT JOIN risk_assessments ra ON ra.risk_assessment_id = s.current_assessment_id
     LEFT JOIN scenario_business_impacts sbi ON sbi.scenario_impact_id = s.current_impact_id
     LEFT JOIN risk_recommendations rr ON rr.recommendation_id = s.current_recommendation_id
     LEFT JOIN treatment_plans tp ON tp.treatment_plan_id = s.current_treatment_plan_id
     LEFT JOIN users u ON u.user_id = tp.owner_user_id
     LEFT JOIN LATERAL (
       SELECT status FROM executive_decisions
       WHERE org_id = s.org_id AND scenario_id = s.scenario_id
       ORDER BY escalated_at DESC LIMIT 1
     ) ed ON true
     WHERE ${activeWhere.join(" AND ")}
       AND s.status NOT IN ('closed')
     ORDER BY COALESCE(s.priority_score, 0) DESC, COALESCE(ra.residual_risk, 0) DESC
     LIMIT 15`,
    params,
  );

  const s = stats[0];
  return {
    asOf: new Date().toISOString(),
    methodology:
      "Portfolio aggregates Risk Scenarios only — does not average domain scores.",
    filters,
    totals: {
      activeScenarios: Number(s?.active ?? 0),
      byPriority: {
        critical: Number(s?.critical ?? 0),
        high: Number(s?.high ?? 0),
        medium: Number(s?.medium ?? 0),
        low: Number(s?.low ?? 0),
      },
      outsideTolerance: Number(s?.outside ?? 0),
      increasing: Number(s?.increasing ?? 0),
      aging: Number(s?.aging ?? 0),
      accepted: Number(s?.accepted ?? 0),
      mitigated: Number(s?.mitigated ?? 0),
      closed: Number(s?.closed ?? 0),
      knownFinancialExposureAed:
        s?.known_exposure != null ? Number(s.known_exposure) : null,
      unknownFinancialExposureCount: Number(s?.unknown_financial ?? 0),
      confidence: {
        high: Number(s?.conf_high ?? 0),
        medium: Number(s?.conf_med ?? 0),
        low: Number(s?.conf_low ?? 0),
      },
      remediationBacklog: Number(backlog[0]?.open_actions ?? 0),
      overdueActions: Number(backlog[0]?.overdue ?? 0),
    },
    topRisks: top.map((r) => ({
      scenarioId: r.scenario_id,
      title: r.title,
      priority: r.priority,
      residualRisk: r.residual_risk != null ? Number(r.residual_risk) : null,
      toleranceState: r.tolerance_state,
      confidence: r.confidence != null ? Number(r.confidence) : null,
      velocity: r.velocity,
      status: r.status,
      financialExposureAed:
        r.financial_known && r.financial_exposure_aed != null
          ? Number(r.financial_exposure_aed)
          : null,
      financialKnown: !!r.financial_known,
      businessImpact: r.impact_explanation,
      recommendedTreatment: r.recommended_treatment,
      treatmentStatus: r.treatment_status,
      owner: r.owner_name,
      decisionStatus: r.decision_status,
    })),
  };
}

const WINDOW_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  quarter: 90,
  year: 365,
};

export async function getTrends(orgId: string, window = "30d") {
  const days = WINDOW_DAYS[window] ?? 30;
  const { rows: assessments } = await query<{
    day: Date;
    avg_residual: string | null;
    avg_inherent: string | null;
    n: string;
  }>(
    `SELECT date_trunc('day', calculated_at) AS day,
            AVG(residual_risk)::text AS avg_residual,
            AVG(inherent_risk)::text AS avg_inherent,
            COUNT(*)::text AS n
     FROM risk_assessments
     WHERE org_id = $1 AND is_current = true
       AND calculated_at >= now() - ($2::text || ' days')::interval
     GROUP BY 1 ORDER BY 1`,
    [orgId, String(days)],
  );

  // Prefer history across all assessments for residual trend if enough points
  const { rows: hist } = await query<{
    day: Date;
    avg_residual: string | null;
    n: string;
  }>(
    `SELECT date_trunc('day', calculated_at) AS day,
            AVG(residual_risk)::text AS avg_residual,
            COUNT(*)::text AS n
     FROM risk_assessments
     WHERE org_id = $1
       AND calculated_at >= now() - ($2::text || ' days')::interval
     GROUP BY 1 ORDER BY 1`,
    [orgId, String(days)],
  );

  const { rows: scenarioMoves } = await query<{
    new_count: string;
    resolved_count: string;
    accepted_count: string;
    outside_now: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE first_seen_at >= now() - ($2::text || ' days')::interval)::text AS new_count,
       COUNT(*) FILTER (
         WHERE status IN ('closed','mitigated') AND updated_at >= now() - ($2::text || ' days')::interval
       )::text AS resolved_count,
       COUNT(*) FILTER (
         WHERE status = 'accepted' AND updated_at >= now() - ($2::text || ' days')::interval
       )::text AS accepted_count,
       COUNT(*) FILTER (WHERE tolerance_state = 'outside' AND status NOT IN ('closed'))::text AS outside_now
     FROM risk_scenarios WHERE org_id = $1`,
    [orgId, String(days)],
  );

  const { rows: verified } = await query<{ n: string; avg_delta: string | null }>(
    `SELECT COUNT(*)::text AS n,
            AVG(previous_residual_risk - verified_residual_risk)::text AS avg_delta
     FROM risk_verifications
     WHERE org_id = $1 AND verification_status = 'verified'
       AND verified_at >= now() - ($2::text || ' days')::interval
       AND previous_residual_risk IS NOT NULL AND verified_residual_risk IS NOT NULL`,
    [orgId, String(days)],
  );

  const series = hist.length >= 2 ? hist : assessments;
  const insufficient = series.length < 2;

  return {
    window,
    days,
    insufficientHistory: insufficient,
    message: insufficient
      ? "Insufficient historical data"
      : `Trend from ${series.length} daily buckets over ${days} days`,
    residualTrend: insufficient
      ? []
      : series.map((r) => ({
          date: r.day,
          avgResidual: r.avg_residual != null ? Number(r.avg_residual) : null,
          sampleSize: Number(r.n),
        })),
    inherentVsResidual: insufficient
      ? []
      : assessments.map((r) => ({
          date: r.day,
          avgInherent: r.avg_inherent != null ? Number(r.avg_inherent) : null,
          avgResidual: r.avg_residual != null ? Number(r.avg_residual) : null,
        })),
    scenarioVelocity: {
      newScenarios: Number(scenarioMoves[0]?.new_count ?? 0),
      resolvedScenarios: Number(scenarioMoves[0]?.resolved_count ?? 0),
      acceptedRisks: Number(scenarioMoves[0]?.accepted_count ?? 0),
      outsideToleranceNow: Number(scenarioMoves[0]?.outside_now ?? 0),
    },
    remediationEffectiveness: {
      verifiedCount: Number(verified[0]?.n ?? 0),
      avgResidualReduction:
        verified[0]?.avg_delta != null ? Number(verified[0].avg_delta) : null,
      note:
        Number(verified[0]?.n ?? 0) === 0
          ? "Insufficient historical data for remediation effectiveness"
          : "Average residual reduction after verified remediation",
    },
  };
}

export async function getHotspots(orgId: string) {
  const { rows: highTotal } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM risk_scenarios s
     JOIN risk_assessments ra ON ra.risk_assessment_id = s.current_assessment_id
     WHERE s.org_id = $1 AND s.status NOT IN ('closed')
       AND (s.priority IN ('critical','high') OR ra.residual_risk >= 60)`,
    [orgId],
  );
  const denom = Math.max(1, Number(highTotal[0]?.n ?? 0));

  const { rows: byBu } = await query<{
    business_unit_id: string | null;
    name: string | null;
    n: string;
  }>(
    `SELECT s.business_unit_id, bu.name, COUNT(*)::text AS n
     FROM risk_scenarios s
     LEFT JOIN business_units bu ON bu.business_unit_id = s.business_unit_id AND bu.org_id = s.org_id
     JOIN risk_assessments ra ON ra.risk_assessment_id = s.current_assessment_id
     WHERE s.org_id = $1 AND s.status NOT IN ('closed')
       AND (s.priority IN ('critical','high') OR ra.residual_risk >= 60)
     GROUP BY 1, 2 ORDER BY COUNT(*) DESC LIMIT 8`,
    [orgId],
  );

  const { rows: byBp } = await query<{
    business_process_id: string | null;
    name: string | null;
    outside: string;
    n: string;
  }>(
    `SELECT s.business_process_id, bp.name,
            COUNT(*) FILTER (WHERE s.tolerance_state = 'outside')::text AS outside,
            COUNT(*)::text AS n
     FROM risk_scenarios s
     LEFT JOIN business_processes bp
       ON bp.business_process_id = s.business_process_id AND bp.org_id = s.org_id
     WHERE s.org_id = $1 AND s.status NOT IN ('closed')
     GROUP BY 1, 2
     HAVING COUNT(*) > 0
     ORDER BY COUNT(*) FILTER (WHERE s.tolerance_state = 'outside') DESC, COUNT(*) DESC
     LIMIT 8`,
    [orgId],
  );

  const { rows: byDomain } = await query<{
    code: string;
    short_label: string;
    n: string;
  }>(
    `SELECT d.code::text, d.short_label, COUNT(DISTINCT s.scenario_id)::text AS n
     FROM risk_scenario_domains rd
     JOIN risk_domains d ON d.risk_domain_id = rd.risk_domain_id
     JOIN risk_scenarios s ON s.scenario_id = rd.scenario_id AND s.org_id = rd.org_id
     WHERE rd.org_id = $1 AND s.status NOT IN ('closed')
       AND s.priority IN ('critical','high')
     GROUP BY 1, 2 ORDER BY COUNT(*) DESC LIMIT 8`,
    [orgId],
  );

  const statements: string[] = [];
  if (byBu[0] && Number(byBu[0].n) > 0) {
    const pct = Math.round((Number(byBu[0].n) / denom) * 100);
    const name = byBu[0].name ?? "unassigned business unit";
    statements.push(
      `${pct}% of high residual risk scenarios are concentrated in ${name} (denominator: ${denom} high/critical scenarios).`,
    );
  }
  for (const bp of byBp.filter((b) => Number(b.outside) > 0).slice(0, 2)) {
    statements.push(
      `${bp.name ?? "Unnamed process"} contains ${bp.outside} outside-tolerance scenario(s) of ${bp.n} active in that process.`,
    );
  }

  return {
    asOf: new Date().toISOString(),
    denominatorHighCritical: denom,
    statements,
    byBusinessUnit: byBu.map((r) => ({
      businessUnitId: r.business_unit_id,
      name: r.name ?? "Unassigned",
      highCriticalCount: Number(r.n),
      shareOfHighCritical: Math.round((Number(r.n) / denom) * 100),
    })),
    byBusinessProcess: byBp.map((r) => ({
      businessProcessId: r.business_process_id,
      name: r.name ?? "Unassigned",
      scenarioCount: Number(r.n),
      outsideTolerance: Number(r.outside),
    })),
    byDomain: byDomain.map((r) => ({
      code: r.code,
      label: r.short_label,
      highCriticalScenarios: Number(r.n),
    })),
  };
}

export async function getDecisionCenter(orgId: string) {
  const { rows } = await query(
    `SELECT ed.decision_id, ed.scenario_id, ed.title, ed.status::text, ed.priority::text,
            ed.risk_summary, ed.impact_summary, ed.recommended_action, ed.treatment_type::text,
            ed.escalated_at, ed.decided_at, ed.rationale,
            s.tolerance_state::text, ra.residual_risk::text,
            sbi.financial_exposure_aed::text, sbi.financial_known,
            tp.target_date,
            CASE WHEN u.first_name IS NOT NULL
              THEN trim(u.first_name || ' ' || COALESCE(u.last_name,'')) END AS owner_name
     FROM executive_decisions ed
     LEFT JOIN risk_scenarios s ON s.scenario_id = ed.scenario_id AND s.org_id = ed.org_id
     LEFT JOIN risk_assessments ra ON ra.risk_assessment_id = s.current_assessment_id
     LEFT JOIN scenario_business_impacts sbi ON sbi.scenario_impact_id = s.current_impact_id
     LEFT JOIN treatment_plans tp ON tp.treatment_plan_id = ed.treatment_plan_id
     LEFT JOIN users u ON u.user_id = COALESCE(ed.decision_owner_user_id, tp.owner_user_id)
     WHERE ed.org_id = $1
     ORDER BY
       CASE ed.status
         WHEN 'awaiting_decision' THEN 0
         WHEN 'info_requested' THEN 1
         ELSE 2 END,
       ed.escalated_at DESC
     LIMIT 100`,
    [orgId],
  );

  const map = (r: Record<string, unknown>) => ({
    decisionId: r.decision_id,
    scenarioId: r.scenario_id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    what: r.title,
    why: r.risk_summary,
    businessImpact: r.impact_summary,
    residualRisk: r.residual_risk != null ? Number(r.residual_risk) : null,
    toleranceState: r.tolerance_state,
    recommendedTreatment: r.treatment_type ?? r.recommended_action,
    owner: r.owner_name,
    dueDate: r.target_date ? String(r.target_date).slice(0, 10) : null,
    financialExposureAed:
      r.financial_known && r.financial_exposure_aed != null
        ? Number(r.financial_exposure_aed)
        : null,
    escalatedAt: r.escalated_at,
  });

  const all = rows.map(map);
  return {
    awaitingAction: all.filter((d) => d.status === "awaiting_decision"),
    awaitingInformation: all.filter((d) => d.status === "info_requested"),
    recentlyApproved: all.filter((d) => d.status === "approved").slice(0, 10),
    acceptedRisks: all.filter((d) => d.status === "accepted_risk"),
    declined: all.filter((d) => d.status === "declined"),
    monitored: all.filter((d) =>
      ["monitoring", "acknowledged"].includes(d.status as string),
    ),
    overdue: all.filter(
      (d) =>
        d.dueDate &&
        new Date(d.dueDate) < new Date() &&
        ["awaiting_decision", "info_requested", "approved"].includes(
          d.status as string,
        ),
    ),
  };
}

export async function getCompliancePosture(orgId: string) {
  const { rows: frameworks } = await query(
    `SELECT DISTINCT ON (f.framework_id)
            f.framework_id, f.code::text, f.display_name,
            c.coverage_pct::text, c.controls_total, c.controls_evidenced,
            c.next_renewal_date, c.snapshot_at
     FROM compliance_frameworks f
     JOIN org_compliance_status c ON c.framework_id = f.framework_id
     WHERE c.org_id = $1
     ORDER BY f.framework_id, c.snapshot_at DESC`,
    [orgId],
  );

  const { rows: assessments } = await query(
    `SELECT ca.assessment_id, ca.status, ca.coverage_pct::text, ca.gap_summary,
            ca.assessed_at, ca.scenario_id, ca.evidence_id,
            f.code::text AS framework_code, fc.control_code, fc.title AS control_title
     FROM compliance_assessments ca
     JOIN compliance_frameworks f ON f.framework_id = ca.framework_id
     LEFT JOIN framework_controls fc ON fc.framework_control_id = ca.framework_control_id
     WHERE ca.org_id = $1
     ORDER BY ca.assessed_at DESC LIMIT 50`,
    [orgId],
  );

  const avg =
    frameworks.length === 0
      ? null
      : frameworks.reduce((s, f) => s + Number(f.coverage_pct ?? 0), 0) /
        frameworks.length;

  const stale = frameworks.filter((f) => {
    const age =
      (Date.now() - new Date(f.snapshot_at).getTime()) / 86400000;
    return age > 90;
  });

  return {
    asOf: new Date().toISOString(),
    note: "Compliance posture is separate from enterprise cyber risk. Coverage % is not a safety score.",
    averageCoveragePct: avg != null ? Math.round(avg * 100) / 100 : null,
    frameworks: frameworks.map((f) => ({
      frameworkId: f.framework_id,
      code: f.code,
      displayName: f.display_name,
      coveragePct: Number(f.coverage_pct),
      controlsTotal: f.controls_total,
      controlsEvidenced: f.controls_evidenced,
      missingEvidence: Math.max(
        0,
        Number(f.controls_total) - Number(f.controls_evidenced),
      ),
      nextRenewalDate: f.next_renewal_date,
      snapshotAt: f.snapshot_at,
      freshness:
        (Date.now() - new Date(f.snapshot_at).getTime()) / 86400000 > 90
          ? "stale"
          : "current",
    })),
    assessments: assessments.map((a) => ({
      assessmentId: a.assessment_id,
      status: a.status,
      coveragePct: a.coverage_pct != null ? Number(a.coverage_pct) : null,
      gapSummary: a.gap_summary,
      frameworkCode: a.framework_code,
      controlCode: a.control_code,
      controlTitle: a.control_title,
      scenarioId: a.scenario_id,
      evidenceId: a.evidence_id,
      assessedAt: a.assessed_at,
    })),
    staleFrameworkCount: stale.length,
    relationships: assessments
      .filter((a) => a.scenario_id)
      .slice(0, 20)
      .map((a) => ({
        complianceGap: a.gap_summary ?? a.status,
        control: a.control_code ?? a.framework_code,
        scenarioId: a.scenario_id,
      })),
  };
}

export async function getControlPosture(orgId: string) {
  const { rows } = await query<{ effectiveness: string; n: string }>(
    `SELECT COALESCE(sc.effectiveness::text, 'unknown') AS effectiveness, COUNT(*)::text AS n
     FROM scenario_controls sc
     WHERE sc.org_id = $1
     GROUP BY 1`,
    [orgId],
  );
  const { rows: critical } = await query(
    `SELECT c.control_id, c.name, sc.effectiveness::text, sc.evidence_note,
            s.scenario_id, s.title, s.priority::text
     FROM scenario_controls sc
     JOIN controls c ON c.control_id = sc.control_id AND c.org_id = sc.org_id
     JOIN risk_scenarios s ON s.scenario_id = sc.scenario_id AND s.org_id = sc.org_id
     WHERE sc.org_id = $1
       AND s.priority IN ('critical','high')
       AND s.status NOT IN ('closed')
     ORDER BY s.priority_score DESC NULLS LAST
     LIMIT 40`,
    [orgId],
  );
  const counts: Record<string, number> = {
    effective: 0,
    partially_effective: 0,
    ineffective: 0,
    unknown: 0,
  };
  for (const r of rows) counts[r.effectiveness] = Number(r.n);

  return {
    asOf: new Date().toISOString(),
    counts,
    supportingCriticalScenarios: critical.map((r) => ({
      controlId: r.control_id,
      name: r.name,
      effectiveness: r.effectiveness,
      evidenceNote: r.evidence_note,
      scenarioId: r.scenario_id,
      scenarioTitle: r.title,
      priority: r.priority,
    })),
    missingEvidence: critical.filter(
      (r) => !r.evidence_note || r.effectiveness === "unknown",
    ).length,
  };
}

export async function getBusinessUnitView(orgId: string, unitId: string) {
  const { rows: bu } = await query(
    `SELECT * FROM business_units WHERE org_id=$1 AND business_unit_id=$2`,
    [orgId, unitId],
  );
  if (!bu[0]) return null;
  const portfolio = await getPortfolio(orgId, { businessUnit: unitId });
  const { rows: processes } = await query(
    `SELECT business_process_id, name, criticality::text FROM business_processes
     WHERE org_id=$1 AND business_unit_id=$2 ORDER BY name`,
    [orgId, unitId],
  );
  return {
    businessUnit: {
      id: bu[0].business_unit_id,
      code: bu[0].code,
      name: bu[0].name,
    },
    portfolio: portfolio.totals,
    topRisks: portfolio.topRisks,
    processes: processes.map((p) => ({
      id: p.business_process_id,
      name: p.name,
      criticality: p.criticality,
    })),
  };
}

export async function getBusinessProcessView(orgId: string, processId: string) {
  const { rows: bp } = await query(
    `SELECT * FROM business_processes WHERE org_id=$1 AND business_process_id=$2`,
    [orgId, processId],
  );
  if (!bp[0]) return null;
  const portfolio = await getPortfolio(orgId, { businessProcess: processId });
  const { rows: assets } = await query(
    `SELECT a.asset_id, a.name, a.criticality::text, a.internet_exposed
     FROM asset_business_processes abp
     JOIN assets a ON a.asset_id = abp.asset_id AND a.org_id = abp.org_id
     WHERE abp.org_id=$1 AND abp.business_process_id=$2`,
    [orgId, processId],
  );
  const { rows: weaknesses } = await query(
    `SELECT c.name, sc.effectiveness::text, s.title
     FROM risk_scenarios s
     JOIN scenario_controls sc ON sc.scenario_id = s.scenario_id AND sc.org_id = s.org_id
     JOIN controls c ON c.control_id = sc.control_id
     WHERE s.org_id=$1 AND s.business_process_id=$2
       AND sc.effectiveness IN ('ineffective','partially_effective','unknown')`,
    [orgId, processId],
  );
  return {
    businessProcess: {
      id: bp[0].business_process_id,
      name: bp[0].name,
      criticality: bp[0].criticality,
      businessUnitId: bp[0].business_unit_id,
    },
    supportingAssets: assets,
    portfolio: portfolio.totals,
    topRisks: portfolio.topRisks,
    controlWeaknesses: weaknesses,
  };
}

export async function detectMaterialChanges(orgId: string) {
  const inserted: string[] = [];
  const threshold = 10;

  // Outside tolerance scenarios (recent)
  const { rows: outside } = await query<{
    scenario_id: string;
    title: string;
    residual_risk: string | null;
  }>(
    `SELECT s.scenario_id, s.title, ra.residual_risk::text
     FROM risk_scenarios s
     LEFT JOIN risk_assessments ra ON ra.risk_assessment_id = s.current_assessment_id
     WHERE s.org_id=$1 AND s.tolerance_state='outside'
       AND s.status NOT IN ('closed','accepted')
       AND s.updated_at >= now() - interval '7 days'`,
    [orgId],
  );
  for (const s of outside) {
    const id = await upsertMaterialChange(orgId, {
      reasonCode: "RESIDUAL_CROSSED_TOLERANCE",
      severity: "high",
      entityType: "risk_scenario",
      entityId: s.scenario_id,
      summary: `Scenario outside tolerance: ${s.title}`,
      details: { residual: s.residual_risk },
    });
    if (id) inserted.push(id);
  }

  const { rows: criticalNew } = await query<{ scenario_id: string; title: string }>(
    `SELECT scenario_id, title FROM risk_scenarios
     WHERE org_id=$1 AND priority='critical'
       AND first_seen_at >= now() - interval '7 days'`,
    [orgId],
  );
  for (const s of criticalNew) {
    const id = await upsertMaterialChange(orgId, {
      reasonCode: "NEW_CRITICAL_SCENARIO",
      severity: "critical",
      entityType: "risk_scenario",
      entityId: s.scenario_id,
      summary: `New critical scenario: ${s.title}`,
      details: {},
    });
    if (id) inserted.push(id);
  }

  const { rows: verified } = await query<{
    verification_id: string;
    scenario_id: string;
    previous_residual_risk: string | null;
    verified_residual_risk: string | null;
  }>(
    `SELECT verification_id, scenario_id, previous_residual_risk::text, verified_residual_risk::text
     FROM risk_verifications
     WHERE org_id=$1 AND verification_status='verified'
       AND verified_at >= now() - interval '7 days'`,
    [orgId],
  );
  for (const v of verified) {
    const id = await upsertMaterialChange(orgId, {
      reasonCode: "REMEDIATION_VERIFIED",
      severity: "medium",
      entityType: "risk_verification",
      entityId: v.verification_id,
      summary: `Remediation verified; residual ${v.previous_residual_risk} → ${v.verified_residual_risk}`,
      details: {
        scenarioId: v.scenario_id,
        previous: v.previous_residual_risk,
        verified: v.verified_residual_risk,
      },
    });
    if (id) inserted.push(id);
  }

  const { rows: increasing } = await query<{
    scenario_id: string;
    title: string;
    residual_risk: string | null;
  }>(
    `SELECT s.scenario_id, s.title, ra.residual_risk::text
     FROM risk_scenarios s
     LEFT JOIN risk_assessments ra ON ra.risk_assessment_id = s.current_assessment_id
     WHERE s.org_id=$1 AND s.velocity='increasing' AND s.status NOT IN ('closed')`,
    [orgId],
  );
  for (const s of increasing) {
    const id = await upsertMaterialChange(orgId, {
      reasonCode: "MATERIAL_RISK_INCREASE",
      severity: "high",
      entityType: "risk_scenario",
      entityId: s.scenario_id,
      summary: `Increasing risk velocity: ${s.title}`,
      details: { residual: s.residual_risk, threshold },
    });
    if (id) inserted.push(id);
  }

  const { rows: ineffective } = await query<{
    scenario_id: string;
    control_id: string;
    name: string;
  }>(
    `SELECT sc.scenario_id, sc.control_id, c.name
     FROM scenario_controls sc
     JOIN controls c ON c.control_id = sc.control_id
     WHERE sc.org_id=$1 AND sc.effectiveness='ineffective'`,
    [orgId],
  );
  for (const c of ineffective.slice(0, 20)) {
    const id = await upsertMaterialChange(orgId, {
      reasonCode: "CONTROL_INEFFECTIVE",
      severity: "high",
      entityType: "control",
      entityId: c.control_id,
      summary: `Ineffective control "${c.name}" on an active scenario`,
      details: { scenarioId: c.scenario_id },
    });
    if (id) inserted.push(id);
  }

  return listMaterialChanges(orgId, 50);
}

async function upsertMaterialChange(
  orgId: string,
  body: {
    reasonCode: string;
    severity: string;
    entityType: string;
    entityId: string;
    summary: string;
    details: unknown;
  },
) {
  // Deduplicate same reason+entity within 24h
  const { rows: existing } = await query<{ material_change_id: string }>(
    `SELECT material_change_id FROM material_changes
     WHERE org_id=$1 AND reason_code=$2 AND entity_id=$3
       AND detected_at >= now() - interval '24 hours'
     LIMIT 1`,
    [orgId, body.reasonCode, body.entityId],
  );
  if (existing[0]) return null;
  const { rows } = await query<{ material_change_id: string }>(
    `INSERT INTO material_changes
       (org_id, reason_code, severity, entity_type, entity_id, summary, details)
     VALUES ($1,$2,$3::material_change_severity,$4,$5,$6,$7::jsonb)
     RETURNING material_change_id`,
    [
      orgId,
      body.reasonCode,
      body.severity,
      body.entityType,
      body.entityId,
      body.summary,
      JSON.stringify(body.details ?? {}),
    ],
  );
  return rows[0].material_change_id;
}

export async function listMaterialChanges(orgId: string, limit = 50) {
  const { rows } = await query(
    `SELECT * FROM material_changes WHERE org_id=$1
     ORDER BY detected_at DESC LIMIT $2`,
    [orgId, limit],
  );
  return rows.map((r) => ({
    materialChangeId: r.material_change_id,
    reasonCode: r.reason_code,
    severity: r.severity,
    entityType: r.entity_type,
    entityId: r.entity_id,
    summary: r.summary,
    details: r.details,
    detectedAt: r.detected_at,
  }));
}

export async function getExecutiveBriefing(orgId: string) {
  const [portfolio, trends, hotspots, decisions, compliance, changes] =
    await Promise.all([
      getPortfolio(orgId),
      getTrends(orgId, "30d"),
      getHotspots(orgId),
      getDecisionCenter(orgId),
      getCompliancePosture(orgId),
      detectMaterialChanges(orgId),
    ]);

  const outside = portfolio.totals.outsideTolerance;
  const increasing = portfolio.totals.increasing;
  const awaiting = decisions.awaitingAction.length;
  const residualBand =
    portfolio.topRisks[0]?.residualRisk != null &&
    portfolio.topRisks[0].residualRisk >= 60
      ? "High"
      : portfolio.topRisks[0]?.residualRisk != null &&
          portfolio.topRisks[0].residualRisk >= 35
        ? "Medium"
        : portfolio.topRisks.length
          ? "Low"
          : "Unknown";

  const facts = {
    residualBand,
    outsideTolerance: outside,
    increasing,
    awaitingDecisions: awaiting,
    knownExposure: portfolio.totals.knownFinancialExposureAed,
    unknownFinancialCount: portfolio.totals.unknownFinancialExposureCount,
    hotspotStatement: hotspots.statements[0] ?? null,
    complianceAvg: compliance.averageCoveragePct,
    verifiedRemediations: trends.remediationEffectiveness.verifiedCount,
    insufficientTrendHistory: trends.insufficientHistory,
  };

  return {
    asOf: new Date().toISOString(),
    generatedFrom: "structured_facts_only",
    sections: {
      currentPosture: {
        text: `Residual enterprise risk posture (scenario-led) is ${facts.residualBand}.`,
        evidence: {
          topResidual: portfolio.topRisks[0]?.residualRisk ?? null,
          activeScenarios: portfolio.totals.activeScenarios,
        },
      },
      whatChanged: {
        text: trends.insufficientHistory
          ? "Insufficient historical data to characterize period-over-period change."
          : `${increasing} high-priority scenario(s) show increasing velocity; ${trends.scenarioVelocity.newScenarios} new scenario(s) in window.`,
        evidence: trends.scenarioVelocity,
      },
      whatMatters: {
        text: `${outside} outside-tolerance scenario(s) require attention${
          hotspots.statements[0] ? `; ${hotspots.statements[0]}` : "."
        }`,
        evidence: {
          outside,
          hotspot: hotspots.statements[0] ?? null,
        },
      },
      whatNeedsDecision: {
        text:
          awaiting > 0
            ? `${awaiting} decision(s) await executive action.`
            : "No decisions currently awaiting CXO action.",
        evidence: { awaiting },
      },
      whatToWatch: {
        text:
          hotspots.statements[1] ??
          hotspots.statements[0] ??
          "Monitor remediation backlog and connector freshness.",
        evidence: {
          overdueActions: portfolio.totals.overdueActions,
          backlog: portfolio.totals.remediationBacklog,
        },
      },
    },
    facts,
    recentMaterialChanges: changes.slice(0, 8),
  };
}

export async function getConnectorCatalog(orgId: string) {
  const { rows } = await query(
    `SELECT c.connector_id, c.name, c.adapter_key, c.status::text, c.last_success_at,
            c.last_failure_at, c.last_sync_at, d.code::text AS domain_code, d.short_label,
            (SELECT COUNT(*) FROM security_signals s WHERE s.connector_id = c.connector_id AND s.org_id = c.org_id) AS signal_count,
            (SELECT COUNT(*) FROM connector_sync_runs r WHERE r.connector_id = c.connector_id AND r.org_id = c.org_id AND r.status = 'failed'
               AND r.started_at >= now() - interval '7 days') AS recent_failures
     FROM connectors c
     JOIN risk_domains d ON d.risk_domain_id = c.risk_domain_id
     WHERE c.org_id = $1
     ORDER BY d.short_label, c.name`,
    [orgId],
  );

  const { rows: subscribed } = await query<{ code: string; short_label: string }>(
    `SELECT d.code::text, d.short_label
     FROM org_domain_subscriptions sub
     JOIN risk_domains d ON d.risk_domain_id = sub.risk_domain_id
     WHERE sub.org_id=$1 AND sub.is_active`,
    [orgId],
  );

  return {
    connectors: rows.map((c) => {
      const hoursSinceSuccess = c.last_success_at
        ? (Date.now() - new Date(c.last_success_at).getTime()) / 3600000
        : null;
      let health: string = "configured";
      if (c.status === "error" || c.status === "failed") health = "failed";
      else if (hoursSinceSuccess != null && hoursSinceSuccess > 72) health = "degraded";
      else if (c.last_success_at) health = "connected";
      else if (!c.last_sync_at) health = "not_configured";
      return {
        connectorId: c.connector_id,
        name: c.name,
        adapterKey: c.adapter_key,
        domainCode: c.domain_code,
        domainLabel: c.short_label,
        status: c.status,
        health,
        lastSuccessAt: c.last_success_at,
        lastFailureAt: c.last_failure_at,
        lastSyncAt: c.last_sync_at,
        signalCount: Number(c.signal_count),
        recentFailures: Number(c.recent_failures),
        stale:
          hoursSinceSuccess != null && hoursSinceSuccess > 72
            ? `Connector has not synchronized successfully for ${Math.floor(hoursSinceSuccess / 24)} day(s).`
            : null,
      };
    }),
    subscribedDomains: subscribed,
  };
}

export async function getOrgSettings(orgId: string) {
  const { rows } = await query(`SELECT * FROM org_settings WHERE org_id=$1`, [orgId]);
  if (!rows[0]) {
    await query(`INSERT INTO org_settings (org_id) VALUES ($1) ON CONFLICT DO NOTHING`, [
      orgId,
    ]);
    return getOrgSettings(orgId);
  }
  const r = rows[0];
  const { rows: domains } = await query(
    `SELECT d.code::text, d.short_label, sub.is_active
     FROM risk_domains d
     LEFT JOIN org_domain_subscriptions sub
       ON sub.risk_domain_id = d.risk_domain_id AND sub.org_id = $1
     ORDER BY d.short_label`,
    [orgId],
  );
  return {
    orgId,
    defaultRiskAppetite: Number(r.default_risk_appetite),
    activeRiskPolicyId: r.active_risk_policy_id,
    reportingDefaultWindow: r.reporting_default_window,
    executiveThresholds: r.executive_thresholds,
    displayLabels: r.display_labels,
    enabledFrameworkCodes: r.enabled_framework_codes,
    domains: domains.map((d) => ({
      code: d.code,
      label: d.short_label,
      enabled: !!d.is_active,
    })),
  };
}

export async function generateExecutiveReport(
  orgId: string,
  userId: string,
  reportType = "board_briefing",
  window = "30d",
) {
  const [overview, portfolio, trends, hotspots, decisions, compliance, briefing, controls] =
    await Promise.all([
      getOverview(orgId),
      getPortfolio(orgId),
      getTrends(orgId, window),
      getHotspots(orgId),
      getDecisionCenter(orgId),
      getCompliancePosture(orgId),
      getExecutiveBriefing(orgId),
      getControlPosture(orgId),
    ]);

  if (!overview) throw Object.assign(new Error("Org not found"), { statusCode: 404 });

  const dataAsOf = overview.asOf;
  const payload = {
    reportType,
    window,
    organization: overview.org,
    dataAsOf,
    generatedAt: new Date().toISOString(),
    generationVersion: "ecc-report-v1",
    executiveSummary: briefing.sections,
    enterpriseRiskPosture: {
      note: "Scenario-led portfolio — not an average of domain scores",
      portfolio: portfolio.totals,
      enterpriseScoreSnapshot: overview.enterpriseRisk,
    },
    topRisks: portfolio.topRisks.slice(0, 10),
    businessImpact: {
      knownFinancialExposureAed: portfolio.totals.knownFinancialExposureAed,
      unknownFinancialExposureCount: portfolio.totals.unknownFinancialExposureCount,
      findingLevelExposureAed: overview.businessImpactExposureAed,
    },
    riskTrend: trends,
    decisionsRequired: decisions.awaitingAction,
    remediationProgress: {
      backlog: portfolio.totals.remediationBacklog,
      overdue: portfolio.totals.overdueActions,
      effectiveness: trends.remediationEffectiveness,
    },
    compliancePosture: compliance,
    controlPosture: controls.counts,
    materialChanges: briefing.recentMaterialChanges,
    keyRecommendations: portfolio.topRisks
      .filter((r) => r.toleranceState === "outside")
      .slice(0, 5)
      .map((r) => ({
        scenarioId: r.scenarioId,
        title: r.title,
        treatment: r.recommendedTreatment,
      })),
    methodology: {
      portfolio: portfolio.methodology,
      trends: trends.message,
      unknownsPreserved: true,
    },
  };

  const markdown = renderReportMarkdown(payload);
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  const { rows } = await query<{ report_id: string; generated_at: Date }>(
    `INSERT INTO generated_reports (
       org_id, report_type, report_type_code, reporting_period, period_start, period_end,
       file_url, generated_by, data_as_of, status, generation_version,
       content_hash, snapshot_payload, content_markdown, title
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,'published','ecc-report-v1',$10,$11::jsonb,$12,$13
     ) RETURNING report_id, generated_at`,
    [
      orgId,
      reportType === "regulator_submission" ? "regulator_submission" : "board_briefing",
      reportType,
      window,
      new Date(Date.now() - (WINDOW_DAYS[window] ?? 30) * 86400000)
        .toISOString()
        .slice(0, 10),
      new Date().toISOString().slice(0, 10),
      `/api/ecc/reports/snapshot`,
      userId,
      dataAsOf,
      hash,
      JSON.stringify(payload),
      markdown,
      `Executive Cyber Risk Report — ${overview.org.name}`,
    ],
  );

  await query(
    `INSERT INTO command_center_activity (org_id, activity_type, summary)
     VALUES ($1,'report_generated'::activity_type,$2)`,
    [orgId, `Generated immutable executive report ${rows[0].report_id}`],
  );

  return {
    reportId: rows[0].report_id,
    generatedAt: rows[0].generated_at,
    dataAsOf,
    contentHash: hash,
    title: `Executive Cyber Risk Report — ${overview.org.name}`,
    contentMarkdown: markdown,
    snapshot: payload,
  };
}

function renderReportMarkdown(p: any): string {
  const lines = [
    `# ${p.organization?.name ?? "Organization"} — Executive Cyber Risk Report`,
    ``,
    `**Data as of:** ${p.dataAsOf}`,
    `**Generated:** ${p.generatedAt}`,
    `**Window:** ${p.window}`,
    `**Version:** ${p.generationVersion}`,
    ``,
    `## 1. Executive Summary`,
    `- ${p.executiveSummary.currentPosture.text}`,
    `- ${p.executiveSummary.whatChanged.text}`,
    `- ${p.executiveSummary.whatMatters.text}`,
    `- ${p.executiveSummary.whatNeedsDecision.text}`,
    `- ${p.executiveSummary.whatToWatch.text}`,
    ``,
    `## 2. Enterprise Risk Posture`,
    `- Active scenarios: ${p.enterpriseRiskPosture.portfolio.activeScenarios}`,
    `- Outside tolerance: ${p.enterpriseRiskPosture.portfolio.outsideTolerance}`,
    `- Known financial exposure (AED): ${p.businessImpact.knownFinancialExposureAed ?? "unknown"}`,
    `- Unknown financial exposure scenarios: ${p.businessImpact.unknownFinancialExposureCount}`,
    `- Note: ${p.enterpriseRiskPosture.note}`,
    ``,
    `## 3. Top Risks`,
    ...(p.topRisks.length
      ? p.topRisks.map(
          (r: any) =>
            `- [${r.priority}] ${r.title} — residual ${r.residualRisk ?? "—"}, tolerance ${r.toleranceState}, treatment ${r.recommendedTreatment ?? "—"}`,
        )
      : ["- None"]),
    ``,
    `## 4. Business Impact`,
    `- Known exposure AED: ${p.businessImpact.knownFinancialExposureAed ?? "unknown"}`,
    `- Unknown financial count: ${p.businessImpact.unknownFinancialExposureCount}`,
    ``,
    `## 5. Risk Trend`,
    `- ${p.riskTrend.message}`,
    ``,
    `## 6. Decisions Required`,
    ...(p.decisionsRequired.length
      ? p.decisionsRequired.map((d: any) => `- ${d.title} (${d.priority})`)
      : ["- None awaiting action"]),
    ``,
    `## 7. Remediation Progress`,
    `- Backlog: ${p.remediationProgress.backlog}; Overdue: ${p.remediationProgress.overdue}`,
    `- ${p.remediationProgress.effectiveness.note}`,
    ``,
    `## 8. Compliance Posture`,
    `- Average coverage: ${p.compliancePosture.averageCoveragePct ?? "unknown"}% (not a cyber-safety score)`,
    ...p.compliancePosture.frameworks.map(
      (f: any) =>
        `- ${f.displayName}: ${f.coveragePct}% (${f.controlsEvidenced}/${f.controlsTotal})`,
    ),
    ``,
    `## 9. Material Changes`,
    ...(p.materialChanges.length
      ? p.materialChanges.map((c: any) => `- [${c.reasonCode}] ${c.summary}`)
      : ["- None detected in recent window"]),
    ``,
    `## 10. Key Recommendations`,
    ...(p.keyRecommendations.length
      ? p.keyRecommendations.map(
          (r: any) => `- ${r.title}: ${r.treatment ?? "review"}`,
        )
      : ["- Maintain monitoring posture"]),
    ``,
    `## 11. Appendix / Methodology`,
    `- ${p.methodology.portfolio}`,
    `- Trends: ${p.methodology.trends}`,
    `- Unknown values are preserved; no fabricated metrics.`,
    ``,
    `_Immutable snapshot. Later database changes do not alter this report._`,
  ];
  return lines.join("\n");
}

export async function getReportSnapshot(orgId: string, reportId: string) {
  const { rows } = await query(
    `SELECT report_id, title, report_type_code, reporting_period, generated_at,
            data_as_of, status::text, generation_version, content_hash,
            snapshot_payload, content_markdown, file_url
     FROM generated_reports
     WHERE org_id=$1 AND report_id=$2`,
    [orgId, reportId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    reportId: r.report_id,
    title: r.title,
    reportType: r.report_type_code,
    reportingPeriod: r.reporting_period,
    generatedAt: r.generated_at,
    dataAsOf: r.data_as_of,
    status: r.status,
    generationVersion: r.generation_version,
    contentHash: r.content_hash,
    snapshot: r.snapshot_payload,
    contentMarkdown: r.content_markdown,
    immutable: true,
  };
}

export async function listReportSnapshots(orgId: string) {
  const { rows } = await query(
    `SELECT report_id, title, report_type_code, reporting_period, generated_at,
            data_as_of, status::text, content_hash, generation_version
     FROM generated_reports WHERE org_id=$1
     ORDER BY generated_at DESC LIMIT 50`,
    [orgId],
  );
  return rows.map((r) => ({
    reportId: r.report_id,
    title: r.title,
    reportType: r.report_type_code,
    reportingPeriod: r.reporting_period,
    generatedAt: r.generated_at,
    dataAsOf: r.data_as_of,
    status: r.status,
    contentHash: r.content_hash,
    generationVersion: r.generation_version,
  }));
}

/** Seed coherent synthetic executive dataset without wiping sample workbook rows */
export async function seedExecutiveIntelligence(orgId: string) {
  // Ensure BUs / processes
  await query(
    `INSERT INTO business_units (org_id, code, name)
     VALUES ($1,'PAY','Payments'), ($1,'OPS','Operations')
     ON CONFLICT (org_id, name) DO NOTHING`,
    [orgId],
  );
  const { rows: bus } = await query<{ business_unit_id: string; code: string }>(
    `SELECT business_unit_id, code FROM business_units WHERE org_id=$1 AND code IN ('PAY','OPS')`,
    [orgId],
  );
  const pay = bus.find((b) => b.code === "PAY")?.business_unit_id;
  for (const name of ["Payment Processing", "Treasury Settlement"]) {
    const { rows: exists } = await query(
      `SELECT 1 FROM business_processes WHERE org_id=$1 AND name=$2`,
      [orgId, name],
    );
    if (!exists[0] && pay) {
      await query(
        `INSERT INTO business_processes (org_id, business_unit_id, name, criticality)
         VALUES ($1,$2,$3,'critical')`,
        [orgId, pay, name],
      );
    }
  }
  await detectMaterialChanges(orgId);
  const { seedDemoScenarios } = await import("./scenarios.js");
  await seedDemoScenarios(orgId);
  return {
    ok: true,
    message:
      "Executive intelligence seed: business units/processes ensured, demo scenarios refreshed, material changes detected",
  };
}
