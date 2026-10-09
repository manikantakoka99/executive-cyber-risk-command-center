import { query } from "../db.js";
import { getAdapter } from "../ingestion/adapters/registry.js";
import { ingestAndNormalize } from "../ingestion/pipeline.js";
import type { IngestionResult, RawEventInput } from "../ingestion/types.js";
import { correlateReadySignals } from "../risk/correlation.js";

export async function listConnectors(orgId: string) {
  const { rows } = await query(
    `SELECT c.*, d.code::text AS domain_code, d.short_label
     FROM connectors c
     JOIN risk_domains d ON d.risk_domain_id = c.risk_domain_id
     WHERE c.org_id = $1
     ORDER BY c.name`,
    [orgId],
  );
  return rows.map(mapConnector);
}

export async function getConnector(orgId: string, connectorId: string) {
  const { rows } = await query(
    `SELECT c.*, d.code::text AS domain_code, d.short_label
     FROM connectors c
     JOIN risk_domains d ON d.risk_domain_id = c.risk_domain_id
     WHERE c.org_id = $1 AND c.connector_id = $2`,
    [orgId, connectorId],
  );
  return rows[0] ? mapConnector(rows[0]) : null;
}

function mapConnector(c: Record<string, unknown>) {
  return {
    connectorId: c.connector_id,
    orgId: c.org_id,
    name: c.name,
    vendor: c.vendor,
    connectorType: c.connector_type,
    adapterKey: c.adapter_key,
    domainId: c.risk_domain_id,
    domainCode: c.domain_code,
    domainLabel: c.short_label,
    status: c.status,
    pollingIntervalSeconds: c.polling_interval_seconds,
    lastSyncAt: c.last_sync_at,
    lastSuccessAt: c.last_success_at,
    lastFailureAt: c.last_failure_at,
    credentialsReference: c.credentials_reference ?? c.secret_ref,
    configRef: c.config_ref,
    configuration: c.config_nonsecret,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

export async function createConnector(
  orgId: string,
  input: {
    name: string;
    riskDomainId: string;
    adapterKey?: string;
    connectorType?: string;
    vendor?: string;
    credentialsReference?: string;
    configuration?: Record<string, unknown>;
    pollingIntervalSeconds?: number;
  },
) {
  // Ensure domain belongs to catalog (shared) — org subscription optional for connector create
  const { rows: dom } = await query(
    `SELECT risk_domain_id FROM risk_domains WHERE risk_domain_id = $1`,
    [input.riskDomainId],
  );
  if (!dom[0]) throw Object.assign(new Error("Invalid risk domain"), { statusCode: 400 });

  const adapterKey = input.adapterKey ?? "generic_security_events";
  const adapter = getAdapter(adapterKey);
  if (!adapter) throw Object.assign(new Error(`Unknown adapter_key: ${adapterKey}`), { statusCode: 400 });

  const cfg = input.configuration ?? {};
  const cfgCheck = adapter.validateConfiguration(cfg);
  if (!cfgCheck.ok) {
    throw Object.assign(new Error(cfgCheck.errors.join("; ")), { statusCode: 400 });
  }

  // Never persist secrets — only references
  const { rows } = await query(
    `INSERT INTO connectors (
       org_id, risk_domain_id, name, vendor, connector_type, status,
       credentials_reference, secret_ref, config_nonsecret, adapter_key,
       polling_interval_seconds
     ) VALUES ($1,$2,$3,$4,$5,'active',$6,$6,$7::jsonb,$8,$9)
     RETURNING connector_id`,
    [
      orgId,
      input.riskDomainId,
      input.name,
      input.vendor ?? "ecc-demo",
      input.connectorType ?? "demo",
      input.credentialsReference ?? "secret://local/placeholder",
      JSON.stringify(cfg),
      adapterKey,
      input.pollingIntervalSeconds ?? null,
    ],
  );
  return getConnector(orgId, rows[0].connector_id);
}

export async function testConnector(orgId: string, connectorId: string) {
  const ctx = await adapterContext(orgId, connectorId);
  if (!ctx) return null;
  const adapter = getAdapter(ctx.adapterKey);
  if (!adapter) throw Object.assign(new Error("Adapter not registered"), { statusCode: 400 });
  return adapter.testConnection(ctx);
}

export async function listSyncRuns(orgId: string, connectorId: string) {
  const { rows } = await query(
    `SELECT * FROM connector_sync_runs
     WHERE org_id = $1 AND connector_id = $2
     ORDER BY started_at DESC
     LIMIT 50`,
    [orgId, connectorId],
  );
  return rows.map((r) => ({
    syncRunId: r.sync_run_id,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    eventsReceived: r.events_received,
    eventsAccepted: r.events_accepted,
    eventsRejected: r.events_rejected,
    eventsDeduplicated: r.events_deduplicated,
    unresolvedAssets: r.unresolved_assets,
    unresolvedIdentities: r.unresolved_identities,
    missingTimestamps: r.missing_timestamps,
    missingSeverity: r.missing_severity,
    unknownEventTypes: r.unknown_event_types,
    errorSummary: r.error_summary,
    metadata: r.metadata,
  }));
}

async function adapterContext(orgId: string, connectorId: string) {
  const { rows } = await query<{
    connector_id: string;
    name: string;
    risk_domain_id: string;
    adapter_key: string;
    config_nonsecret: Record<string, unknown> | null;
    domain_code: string;
  }>(
    `SELECT c.connector_id, c.name, c.risk_domain_id, c.adapter_key, c.config_nonsecret,
            d.code::text AS domain_code
     FROM connectors c
     JOIN risk_domains d ON d.risk_domain_id = c.risk_domain_id
     WHERE c.org_id = $1 AND c.connector_id = $2`,
    [orgId, connectorId],
  );
  const c = rows[0];
  if (!c) return null;
  return {
    orgId,
    connectorId: c.connector_id,
    connectorName: c.name,
    riskDomainId: c.risk_domain_id,
    domainCode: c.domain_code,
    adapterKey: c.adapter_key,
    config: c.config_nonsecret ?? {},
  };
}

/** Run adapter fetch → ingest pipeline; records sync run metrics */
export async function runConnectorSync(
  orgId: string,
  connectorId: string,
): Promise<{ syncRunId: string; result: IngestionResult } | null> {
  const ctx = await adapterContext(orgId, connectorId);
  if (!ctx) return null;
  const adapter = getAdapter(ctx.adapterKey);
  if (!adapter) throw Object.assign(new Error("Adapter not registered"), { statusCode: 400 });

  const { rows: runRows } = await query<{ sync_run_id: string }>(
    `INSERT INTO connector_sync_runs (org_id, connector_id, status)
     VALUES ($1, $2, 'running') RETURNING sync_run_id`,
    [orgId, connectorId],
  );
  const syncRunId = runRows[0].sync_run_id;

  try {
    const events = await adapter.fetch(ctx);
    const result = await ingestAndNormalize({
      orgId,
      connectorId,
      syncRunId,
      events,
      normalize: (raw) => adapter.normalize(raw, ctx),
    });

    // Phase 3: correlate newly ready signals into risk scenarios
    try {
      await correlateReadySignals(orgId);
    } catch {
      /* correlation failures must not fail ingestion sync */
    }

    const status =
      result.errorCount > 0 && result.acceptedCount === 0
        ? "failed"
        : result.rejectedCount > 0 || result.errorCount > 0
          ? "partial"
          : "succeeded";

    await query(
      `UPDATE connector_sync_runs SET
         completed_at = now(),
         status = $2::sync_run_status,
         records_received = $3,
         records_processed = $4,
         records_failed = $5,
         events_received = $3,
         events_accepted = $4,
         events_rejected = $6,
         events_deduplicated = $7,
         unresolved_assets = $8,
         unresolved_identities = $9,
         missing_timestamps = $10,
         missing_severity = $11,
         unknown_event_types = $12,
         error_summary = $13,
         metadata = $14::jsonb
       WHERE sync_run_id = $1`,
      [
        syncRunId,
        status,
        result.receivedCount,
        result.acceptedCount,
        result.errorCount,
        result.rejectedCount,
        result.duplicateCount,
        result.unresolvedAssets,
        result.unresolvedIdentities,
        result.missingTimestamps,
        result.missingSeverity,
        result.unknownEventTypes,
        result.errors.map((e) => e.reason).slice(0, 5).join(" | ") || null,
        JSON.stringify({ signalIds: result.signalIds, rawEventIds: result.rawEventIds }),
      ],
    );

    await query(
      `UPDATE connectors SET
         last_sync_at = now(),
         last_success_at = CASE WHEN $1::text IN ('succeeded','partial') THEN now() ELSE last_success_at END,
         last_failure_at = CASE WHEN $1::text = 'failed' THEN now() ELSE last_failure_at END,
         status = CASE WHEN $1::text = 'failed' THEN 'error'::connector_status ELSE 'active'::connector_status END
       WHERE org_id = $2 AND connector_id = $3`,
      [status, orgId, connectorId],
    );

    return { syncRunId, result };
  } catch (err) {
    await query(
      `UPDATE connector_sync_runs SET
         completed_at = now(), status = 'failed',
         error_summary = $2
       WHERE sync_run_id = $1`,
      [syncRunId, err instanceof Error ? err.message : String(err)],
    );
    await query(
      `UPDATE connectors SET last_failure_at = now(), status = 'error'
       WHERE org_id = $1 AND connector_id = $2`,
      [orgId, connectorId],
    );
    throw err;
  }
}

/** Manual raw event push through same pipeline (uses connector's adapter normalize if possible) */
export async function ingestRawEventsForConnector(
  orgId: string,
  connectorId: string,
  events: RawEventInput[],
): Promise<IngestionResult | null> {
  const ctx = await adapterContext(orgId, connectorId);
  if (!ctx) return null;
  const adapter = getAdapter(ctx.adapterKey);
  if (!adapter) throw Object.assign(new Error("Adapter not registered"), { statusCode: 400 });

  const { rows: runRows } = await query<{ sync_run_id: string }>(
    `INSERT INTO connector_sync_runs (org_id, connector_id, status)
     VALUES ($1, $2, 'running') RETURNING sync_run_id`,
    [orgId, connectorId],
  );
  const syncRunId = runRows[0].sync_run_id;
  const result = await ingestAndNormalize({
    orgId,
    connectorId,
    syncRunId,
    events,
    normalize: (raw) => adapter.normalize(raw, ctx),
  });

  await query(
    `UPDATE connector_sync_runs SET
       completed_at = now(),
       status = $2::sync_run_status,
       events_received = $3,
       events_accepted = $4,
       events_rejected = $5,
       events_deduplicated = $6,
       records_received = $3,
       records_processed = $4,
       records_failed = $7,
       unresolved_assets = $8,
       error_summary = $9
     WHERE sync_run_id = $1`,
    [
      syncRunId,
      result.errorCount && !result.acceptedCount ? "failed" : "succeeded",
      result.receivedCount,
      result.acceptedCount,
      result.rejectedCount,
      result.duplicateCount,
      result.errorCount,
      result.unresolvedAssets,
      result.errors[0]?.reason ?? null,
    ],
  );
  result.syncRunId = syncRunId;
  return result;
}
