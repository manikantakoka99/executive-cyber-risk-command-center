import { query } from "../db.js";

const OPEN_FINDING_STATUSES = ["open", "acknowledged", "in_remediation"];

export async function getOverview(orgId: string) {
  const orgRes = await query<{ org_id: string; name: string; industry: string }>(
    `SELECT org_id, name, industry FROM organizations WHERE org_id = $1`,
    [orgId],
  );
  const org = orgRes.rows[0];
  if (!org) return null;

  const ent = await query<{
    score: string;
    severity: string;
    driver_summary: string | null;
    snapshot_at: Date;
  }>(
    `SELECT score, severity, driver_summary, snapshot_at
     FROM enterprise_risk_score_snapshots
     WHERE org_id = $1
     ORDER BY snapshot_at DESC
     LIMIT 2`,
    [orgId],
  );
  const latest = ent.rows[0];
  const prior = ent.rows[1];
  const latestScore = latest ? Number(latest.score) : null;
  const priorScore = prior ? Number(prior.score) : null;

  const exposure = await query<{ total: string | null }>(
    `SELECT COALESCE(SUM(b.financial_exposure_aed), 0) AS total
     FROM business_impact_assessments b
     JOIN risk_findings f ON f.finding_id = b.finding_id
     WHERE b.org_id = $1
       AND f.status = ANY($2::finding_status[])`,
    [orgId, OPEN_FINDING_STATUSES],
  );

  const compliance = await query<{
    framework_id: string;
    code: string;
    display_name: string;
    coverage_pct: string;
    controls_total: number | null;
    controls_evidenced: number | null;
    next_renewal_date: string | null;
  }>(
    `SELECT DISTINCT ON (c.framework_id)
        c.framework_id, f.code, f.display_name, c.coverage_pct,
        c.controls_total, c.controls_evidenced, c.next_renewal_date
     FROM org_compliance_status c
     JOIN compliance_frameworks f ON f.framework_id = c.framework_id
     WHERE c.org_id = $1
     ORDER BY c.framework_id, c.snapshot_at DESC`,
    [orgId],
  );
  const complianceRows = compliance.rows.map((r) => ({
    frameworkId: r.framework_id,
    code: r.code,
    displayName: r.display_name,
    coveragePct: Number(r.coverage_pct),
    controlsTotal: r.controls_total,
    controlsEvidenced: r.controls_evidenced,
    nextRenewalDate: r.next_renewal_date,
  }));
  const compliancePosturePct =
    complianceRows.length === 0
      ? null
      : complianceRows.reduce((s, r) => s + r.coveragePct, 0) /
        complianceRows.length;

  const awaiting = await query<{ count: string; critical: string }>(
    `SELECT
       COUNT(*)::text AS count,
       COUNT(*) FILTER (WHERE priority = 'critical')::text AS critical
     FROM executive_decisions
     WHERE org_id = $1 AND status = 'awaiting_decision'`,
    [orgId],
  );

  const criticalFindings = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM risk_findings
     WHERE org_id = $1 AND severity = 'critical'
       AND status = ANY($2::finding_status[])`,
    [orgId, OPEN_FINDING_STATUSES],
  );

  const domains = await query<{
    risk_domain_id: string;
    code: string;
    short_label: string;
    display_name: string;
    score: string;
    severity: string;
    headline_detail: string | null;
    snapshot_at: Date;
  }>(
    `SELECT DISTINCT ON (s.risk_domain_id)
        s.risk_domain_id, d.code, d.short_label, d.display_name,
        s.score, s.severity, s.headline_detail, s.snapshot_at
     FROM domain_risk_snapshots s
     JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     JOIN org_domain_subscriptions sub
       ON sub.org_id = s.org_id AND sub.risk_domain_id = s.risk_domain_id AND sub.is_active
     WHERE s.org_id = $1
     ORDER BY s.risk_domain_id, s.snapshot_at DESC`,
    [orgId],
  );

  // MUST: queue matches Decisions Awaiting CXO KPI (awaiting_decision only).
  const pending = await query<{
    decision_id: string;
    finding_id: string | null;
    title: string;
    priority: string;
    risk_summary: string;
    impact_summary: string;
    recommended_action: string;
    status: string;
    escalated_at: Date;
    short_label: string | null;
    financial_exposure_aed: string | null;
    affected_business_unit: string | null;
    compliance_scope_impact: string | null;
  }>(
    `SELECT ed.decision_id, ed.finding_id, ed.title, ed.priority, ed.risk_summary, ed.impact_summary,
            ed.recommended_action, ed.status, ed.escalated_at, rd.short_label,
            b.financial_exposure_aed, b.affected_business_unit, b.compliance_scope_impact
     FROM executive_decisions ed
     LEFT JOIN risk_findings rf ON rf.finding_id = ed.finding_id
     LEFT JOIN risk_domains rd ON rd.risk_domain_id = rf.risk_domain_id
     LEFT JOIN business_impact_assessments b ON b.impact_id = ed.impact_id
     WHERE ed.org_id = $1 AND ed.status = 'awaiting_decision'
     ORDER BY
       CASE ed.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       ed.escalated_at ASC`,
    [orgId],
  );

  const trend = await query<{
    snapshot_at: Date;
    score: string;
    severity: string;
    driver_summary: string | null;
  }>(
    `SELECT snapshot_at, score, severity, driver_summary
     FROM enterprise_risk_score_snapshots
     WHERE org_id = $1
     ORDER BY snapshot_at ASC
     LIMIT 12`,
    [orgId],
  );

  const activity = await query<{
    activity_id: string;
    activity_type: string;
    summary: string;
    occurred_at: Date;
    short_label: string | null;
  }>(
    `SELECT a.activity_id, a.activity_type, a.summary, a.occurred_at, d.short_label
     FROM command_center_activity a
     LEFT JOIN risk_domains d ON d.risk_domain_id = a.risk_domain_id
     WHERE a.org_id = $1
     ORDER BY a.occurred_at DESC
     LIMIT 12`,
    [orgId],
  );

  const scenarios = await query<{
    scenario_id: string;
    title: string;
    status: string;
    priority: string | null;
    priority_score: string | null;
    tolerance_state: string;
    velocity: string;
    residual_risk: string | null;
    explanation: string | null;
    last_seen_at: Date | null;
    decision_required: boolean;
    recommended_treatment: string | null;
    recommended_action: string | null;
    financial_exposure_aed: string | null;
    financial_known: boolean | null;
    owner_name: string | null;
    target_date: Date | null;
    first_seen_at: Date | null;
  }>(
    `SELECT s.scenario_id, s.title, s.status::text, s.priority::text,
            s.priority_score::text, s.tolerance_state::text, s.velocity::text,
            ra.residual_risk::text, s.explanation, s.last_seen_at,
            s.decision_required, s.first_seen_at,
            rr.recommended_treatment::text, rr.recommended_action,
            sbi.financial_exposure_aed::text, sbi.financial_known,
            CASE WHEN u.first_name IS NOT NULL
              THEN trim(u.first_name || ' ' || COALESCE(u.last_name,'')) END AS owner_name,
            tp.target_date
     FROM risk_scenarios s
     LEFT JOIN risk_assessments ra ON ra.risk_assessment_id = s.current_assessment_id
     LEFT JOIN risk_recommendations rr ON rr.recommendation_id = s.current_recommendation_id
     LEFT JOIN scenario_business_impacts sbi ON sbi.scenario_impact_id = s.current_impact_id
     LEFT JOIN treatment_plans tp ON tp.treatment_plan_id = s.current_treatment_plan_id
     LEFT JOIN users u ON u.user_id = tp.owner_user_id
     WHERE s.org_id = $1
       AND s.status NOT IN ('closed')
     ORDER BY COALESCE(s.priority_score, 0) DESC, s.last_seen_at DESC NULLS LAST
     LIMIT 8`,
    [orgId],
  );

  const execQueue = await query<{
    scenario_id: string;
    title: string;
    priority: string | null;
    tolerance_state: string;
    velocity: string;
    residual_risk: string | null;
    recommended_treatment: string | null;
    recommended_action: string | null;
    financial_exposure_aed: string | null;
    financial_known: boolean | null;
    owner_name: string | null;
    target_date: Date | null;
    first_seen_at: Date | null;
    last_seen_at: Date | null;
  }>(
    `SELECT s.scenario_id, s.title, s.priority::text, s.tolerance_state::text,
            s.velocity::text, ra.residual_risk::text,
            rr.recommended_treatment::text, rr.recommended_action,
            sbi.financial_exposure_aed::text, sbi.financial_known,
            CASE WHEN u.first_name IS NOT NULL
              THEN trim(u.first_name || ' ' || COALESCE(u.last_name,'')) END AS owner_name,
            tp.target_date, s.first_seen_at, s.last_seen_at
     FROM risk_scenarios s
     LEFT JOIN risk_assessments ra ON ra.risk_assessment_id = s.current_assessment_id
     LEFT JOIN risk_recommendations rr ON rr.recommendation_id = s.current_recommendation_id
     LEFT JOIN scenario_business_impacts sbi ON sbi.scenario_impact_id = s.current_impact_id
     LEFT JOIN treatment_plans tp ON tp.treatment_plan_id = s.current_treatment_plan_id
     LEFT JOIN users u ON u.user_id = tp.owner_user_id
     WHERE s.org_id = $1
       AND s.status NOT IN ('closed','accepted','mitigated')
       AND (
         s.decision_required = true
         OR s.tolerance_state = 'outside'
         OR rr.recommended_treatment IN ('mitigate','transfer','avoid')
       )
     ORDER BY
       CASE s.tolerance_state WHEN 'outside' THEN 0 WHEN 'near' THEN 1 ELSE 2 END,
       COALESCE(s.priority_score, 0) DESC
     LIMIT 12`,
    [orgId],
  );

  const scenarioStats = await query<{
    outside: string;
    increasing: string;
    aging: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE tolerance_state = 'outside')::text AS outside,
       COUNT(*) FILTER (WHERE velocity = 'increasing')::text AS increasing,
       COUNT(*) FILTER (WHERE velocity = 'aging')::text AS aging
     FROM risk_scenarios
     WHERE org_id = $1 AND status NOT IN ('closed')`,
    [orgId],
  );

  const asOfCandidates = [
    latest?.snapshot_at,
    ...domains.rows.map((d) => d.snapshot_at),
    ...activity.rows.map((a) => a.occurred_at),
    ...scenarios.rows.map((s) => s.last_seen_at).filter(Boolean),
  ].filter(Boolean) as Date[];
  const asOf =
    asOfCandidates.length === 0
      ? new Date()
      : new Date(Math.max(...asOfCandidates.map((d) => d.getTime())));

  return {
    org: { orgId: org.org_id, name: org.name, industry: org.industry },
    asOf: asOf.toISOString(),
    enterpriseRisk: latest
      ? {
          score: latestScore,
          severity: latest.severity,
          driverSummary: latest.driver_summary,
          snapshotAt: latest.snapshot_at.toISOString(),
          priorScore,
          deltaVsPrior:
            latestScore != null && priorScore != null
              ? Number((latestScore - priorScore).toFixed(2))
              : null,
        }
      : null,
    businessImpactExposureAed: Number(exposure.rows[0]?.total ?? 0),
    compliancePosturePct:
      compliancePosturePct == null
        ? null
        : Number(compliancePosturePct.toFixed(2)),
    decisionsAwaitingCxo: Number(awaiting.rows[0]?.count ?? 0),
    decisionsAwaitingCritical: Number(awaiting.rows[0]?.critical ?? 0),
    criticalFindingsOpen: Number(criticalFindings.rows[0]?.count ?? 0),
    domainsMonitored: domains.rows.length,
    domains: domains.rows
      .map((d) => ({
        riskDomainId: d.risk_domain_id,
        code: d.code,
        shortLabel: d.short_label,
        displayName: d.display_name,
        score: Number(d.score),
        severity: d.severity,
        headlineDetail: d.headline_detail,
        snapshotAt: d.snapshot_at.toISOString(),
      }))
      .sort((a, b) => b.score - a.score),
    pendingDecisions: pending.rows.map((d) => ({
      decisionId: d.decision_id,
      findingId: d.finding_id,
      title: d.title,
      priority: d.priority,
      riskSummary: d.risk_summary,
      impactSummary: d.impact_summary,
      recommendedAction: d.recommended_action,
      status: d.status,
      escalatedAt: d.escalated_at.toISOString(),
      domainLabel: d.short_label,
      financialExposureAed: d.financial_exposure_aed
        ? Number(d.financial_exposure_aed)
        : null,
      affectedBusinessUnit: d.affected_business_unit,
      complianceScopeImpact: d.compliance_scope_impact,
    })),
    compliance: complianceRows,
    riskTrend: trend.rows.map((t) => ({
      snapshotAt: t.snapshot_at.toISOString(),
      score: Number(t.score),
      severity: t.severity,
      driverSummary: t.driver_summary,
    })),
    activity: activity.rows.map((a) => ({
      activityId: a.activity_id,
      activityType: a.activity_type,
      summary: a.summary,
      occurredAt: a.occurred_at.toISOString(),
      domainLabel: a.short_label,
    })),
    riskAppetite: await (async () => {
      try {
        const { rows: settings } = await query<{ default_risk_appetite: string }>(
          `SELECT default_risk_appetite::text FROM org_settings WHERE org_id=$1`,
          [orgId],
        );
        if (settings[0]) return Number(settings[0].default_risk_appetite);
      } catch {
        /* org_settings may be absent before migration 005 */
      }
      return Number(process.env.DEFAULT_RISK_APPETITE ?? 50);
    })(),
    riskScenarios: {
      outsideTolerance: Number(scenarioStats.rows[0]?.outside ?? 0),
      increasing: Number(scenarioStats.rows[0]?.increasing ?? 0),
      aging: Number(scenarioStats.rows[0]?.aging ?? 0),
      top: scenarios.rows.map((s) => ({
        scenarioId: s.scenario_id,
        title: s.title,
        status: s.status,
        priority: s.priority,
        priorityScore: s.priority_score != null ? Number(s.priority_score) : null,
        toleranceState: s.tolerance_state,
        velocity: s.velocity,
        residualRisk: s.residual_risk != null ? Number(s.residual_risk) : null,
        explanation: s.explanation,
        lastSeenAt: s.last_seen_at?.toISOString() ?? null,
        recommendedTreatment: s.recommended_treatment,
        decisionRequired: s.decision_required,
      })),
    },
    executiveActionQueue: execQueue.rows.map((s) => ({
      scenarioId: s.scenario_id,
      title: s.title,
      priority: s.priority,
      toleranceState: s.tolerance_state,
      velocity: s.velocity,
      residualRisk: s.residual_risk != null ? Number(s.residual_risk) : null,
      recommendedTreatment: s.recommended_treatment,
      recommendedAction: s.recommended_action,
      financialExposureAed:
        s.financial_known && s.financial_exposure_aed != null
          ? Number(s.financial_exposure_aed)
          : null,
      financialKnown: !!s.financial_known,
      actionOwner: s.owner_name,
      dueDate: s.target_date ? String(s.target_date).slice(0, 10) : null,
      agingDays: s.first_seen_at
        ? Math.floor(
            (Date.now() - new Date(s.first_seen_at).getTime()) / 86400000,
          )
        : null,
      decisionRequired: true,
    })),
  };
}
