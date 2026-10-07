import { query } from "../db.js";

const OPEN = ["open", "acknowledged", "in_remediation"];

export async function listDomains(orgId: string) {
  const { rows } = await query(
    `SELECT DISTINCT ON (s.risk_domain_id)
        s.risk_domain_id, d.code, d.short_label, d.display_name, d.yvi_solution,
        s.score, s.severity, s.headline_detail, s.snapshot_at
     FROM domain_risk_snapshots s
     JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     JOIN org_domain_subscriptions sub
       ON sub.org_id = s.org_id AND sub.risk_domain_id = s.risk_domain_id AND sub.is_active
     WHERE s.org_id = $1
     ORDER BY s.risk_domain_id, s.snapshot_at DESC`,
    [orgId],
  );
  return rows
    .map((r) => ({
      riskDomainId: r.risk_domain_id,
      code: r.code,
      shortLabel: r.short_label,
      displayName: r.display_name,
      yviSolution: r.yvi_solution,
      score: Number(r.score),
      severity: r.severity,
      headlineDetail: r.headline_detail,
      snapshotAt: r.snapshot_at.toISOString(),
    }))
    .sort((a, b) => b.score - a.score);
}

export async function getDomain(orgId: string, domainId: string) {
  const meta = await query(
    `SELECT d.*, sub.is_active
     FROM risk_domains d
     JOIN org_domain_subscriptions sub ON sub.risk_domain_id = d.risk_domain_id
     WHERE sub.org_id = $1 AND d.risk_domain_id = $2`,
    [orgId, domainId],
  );
  if (!meta.rows[0]) return null;

  const history = await query(
    `SELECT snapshot_id, score, severity, headline_detail, snapshot_at
     FROM domain_risk_snapshots
     WHERE org_id = $1 AND risk_domain_id = $2
     ORDER BY snapshot_at ASC`,
    [orgId, domainId],
  );

  const findings = await query(
    `SELECT f.finding_id, f.title, f.severity, f.status, f.affected_asset, f.detected_at,
            b.financial_exposure_aed, b.compliance_scope_impact
     FROM risk_findings f
     LEFT JOIN business_impact_assessments b ON b.finding_id = f.finding_id
     WHERE f.org_id = $1 AND f.risk_domain_id = $2
     ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              f.detected_at DESC`,
    [orgId, domainId],
  );

  const latest = history.rows[history.rows.length - 1];

  const decisions = await query(
    `SELECT ed.decision_id, ed.title, ed.priority, ed.status, ed.recommended_action,
            ed.risk_summary, ed.impact_summary, ed.escalated_at,
            b.financial_exposure_aed, b.compliance_scope_impact
     FROM executive_decisions ed
     JOIN risk_findings f ON f.finding_id = ed.finding_id
     LEFT JOIN business_impact_assessments b ON b.impact_id = ed.impact_id
     WHERE ed.org_id = $1 AND f.risk_domain_id = $2
     ORDER BY
       CASE ed.status WHEN 'awaiting_decision' THEN 0 WHEN 'info_requested' THEN 1 ELSE 2 END,
       CASE ed.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       ed.escalated_at DESC`,
    [orgId, domainId],
  );

  const activity = await query(
    `SELECT activity_id, activity_type, summary, occurred_at
     FROM command_center_activity
     WHERE org_id = $1 AND risk_domain_id = $2
     ORDER BY occurred_at DESC
     LIMIT 8`,
    [orgId, domainId],
  );

  const exposureSum = findings.rows.reduce(
    (s, f) => s + (f.financial_exposure_aed ? Number(f.financial_exposure_aed) : 0),
    0,
  );

  return {
    riskDomainId: meta.rows[0].risk_domain_id,
    code: meta.rows[0].code,
    shortLabel: meta.rows[0].short_label,
    displayName: meta.rows[0].display_name,
    yviSolution: meta.rows[0].yvi_solution,
    description: meta.rows[0].description,
    isActive: meta.rows[0].is_active,
    latest: latest
      ? {
          score: Number(latest.score),
          severity: latest.severity,
          headlineDetail: latest.headline_detail,
          snapshotAt: latest.snapshot_at.toISOString(),
        }
      : null,
    history: history.rows.map((h) => ({
      snapshotId: h.snapshot_id,
      score: Number(h.score),
      severity: h.severity,
      headlineDetail: h.headline_detail,
      snapshotAt: h.snapshot_at.toISOString(),
    })),
    findings: findings.rows.map((f) => ({
      findingId: f.finding_id,
      title: f.title,
      severity: f.severity,
      status: f.status,
      affectedAsset: f.affected_asset,
      detectedAt: f.detected_at.toISOString(),
      financialExposureAed: f.financial_exposure_aed
        ? Number(f.financial_exposure_aed)
        : null,
      complianceScopeImpact: f.compliance_scope_impact,
    })),
    financialExposureAed: exposureSum,
    decisions: decisions.rows.map((d) => ({
      decisionId: d.decision_id,
      title: d.title,
      priority: d.priority,
      status: d.status,
      recommendedAction: d.recommended_action,
      riskSummary: d.risk_summary,
      impactSummary: d.impact_summary,
      escalatedAt: d.escalated_at.toISOString(),
      financialExposureAed: d.financial_exposure_aed
        ? Number(d.financial_exposure_aed)
        : null,
      complianceScopeImpact: d.compliance_scope_impact,
    })),
    activity: activity.rows.map((a) => ({
      activityId: a.activity_id,
      activityType: a.activity_type,
      summary: a.summary,
      occurredAt: a.occurred_at.toISOString(),
    })),
  };
}

export async function listFindings(orgId: string) {
  const { rows } = await query(
    `SELECT f.*, d.short_label, d.risk_domain_id,
            b.financial_exposure_aed, b.affected_business_unit, b.compliance_scope_impact
     FROM risk_findings f
     JOIN risk_domains d ON d.risk_domain_id = f.risk_domain_id
     LEFT JOIN business_impact_assessments b ON b.finding_id = f.finding_id
     WHERE f.org_id = $1
     ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              f.detected_at DESC`,
    [orgId],
  );
  return rows.map(mapFinding);
}

export async function getFinding(orgId: string, findingId: string) {
  const { rows } = await query(
    `SELECT f.*, d.short_label, d.display_name, d.code,
            b.impact_id, b.financial_exposure_aed, b.downtime_cost_per_hour_aed,
            b.affected_business_unit, b.compliance_scope_impact, b.assessed_at
     FROM risk_findings f
     JOIN risk_domains d ON d.risk_domain_id = f.risk_domain_id
     LEFT JOIN business_impact_assessments b ON b.finding_id = f.finding_id
     WHERE f.org_id = $1 AND f.finding_id = $2`,
    [orgId, findingId],
  );
  if (!rows[0]) return null;
  const decisions = await query(
    `SELECT decision_id, title, priority, status, recommended_action, escalated_at
     FROM executive_decisions
     WHERE org_id = $1 AND finding_id = $2
     ORDER BY escalated_at DESC`,
    [orgId, findingId],
  );
  return {
    ...mapFinding(rows[0]),
    description: rows[0].description,
    rawPayload: rows[0].raw_payload,
    domainDisplayName: rows[0].display_name,
    domainCode: rows[0].code,
    impactId: rows[0].impact_id,
    downtimeCostPerHourAed: rows[0].downtime_cost_per_hour_aed
      ? Number(rows[0].downtime_cost_per_hour_aed)
      : null,
    assessedAt: rows[0].assessed_at
      ? rows[0].assessed_at.toISOString()
      : null,
    decisions: decisions.rows.map((d) => ({
      decisionId: d.decision_id,
      title: d.title,
      priority: d.priority,
      status: d.status,
      recommendedAction: d.recommended_action,
      escalatedAt: d.escalated_at.toISOString(),
    })),
  };
}

function mapFinding(r: Record<string, unknown>) {
  return {
    findingId: r.finding_id,
    title: r.title,
    severity: r.severity,
    status: r.status,
    affectedAsset: r.affected_asset,
    detectedAt: (r.detected_at as Date).toISOString(),
    resolvedAt: r.resolved_at ? (r.resolved_at as Date).toISOString() : null,
    domainLabel: r.short_label,
    riskDomainId: r.risk_domain_id,
    financialExposureAed: r.financial_exposure_aed
      ? Number(r.financial_exposure_aed)
      : null,
    affectedBusinessUnit: r.affected_business_unit ?? null,
    complianceScopeImpact: r.compliance_scope_impact ?? null,
    isOpen: OPEN.includes(String(r.status)),
  };
}

export async function getCompliance(orgId: string) {
  const { rows } = await query(
    `SELECT DISTINCT ON (c.framework_id)
        c.status_id, c.framework_id, f.code, f.display_name, f.renewal_cycle_months,
        c.coverage_pct, c.controls_total, c.controls_evidenced,
        c.next_renewal_date, c.snapshot_at
     FROM org_compliance_status c
     JOIN compliance_frameworks f ON f.framework_id = c.framework_id
     WHERE c.org_id = $1
     ORDER BY c.framework_id, c.snapshot_at DESC`,
    [orgId],
  );
  const items = rows.map((r) => ({
    statusId: r.status_id,
    frameworkId: r.framework_id,
    code: r.code,
    displayName: r.display_name,
    renewalCycleMonths: r.renewal_cycle_months,
    coveragePct: Number(r.coverage_pct),
    controlsTotal: r.controls_total,
    controlsEvidenced: r.controls_evidenced,
    nextRenewalDate: r.next_renewal_date,
    snapshotAt: r.snapshot_at.toISOString(),
  }));
  const avg =
    items.length === 0
      ? null
      : Number(
          (
            items.reduce((s, i) => s + i.coveragePct, 0) / items.length
          ).toFixed(2),
        );
  return { posturePct: avg, frameworks: items };
}

export async function getActivity(orgId: string, limit = 50) {
  const { rows } = await query(
    `SELECT a.*, d.short_label
     FROM command_center_activity a
     LEFT JOIN risk_domains d ON d.risk_domain_id = a.risk_domain_id
     WHERE a.org_id = $1
     ORDER BY a.occurred_at DESC
     LIMIT $2`,
    [orgId, limit],
  );
  return rows.map((a) => ({
    activityId: a.activity_id,
    activityType: a.activity_type,
    summary: a.summary,
    occurredAt: a.occurred_at.toISOString(),
    domainLabel: a.short_label,
  }));
}

export async function listReports(orgId: string) {
  const { rows } = await query(
    `SELECT r.*, u.first_name, u.last_name
     FROM generated_reports r
     LEFT JOIN users u ON u.user_id = r.generated_by
     WHERE r.org_id = $1
     ORDER BY r.generated_at DESC`,
    [orgId],
  );
  return rows.map((r) => ({
    reportId: r.report_id,
    reportType: r.report_type,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    fileUrl: r.file_url,
    generatedAt: r.generated_at.toISOString(),
    generatedBy:
      r.first_name != null
        ? `${r.first_name}${r.last_name ? ` ${r.last_name}` : ""}`
        : null,
  }));
}

export async function generateReport(
  orgId: string,
  userId: string,
  reportType: "board_briefing" | "regulator_submission",
  overview: NonNullable<Awaited<ReturnType<typeof import("./overview.js").getOverview>>>,
) {
  const periodEnd = new Date();
  const periodStart = new Date();
  periodStart.setMonth(periodStart.getMonth() - 3);

  const content = [
    `# ${reportType === "board_briefing" ? "Board Cyber Risk Briefing" : "Regulator Submission Pack"}`,
    ``,
    `**Organization:** ${overview.org.name}`,
    `**Generated:** ${periodEnd.toISOString()}`,
    `**Period:** ${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`,
    ``,
    `## Enterprise posture`,
    `- Cyber risk score: **${overview.enterpriseRisk?.score ?? "n/a"}** (${overview.enterpriseRisk?.severity ?? "n/a"})`,
    `- Delta vs prior snapshot: ${overview.enterpriseRisk?.deltaVsPrior ?? "n/a"}`,
    `- Driver: ${overview.enterpriseRisk?.driverSummary ?? "—"}`,
    `- Business impact exposure: **AED ${overview.businessImpactExposureAed.toLocaleString("en-AE")}**`,
    `- Compliance posture: **${overview.compliancePosturePct ?? "n/a"}%**`,
    `- Decisions awaiting CXO: **${overview.decisionsAwaitingCxo}**`,
    `- Open critical findings: **${overview.criticalFindingsOpen}**`,
    ``,
    `## Top domain risks`,
    ...overview.domains.slice(0, 5).map(
      (d) =>
        `- ${d.shortLabel}: ${d.score} (${d.severity}) — ${d.headlineDetail ?? ""}`,
    ),
    ``,
    `## Decisions requiring attention`,
    ...(overview.pendingDecisions.length
      ? overview.pendingDecisions.map(
          (d) =>
            `- [${d.priority}/${d.status}] ${d.title} — ${d.recommendedAction}`,
        )
      : ["- None awaiting decision."]),
    ``,
    `## Compliance`,
    ...overview.compliance.map(
      (c) =>
        `- ${c.displayName}: ${c.coveragePct}% (${c.controlsEvidenced}/${c.controlsTotal} evidenced)`,
    ),
    ``,
    `## Recent activity`,
    ...overview.activity.slice(0, 5).map(
      (a) => `- ${a.occurredAt.slice(0, 10)}: ${a.summary}`,
    ),
    ...(overview.activity.length ? [] : ["- No recent activity."]),
    ``,
    `_Generated from live Command Center data. Not a substitute for formal legal filings._`,
  ].join("\n");

  const slug = overview.org.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const fileUrl = `/api/ecc/reports/content/${slug}-${reportType}-${periodEnd.toISOString().slice(0, 10)}.md`;

  const { rows } = await query(
    `INSERT INTO generated_reports (org_id, report_type, period_start, period_end, file_url, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING report_id, generated_at`,
    [
      orgId,
      reportType,
      periodStart.toISOString().slice(0, 10),
      periodEnd.toISOString().slice(0, 10),
      fileUrl,
      userId,
    ],
  );

  await query(
    `INSERT INTO command_center_activity (org_id, activity_type, summary)
     VALUES ($1, 'report_generated', $2)`,
    [orgId, `${reportType.replace("_", " ")} generated from live Command Center data`],
  );

  await query(
    `INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, new_value)
     VALUES ($1, $2, 'report_generated', 'generated_report', $3, $4::jsonb)`,
    [
      orgId,
      userId,
      rows[0].report_id,
      JSON.stringify({ reportType, fileUrl }),
    ],
  );

  // Store content alongside via a simple table-less approach: put in file_url query param style —
  // For MVP we return content in the response and keep a memory/cache map keyed by report id is fragile.
  // Persist in audit new_value already; also write to generated_reports isn't enough for body.
  // Use a lightweight side table? Schema doesn't have content column.
  // Store markdown in file under server/generated/ and point file_url to download route.
  return {
    reportId: rows[0].report_id,
    reportType,
    fileUrl,
    generatedAt: rows[0].generated_at.toISOString(),
    content,
  };
}

export async function getAudit(orgId: string, limit = 100) {
  const { rows } = await query(
    `SELECT a.*, u.first_name, u.last_name, u.role
     FROM audit_log a
     LEFT JOIN users u ON u.user_id = a.user_id
     WHERE a.org_id = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [orgId, limit],
  );
  return rows.map((a) => ({
    logId: Number(a.log_id),
    action: a.action,
    entityType: a.entity_type,
    entityId: a.entity_id,
    oldValue: a.old_value,
    newValue: a.new_value,
    createdAt: a.created_at.toISOString(),
    actor:
      a.first_name != null
        ? `${a.first_name}${a.last_name ? ` ${a.last_name}` : ""}`
        : null,
    actorRole: a.role,
  }));
}
