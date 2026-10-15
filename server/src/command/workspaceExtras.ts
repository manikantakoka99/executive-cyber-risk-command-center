/**
 * Combined risk register, remediation tracking, and connector health payloads.
 * Role gating is enforced at the route layer via requiredPermission / hasPermission.
 */
import { listConnectors } from "../services/connectors.js";
import { listFindings } from "../services/catalog.js";
import { query } from "../db.js";
import { daysUntil, DOMAINS } from "./model.js";
import { getState } from "./store.js";
import { hasPermission, redactFinancial, redactFinding } from "./rbac.js";

export async function getRegister(orgId: string, role: string) {
  const state = getState(orgId);
  let dbFindings: Record<string, unknown>[] = [];
  try {
    const listed = await listFindings(orgId);
    dbFindings = Array.isArray(listed) ? (listed as Record<string, unknown>[]) : [];
  } catch {
    dbFindings = [];
  }

  const openQueue = state.queue
    .filter((q) => q.state === "open" || q.state === "deferred")
    .map((q) => ({
      id: q.id,
      kind: "queue_item" as const,
      title: q.title,
      domain: DOMAINS.find((d) => d.id === q.domainId)?.name ?? q.domainId,
      severity: q.priority >= 0.9 ? "critical" : q.priority >= 0.6 ? "high" : "medium",
      status: q.state,
      owner: q.owner,
      sla: q.sla,
      kev: q.kev,
      source: "command_queue",
    }));

  const acceptances = state.accept.map((a) => ({
    id: a.id,
    kind: "acceptance" as const,
    title: a.title,
    domain: "—",
    severity: "accepted",
    status: "accepted_risk",
    owner: a.approver,
    sla: `Expires ${a.expires} (${daysUntil(a.expires)}d)`,
    reason: a.reason,
    source: "risk_acceptances",
  }));

  const findings = dbFindings.map((f) => {
    const redacted = redactFinding(role, f);
    return {
      id: String(redacted.findingId ?? redacted.finding_id ?? redacted.id ?? ""),
      kind: "finding" as const,
      title: String(redacted.title ?? "Finding"),
      domain: String(redacted.domainLabel ?? redacted.domain_code ?? "—"),
      severity: String(redacted.severity ?? "medium"),
      status: String(redacted.status ?? "open"),
      owner: String(redacted.ownerName ?? redacted.owner_user_id ?? "—"),
      sla: redacted.slaDueAt ?? redacted.sla_due_at ?? null,
      source: "risk_findings",
    };
  });

  const items = [...openQueue, ...acceptances, ...findings];
  return redactFinancial(role, {
    title: "Combined risk register",
    lede: "Open decisions, accepted risks and findings in one place. Money is masked unless your role can view financials.",
    counts: {
      open: openQueue.length,
      accepted: acceptances.length,
      findings: findings.length,
      total: items.length,
    },
    items,
    canAccept: hasPermission(role, "command.queue.accept") || hasPermission(role, "command.closure.register"),
  });
}

export async function getRemediation(orgId: string, role: string) {
  const state = getState(orgId);
  const fixes = state.fixes.map((f) => ({
    id: f.id,
    title: f.title,
    status: f.state,
    attempts: f.attempts,
    source: "command_closure",
    owner: "Security operations",
  }));

  let actions: Record<string, unknown>[] = [];
  try {
    const { rows } = await query(
      `SELECT a.action_id, a.title, a.status, a.due_at, a.completed_at, a.priority,
              u.first_name, u.last_name, s.title AS scenario_title
       FROM actions a
       LEFT JOIN users u ON u.user_id = a.owner_user_id
       LEFT JOIN risk_scenarios s ON s.scenario_id = a.scenario_id
       WHERE a.org_id = $1
       ORDER BY a.due_at NULLS LAST, a.created_at DESC
       LIMIT 100`,
      [orgId],
    );
    actions = rows.map((r) => ({
      id: r.action_id,
      title: r.title,
      status: r.status,
      dueAt: r.due_at,
      completedAt: r.completed_at,
      priority: r.priority,
      owner: [r.first_name, r.last_name].filter(Boolean).join(" ") || "—",
      scenario: r.scenario_title,
      source: "actions",
    }));
  } catch {
    actions = [];
  }

  return redactFinancial(role, {
    title: "Remediation tracking",
    lede: "Fixes reported for verification and treatment actions. Completing work reports a fix; it does not close the finding until verification passes.",
    counts: {
      fixReported: fixes.filter((f) => f.status === "fix_reported").length,
      verified: fixes.filter((f) => f.status === "verified_closed").length,
      reopened: fixes.filter((f) => f.status === "reopened").length,
      actions: actions.length,
    },
    fixes,
    actions,
    canAct: hasPermission(role, "remediation.act") || hasPermission(role, "command.closure.verify"),
  });
}

export async function getConnectorHealth(orgId: string, role: string) {
  if (!hasPermission(role, "connectors.read") && !hasPermission(role, "ingestion.read")) {
    return null;
  }
  let connectors: Awaited<ReturnType<typeof listConnectors>> = [];
  try {
    connectors = await listConnectors(orgId);
  } catch {
    connectors = [];
  }

  // Demo fallback when org has no connector rows yet
  if (connectors.length === 0) {
    connectors = DOMAINS.slice(0, 8).map((d, i) => ({
      connectorId: `demo-${d.id}`,
      orgId,
      name: `${d.name} feed`,
      vendor: "Demo",
      connectorType: "api_pull",
      adapterKey: "generic_security_events",
      domainId: d.id,
      domainCode: d.id,
      domainLabel: d.name,
      status: i % 5 === 0 ? "degraded" : "active",
      pollingIntervalSeconds: 3600,
      lastSyncAt: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
      lastSuccessAt: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
      lastFailureAt: i % 5 === 0 ? new Date().toISOString() : null,
      credentialsReference: `vault:secret/aldhabi/${d.id}`,
      configRef: null,
      configuration: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })) as unknown as typeof connectors;
  }

  const staleHours = 24;
  const now = Date.now();
  const rows = connectors.map((c) => {
    const last = c.lastSuccessAt ? Date.parse(String(c.lastSuccessAt)) : NaN;
    const ageHours = Number.isFinite(last) ? (now - last) / 3600_000 : null;
    const stale = ageHours == null || ageHours > staleHours;
    return {
      ...c,
      ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
      health: c.status === "failed" || c.status === "error" ? "down" : stale ? "stale" : "healthy",
    };
  });

  return {
    title: "Connector health",
    lede: "Feed freshness and sync status. Stale or failed connectors lower Trust confidence; they are never counted as good coverage.",
    counts: {
      total: rows.length,
      healthy: rows.filter((r) => r.health === "healthy").length,
      stale: rows.filter((r) => r.health === "stale").length,
      down: rows.filter((r) => r.health === "down").length,
    },
    connectors: rows,
  };
}
