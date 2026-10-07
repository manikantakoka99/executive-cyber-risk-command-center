import { query } from "../db.js";
import type { TenantContext } from "../middleware/tenant.js";

const ACTION_STATUS: Record<
  string,
  "approved" | "info_requested" | "declined" | "closed"
> = {
  approve: "approved",
  "request-info": "info_requested",
  decline: "declined",
  close: "closed",
};

const ACTION_LOG: Record<string, string> = {
  approve: "approved",
  "request-info": "info_requested",
  decline: "declined",
  close: "closed",
};

export async function listDecisions(orgId: string, status?: string) {
  const params: unknown[] = [orgId];
  let filter = "";
  if (status) {
    params.push(status);
    filter = ` AND ed.status = $2::decision_status`;
  }
  const { rows } = await query(
    `SELECT ed.*, rd.short_label AS domain_label,
            b.financial_exposure_aed, b.affected_business_unit, b.compliance_scope_impact
     FROM executive_decisions ed
     LEFT JOIN risk_findings rf ON rf.finding_id = ed.finding_id
     LEFT JOIN risk_domains rd ON rd.risk_domain_id = rf.risk_domain_id
     LEFT JOIN business_impact_assessments b ON b.impact_id = ed.impact_id
     WHERE ed.org_id = $1${filter}
     ORDER BY
       CASE ed.status
         WHEN 'awaiting_decision' THEN 0
         WHEN 'info_requested' THEN 1
         ELSE 2 END,
       CASE ed.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       ed.escalated_at DESC`,
    params,
  );
  return rows.map(mapDecision);
}

export async function getDecision(orgId: string, decisionId: string) {
  const { rows } = await query(
    `SELECT ed.*, rd.short_label AS domain_label, rd.risk_domain_id,
            rf.title AS finding_title, rf.severity AS finding_severity, rf.status AS finding_status,
            b.financial_exposure_aed, b.downtime_cost_per_hour_aed,
            b.affected_business_unit, b.compliance_scope_impact
     FROM executive_decisions ed
     LEFT JOIN risk_findings rf ON rf.finding_id = ed.finding_id
     LEFT JOIN risk_domains rd ON rd.risk_domain_id = rf.risk_domain_id
     LEFT JOIN business_impact_assessments b ON b.impact_id = ed.impact_id
     WHERE ed.org_id = $1 AND ed.decision_id = $2`,
    [orgId, decisionId],
  );
  if (!rows[0]) return null;
  const history = await query(
    `SELECT l.action_log_id, l.action, l.notes, l.acted_at,
            u.first_name, u.last_name, u.role
     FROM decision_action_log l
     LEFT JOIN users u ON u.user_id = l.actor_user_id
     WHERE l.decision_id = $1
     ORDER BY l.acted_at ASC`,
    [decisionId],
  );
  return {
    ...mapDecision(rows[0]),
    findingTitle: rows[0].finding_title,
    findingSeverity: rows[0].finding_severity,
    findingStatus: rows[0].finding_status,
    riskDomainId: rows[0].risk_domain_id,
    downtimeCostPerHourAed: rows[0].downtime_cost_per_hour_aed
      ? Number(rows[0].downtime_cost_per_hour_aed)
      : null,
    history: history.rows.map((h) => ({
      actionLogId: h.action_log_id,
      action: h.action,
      notes: h.notes,
      actedAt: h.acted_at.toISOString(),
      actor:
        h.first_name != null
          ? `${h.first_name}${h.last_name ? ` ${h.last_name}` : ""}`
          : null,
      actorRole: h.role,
    })),
  };
}

function mapDecision(r: Record<string, unknown>) {
  return {
    decisionId: r.decision_id,
    title: r.title,
    priority: r.priority,
    riskSummary: r.risk_summary,
    impactSummary: r.impact_summary,
    recommendedAction: r.recommended_action,
    status: r.status,
    escalatedAt: (r.escalated_at as Date).toISOString(),
    decidedAt: r.decided_at ? (r.decided_at as Date).toISOString() : null,
    decisionNotes: r.decision_notes,
    domainLabel: r.domain_label ?? null,
    findingId: r.finding_id,
    impactId: r.impact_id,
    financialExposureAed: r.financial_exposure_aed
      ? Number(r.financial_exposure_aed)
      : null,
    affectedBusinessUnit: r.affected_business_unit ?? null,
    complianceScopeImpact: r.compliance_scope_impact ?? null,
  };
}

export async function applyDecisionAction(
  tenant: TenantContext,
  decisionId: string,
  action: keyof typeof ACTION_STATUS,
  notes?: string,
) {
  const client = await (await import("../db.js")).pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      `SELECT * FROM executive_decisions WHERE org_id = $1 AND decision_id = $2 FOR UPDATE`,
      [tenant.orgId, decisionId],
    );
    if (!cur.rows[0]) {
      await client.query("ROLLBACK");
      return { error: "not_found" as const };
    }
    const decision = cur.rows[0];
    if (["approved", "declined", "closed"].includes(decision.status)) {
      await client.query("ROLLBACK");
      return { error: "terminal" as const, status: decision.status };
    }

    const newStatus = ACTION_STATUS[action];
    const terminal = newStatus !== "info_requested";
    await client.query(
      `UPDATE executive_decisions
       SET status = $1::decision_status,
           decided_by = $2,
           decided_at = CASE WHEN $3 THEN now() ELSE decided_at END,
           decision_notes = COALESCE($4, decision_notes)
       WHERE decision_id = $5`,
      [newStatus, tenant.userId, terminal, notes ?? null, decisionId],
    );

    await client.query(
      `INSERT INTO decision_action_log (decision_id, actor_user_id, action, notes)
       VALUES ($1, $2, $3, $4)`,
      [decisionId, tenant.userId, ACTION_LOG[action], notes ?? null],
    );

    await client.query(
      `INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, old_value, new_value)
       VALUES ($1, $2, $3, 'executive_decision', $4, $5::jsonb, $6::jsonb)`,
      [
        tenant.orgId,
        tenant.userId,
        ACTION_LOG[action],
        decisionId,
        JSON.stringify({ status: decision.status }),
        JSON.stringify({ status: newStatus, notes: notes ?? null }),
      ],
    );

    const activityType =
      action === "request-info" ? "decision_escalated" : "decision_resolved";
    await client.query(
      `INSERT INTO command_center_activity (org_id, activity_type, summary)
       VALUES ($1, $2::activity_type, $3)`,
      [
        tenant.orgId,
        activityType,
        `Executive decision ${ACTION_LOG[action].replaceAll("_", " ")}: ${decision.title}`,
      ],
    );

    await client.query("COMMIT");
    return { ok: true as const, status: newStatus };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
