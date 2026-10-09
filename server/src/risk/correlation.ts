import { createHash } from "node:crypto";
import { query } from "../db.js";
import { loadActivePolicy } from "./policy.js";
import { severityScore } from "./scoring.js";
import { recalculateScenario } from "./assessment.js";

type SignalRow = {
  signal_id: string;
  org_id: string;
  risk_domain_id: string;
  domain_code: string;
  event_type: string;
  severity: string;
  asset_id: string | null;
  business_unit_id: string | null;
  business_process_id: string | null;
  finding_id: string | null;
  observed_at: Date;
  title: string | null;
  source_type: string | null;
};

/**
 * Correlate a ready_for_correlation signal into a risk scenario.
 * Deterministic rules only — no LLM/ML.
 */
export async function correlateSignal(
  orgId: string,
  signalId: string,
): Promise<{
  action: string;
  scenarioId: string | null;
  ruleCode: string;
  reason: string;
}> {
  const { rows } = await query<SignalRow>(
    `SELECT s.signal_id, s.org_id, s.risk_domain_id, d.code::text AS domain_code,
            s.event_type, s.severity::text AS severity, s.asset_id,
            s.business_unit_id, s.business_process_id, s.finding_id,
            s.observed_at, s.title, s.source_type
     FROM security_signals s
     JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     WHERE s.org_id = $1 AND s.signal_id = $2
       AND s.lifecycle_status = 'ready_for_correlation'
       AND s.is_duplicate = false
       AND COALESCE(s.signal_kind::text, 'event') = 'event'`,
    [orgId, signalId],
  );
  const signal = rows[0];
  if (!signal) {
    return {
      action: "skip",
      scenarioId: null,
      ruleCode: "not_eligible",
      reason: "Signal not found, not an event, or not ready_for_correlation",
    };
  }

  if (!signal.observed_at) {
    return {
      action: "skip",
      scenarioId: null,
      ruleCode: "missing_timestamp",
      reason: "Event signal missing observed_at — not correlated",
    };
  }

  const policy = await loadActivePolicy(orgId);
  const windowMs = policy.config.temporal_window_hours * 3600 * 1000;
  const since = new Date(signal.observed_at.getTime() - windowMs);

  // Informational skip
  if (signal.severity === "info") {
    return logAndReturn(orgId, null, signalId, "skip_info", "skip", "Info-severity signals are not scenario-worthy by default");
  }

  // Existing scenario by correlation key / same asset / same process in window
  const match = await findExistingScenario(orgId, signal, since);
  if (match) {
    await linkSignal(orgId, match.scenarioId, signal);
    await query(
      `UPDATE risk_scenarios SET last_seen_at = GREATEST(last_seen_at, $3),
         status = CASE WHEN status = 'candidate' THEN 'active'::risk_scenario_status ELSE status END,
         updated_at = now()
       WHERE org_id = $1 AND scenario_id = $2`,
      [orgId, match.scenarioId, signal.observed_at],
    );
    await recalculateScenario(orgId, match.scenarioId);
    return logAndReturn(
      orgId,
      match.scenarioId,
      signalId,
      match.ruleCode,
      "strengthen",
      match.reason,
    );
  }

  // Finding + signal: attach to scenario that already has this finding, or create from finding
  if (signal.finding_id) {
    const { rows: fs } = await query<{ scenario_id: string }>(
      `SELECT scenario_id FROM risk_scenario_findings
       WHERE org_id = $1 AND finding_id = $2 LIMIT 1`,
      [orgId, signal.finding_id],
    );
    if (fs[0]) {
      await linkSignal(orgId, fs[0].scenario_id, signal);
      await query(
        `UPDATE risk_scenarios SET last_seen_at = GREATEST(last_seen_at, $3) WHERE org_id=$1 AND scenario_id=$2`,
        [orgId, fs[0].scenario_id, signal.observed_at],
      );
      await recalculateScenario(orgId, fs[0].scenario_id);
      return logAndReturn(
        orgId,
        fs[0].scenario_id,
        signalId,
        "finding_signal",
        "strengthen",
        "Signal strengthens scenario linked to the same finding",
      );
    }
  }

  // Decide create vs skip (prevent explosion)
  const relatedCount = await countRelatedSignals(orgId, signal, since);
  const sevOk =
    severityScore(signal.severity) >=
    severityScore(policy.config.min_severity_for_single_signal);

  const canCreate =
    relatedCount + 1 >= policy.config.min_signals_for_scenario || sevOk;

  if (!canCreate) {
    return logAndReturn(
      orgId,
      null,
      signalId,
      "insufficient_evidence",
      "skip",
      `Need ≥${policy.config.min_signals_for_scenario} related signals or ≥${policy.config.min_severity_for_single_signal} severity (related=${relatedCount})`,
    );
  }

  const scenarioId = await createScenarioFromSignal(orgId, signal, relatedCount >= 1);
  // Link peer signals in window
  await linkRelatedSignals(orgId, scenarioId, signal, since);
  await recalculateScenario(orgId, scenarioId);

  return logAndReturn(
    orgId,
    scenarioId,
    signalId,
    relatedCount >= 1 ? "cross_signal_create" : "critical_single_create",
    "create",
    "New risk scenario created from correlation rules",
  );
}

async function findExistingScenario(
  orgId: string,
  signal: SignalRow,
  since: Date,
): Promise<{ scenarioId: string; ruleCode: string; reason: string } | null> {
  if (signal.asset_id) {
    const { rows } = await query<{ scenario_id: string }>(
      `SELECT s.scenario_id
       FROM risk_scenarios s
       JOIN risk_scenario_assets a ON a.scenario_id = s.scenario_id AND a.org_id = s.org_id
       WHERE s.org_id = $1 AND a.asset_id = $2
         AND s.status IN ('candidate','active','monitoring','open')
         AND s.last_seen_at >= $3
       ORDER BY s.last_seen_at DESC LIMIT 1`,
      [orgId, signal.asset_id, since],
    );
    if (rows[0]) {
      return {
        scenarioId: rows[0].scenario_id,
        ruleCode: "same_asset",
        reason: "Correlated to existing scenario on the same canonical asset",
      };
    }
  }

  if (signal.business_process_id) {
    const { rows } = await query<{ scenario_id: string }>(
      `SELECT scenario_id FROM risk_scenarios
       WHERE org_id = $1 AND business_process_id = $2
         AND status IN ('candidate','active','monitoring','open')
         AND last_seen_at >= $3
       ORDER BY last_seen_at DESC LIMIT 1`,
      [orgId, signal.business_process_id, since],
    );
    if (rows[0]) {
      return {
        scenarioId: rows[0].scenario_id,
        ruleCode: "same_business_process",
        reason: "Correlated to existing scenario on the same business process",
      };
    }
  }

  // Correlation key: org+asset or org+process+event family
  const key = correlationKey(signal);
  if (key) {
    const { rows } = await query<{ scenario_id: string }>(
      `SELECT scenario_id FROM risk_scenarios
       WHERE org_id = $1 AND correlation_key = $2
         AND status IN ('candidate','active','monitoring','open')
       LIMIT 1`,
      [orgId, key],
    );
    if (rows[0]) {
      return {
        scenarioId: rows[0].scenario_id,
        ruleCode: "correlation_key",
        reason: "Matched deterministic correlation key",
      };
    }
  }
  return null;
}

function correlationKey(signal: SignalRow): string | null {
  if (signal.asset_id) {
    return createHash("sha256")
      .update(`asset:${signal.org_id}:${signal.asset_id}`)
      .digest("hex")
      .slice(0, 32);
  }
  if (signal.business_process_id) {
    return createHash("sha256")
      .update(`bp:${signal.org_id}:${signal.business_process_id}`)
      .digest("hex")
      .slice(0, 32);
  }
  return null;
}

async function countRelatedSignals(
  orgId: string,
  signal: SignalRow,
  since: Date,
): Promise<number> {
  if (signal.asset_id) {
    const { rows } = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM security_signals
       WHERE org_id = $1 AND asset_id = $2 AND signal_id <> $3
         AND observed_at >= $4 AND is_duplicate = false
         AND lifecycle_status = 'ready_for_correlation'`,
      [orgId, signal.asset_id, signal.signal_id, since],
    );
    return Number(rows[0].n);
  }
  if (signal.business_process_id) {
    const { rows } = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM security_signals
       WHERE org_id = $1 AND business_process_id = $2 AND signal_id <> $3
         AND observed_at >= $4 AND is_duplicate = false`,
      [orgId, signal.business_process_id, signal.signal_id, since],
    );
    return Number(rows[0].n);
  }
  return 0;
}

async function createScenarioFromSignal(
  orgId: string,
  signal: SignalRow,
  multiSignal: boolean,
): Promise<string> {
  const title =
    signal.title ||
    `${signal.severity} ${signal.event_type.replace(/_/g, " ")} scenario`;
  const description = multiSignal
    ? `Cross-signal risk scenario involving ${signal.domain_code} activity` +
      (signal.asset_id ? " on a shared asset" : "")
    : `High-severity signal escalated to candidate risk scenario`;

  const { rows } = await query<{ scenario_id: string }>(
    `INSERT INTO risk_scenarios (
       org_id, title, description, status, scenario_type, primary_asset_id,
       primary_domain_id, business_unit_id, business_process_id,
       first_seen_at, last_seen_at, correlation_key
     ) VALUES (
       $1, $2, $3, 'candidate', $4, $5, $6, $7, $8, $9, $9, $10
     ) RETURNING scenario_id`,
    [
      orgId,
      title.slice(0, 300),
      description,
      signal.event_type,
      signal.asset_id,
      signal.risk_domain_id,
      signal.business_unit_id,
      signal.business_process_id,
      signal.observed_at,
      correlationKey(signal),
    ],
  );
  const scenarioId = rows[0].scenario_id;
  await linkSignal(orgId, scenarioId, signal);
  if (signal.finding_id) {
    await query(
      `INSERT INTO risk_scenario_findings (scenario_id, finding_id, org_id)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [scenarioId, signal.finding_id, orgId],
    );
  }
  return scenarioId;
}

async function linkSignal(orgId: string, scenarioId: string, signal: SignalRow) {
  await query(
    `INSERT INTO risk_scenario_signals (scenario_id, signal_id, org_id)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [scenarioId, signal.signal_id, orgId],
  );
  await query(
    `INSERT INTO risk_scenario_domains (scenario_id, risk_domain_id, org_id)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [scenarioId, signal.risk_domain_id, orgId],
  );
  if (signal.asset_id) {
    await query(
      `INSERT INTO risk_scenario_assets (scenario_id, asset_id, org_id)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [scenarioId, signal.asset_id, orgId],
    );
  }
}

async function linkRelatedSignals(
  orgId: string,
  scenarioId: string,
  signal: SignalRow,
  since: Date,
) {
  if (!signal.asset_id && !signal.business_process_id) return;
  const { rows } = await query<SignalRow>(
    `SELECT s.signal_id, s.org_id, s.risk_domain_id, d.code::text AS domain_code,
            s.event_type, s.severity::text AS severity, s.asset_id,
            s.business_unit_id, s.business_process_id, s.finding_id,
            s.observed_at, s.title, s.source_type
     FROM security_signals s
     JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     WHERE s.org_id = $1 AND s.signal_id <> $2
       AND s.observed_at >= $3 AND s.is_duplicate = false
       AND s.lifecycle_status = 'ready_for_correlation'
       AND (
         ($4::uuid IS NOT NULL AND s.asset_id = $4)
         OR ($5::uuid IS NOT NULL AND s.business_process_id = $5)
       )`,
    [
      orgId,
      signal.signal_id,
      since,
      signal.asset_id,
      signal.business_process_id,
    ],
  );
  for (const peer of rows) {
    await linkSignal(orgId, scenarioId, peer);
  }
}

async function logAndReturn(
  orgId: string,
  scenarioId: string | null,
  signalId: string,
  ruleCode: string,
  action: string,
  reason: string,
) {
  await query(
    `INSERT INTO correlation_events
       (org_id, scenario_id, signal_id, rule_code, action, reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [orgId, scenarioId, signalId, ruleCode, action, reason],
  );
  return { action, scenarioId, ruleCode, reason };
}

/** Batch: correlate all ready signals for an org (demo / jobs) */
export async function correlateReadySignals(orgId: string): Promise<number> {
  const { rows } = await query<{ signal_id: string }>(
    `SELECT signal_id FROM security_signals
     WHERE org_id = $1 AND lifecycle_status = 'ready_for_correlation'
       AND is_duplicate = false
       AND COALESCE(signal_kind::text, 'event') = 'event'
       AND observed_at IS NOT NULL
     ORDER BY observed_at ASC`,
    [orgId],
  );
  let n = 0;
  for (const r of rows) {
    const out = await correlateSignal(orgId, r.signal_id);
    if (out.action === "create" || out.action === "strengthen") n += 1;
  }
  return n;
}
