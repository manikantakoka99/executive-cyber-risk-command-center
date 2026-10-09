/**
 * Dev/demo sample workbook ingestion orchestration.
 * Tenant-scoped. Synthetic fixture only.
 */
import { query } from "../db.js";
import { ingestAndNormalize } from "../ingestion/pipeline.js";
import {
  SAMPLE_WORKBOOK_ADAPTER_KEY,
  SAMPLE_WORKBOOK_CONNECTOR_NAME,
  loadWorkbookRows,
  resolveWorkbookFixturePath,
  sampleWorkbookAdapter,
} from "../ingestion/adapters/sampleWorkbook.js";
import { correlateReadySignals } from "../risk/correlation.js";

const SOURCE_LABEL = "CyberCommandCenter_Tool_To_Risk_Domain_Solution.xlsx";

async function ensureSampleConnector(orgId: string): Promise<string> {
  const { rows: existing } = await query<{ connector_id: string }>(
    `SELECT connector_id FROM connectors
     WHERE org_id=$1 AND adapter_key=$2 AND name=$3 LIMIT 1`,
    [orgId, SAMPLE_WORKBOOK_ADAPTER_KEY, SAMPLE_WORKBOOK_CONNECTOR_NAME],
  );
  if (existing[0]) return existing[0].connector_id;

  const { rows: domain } = await query<{ risk_domain_id: string }>(
    `SELECT risk_domain_id FROM risk_domains WHERE code::text = 'unmapped' LIMIT 1`,
  );
  if (!domain[0]) {
    throw new Error("unmapped risk domain missing — apply migrations");
  }
  const { rows: ins } = await query<{ connector_id: string }>(
    `INSERT INTO connectors (
       org_id, name, connector_type, risk_domain_id, adapter_key, status,
       credentials_reference, config_nonsecret, vendor
     ) VALUES (
       $1,$2,'demo',$3,$4,'active',
       'secret://local/sample-workbook',
       $5::jsonb,
       'ecc-sample-workbook'
     ) RETURNING connector_id`,
    [
      orgId,
      SAMPLE_WORKBOOK_CONNECTOR_NAME,
      domain[0].risk_domain_id,
      SAMPLE_WORKBOOK_ADAPTER_KEY,
      JSON.stringify({
        fixturePath: "reference/sample_workbook_products_and_samples.json",
        sourceWorkbook: SOURCE_LABEL,
        synthetic: true,
      }),
    ],
  );
  return ins[0]!.connector_id;
}

/** Reset only sample-workbook connector artifacts for this org */
export async function resetSampleWorkbookIngestion(orgId: string) {
  const { rows: conn } = await query<{ connector_id: string }>(
    `SELECT connector_id FROM connectors
     WHERE org_id=$1 AND adapter_key=$2`,
    [orgId, SAMPLE_WORKBOOK_ADAPTER_KEY],
  );
  if (!conn[0]) {
    return { ok: true, message: "No sample workbook connector to reset", deleted: 0 };
  }
  const cid = conn[0].connector_id;
  await query(
    `DELETE FROM security_signals WHERE org_id=$1 AND connector_id=$2`,
    [orgId, cid],
  );
  await query(`DELETE FROM raw_events WHERE org_id=$1 AND connector_id=$2`, [orgId, cid]);
  await query(
    `DELETE FROM sample_workbook_runs WHERE org_id=$1`,
    [orgId],
  );
  await query(
    `DELETE FROM connector_sync_runs WHERE org_id=$1 AND connector_id=$2`,
    [orgId, cid],
  );
  return {
    ok: true,
    message: "Sample workbook ingestion artifacts cleared (demo connector only)",
    connectorId: cid,
  };
}

export async function runSampleWorkbookIngestion(
  orgId: string,
  opts?: { correlate?: boolean },
) {
  if (process.env.ECC_ENABLE_SAMPLE_INGESTION === "false") {
    throw Object.assign(new Error("Sample workbook ingestion disabled"), {
      statusCode: 403,
    });
  }

  const fixturePath = resolveWorkbookFixturePath({});
  const rows = loadWorkbookRows(fixturePath);
  const connectorId = await ensureSampleConnector(orgId);

  const { rows: runIns } = await query<{ run_id: string }>(
    `INSERT INTO sample_workbook_runs (org_id, connector_id, status, source_path, records_received)
     VALUES ($1,$2,'running',$3,$4) RETURNING run_id`,
    [orgId, connectorId, SOURCE_LABEL, rows.length],
  );
  const runId = runIns[0]!.run_id;

  const { rows: syncIns } = await query<{ sync_run_id: string }>(
    `INSERT INTO connector_sync_runs (
       org_id, connector_id, status, started_at, records_received, events_received
     ) VALUES ($1,$2,'running',now(),$3,$3) RETURNING sync_run_id`,
    [orgId, connectorId, rows.length],
  );
  const syncRunId = syncIns[0]!.sync_run_id;

  await query(
    `UPDATE sample_workbook_runs SET sync_run_id=$2 WHERE org_id=$1 AND run_id=$3`,
    [orgId, syncRunId, runId],
  );

  try {
    const ctx = {
      orgId,
      connectorId,
      connectorName: SAMPLE_WORKBOOK_CONNECTOR_NAME,
      riskDomainId: "",
      domainCode: "unmapped",
      config: {
        fixturePath: "reference/sample_workbook_products_and_samples.json",
      },
    };
    const events = await sampleWorkbookAdapter.fetch(ctx);
    const result = await ingestAndNormalize({
      orgId,
      connectorId,
      syncRunId,
      events,
      normalize: (raw) => sampleWorkbookAdapter.normalize(raw, ctx),
    });

    let correlated = 0;
    if (opts?.correlate !== false) {
      correlated = await correlateReadySignals(orgId);
    }

    const summary = {
      ...result,
      correlatedScenariosTouched: correlated,
      source: SOURCE_LABEL,
      synthetic: true,
      note: "Workbook Domain Risk Calc is NOT the ECC risk engine",
    };

    await query(
      `UPDATE connector_sync_runs SET
         status = $2,
         completed_at = now(),
         records_processed = $3,
         records_failed = $4,
         events_received = $5,
         events_accepted = $6,
         events_rejected = $7,
         events_deduplicated = $8,
         unresolved_assets = $9,
         unresolved_identities = $10,
         missing_timestamps = $11,
         missing_severity = $12,
         unknown_event_types = $13,
         canonical_records = $14,
         posture_metrics = $15,
         event_signals = $16,
         assessment_signals = $17,
         compliance_observations = $18,
         unmapped_domains = $19,
         ready_for_correlation = $20,
         metadata = $21::jsonb
       WHERE sync_run_id = $1`,
      [
        syncRunId,
        result.errorCount > 0 && result.acceptedCount === 0 ? "failed" : "succeeded",
        result.acceptedCount + result.duplicateCount,
        result.rejectedCount + result.errorCount,
        result.receivedCount,
        result.acceptedCount,
        result.rejectedCount,
        result.duplicateCount,
        result.unresolvedAssets,
        result.unresolvedIdentities,
        result.missingTimestamps,
        result.missingSeverity,
        result.unknownEventTypes,
        result.acceptedCount,
        result.postureMetrics,
        result.eventSignals,
        result.assessmentSignals,
        result.complianceObservations,
        result.unmappedDomains,
        result.readyForCorrelation,
        JSON.stringify(summary),
      ],
    );

    await query(
      `UPDATE sample_workbook_runs SET
         status='completed', completed_at=now(), result_summary=$2::jsonb
       WHERE org_id=$1 AND run_id=$3`,
      [orgId, JSON.stringify(summary), runId],
    );

    return {
      runId,
      syncRunId,
      connectorId,
      source: SOURCE_LABEL,
      status: "completed" as const,
      result: summary,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE connector_sync_runs SET status='failed', completed_at=now(), error_summary=$2
       WHERE sync_run_id=$1`,
      [syncRunId, msg],
    );
    await query(
      `UPDATE sample_workbook_runs SET status='failed', completed_at=now(),
         result_summary=$2::jsonb WHERE org_id=$1 AND run_id=$3`,
      [orgId, JSON.stringify({ error: msg }), runId],
    );
    throw err;
  }
}

export async function getSampleWorkbookStatus(orgId: string) {
  const { rows } = await query(
    `SELECT run_id, connector_id, sync_run_id, status, source_path,
            records_received, result_summary, started_at, completed_at
     FROM sample_workbook_runs
     WHERE org_id=$1
     ORDER BY started_at DESC LIMIT 1`,
    [orgId],
  );
  if (!rows[0]) {
    return {
      status: "idle" as const,
      source: SOURCE_LABEL,
      message: "No sample workbook run yet",
    };
  }
  return {
    status: rows[0].status,
    source: rows[0].source_path,
    runId: rows[0].run_id,
    syncRunId: rows[0].sync_run_id,
    connectorId: rows[0].connector_id,
    recordsReceived: rows[0].records_received,
    result: rows[0].result_summary,
    startedAt: rows[0].started_at,
    completedAt: rows[0].completed_at,
  };
}

export async function getSampleWorkbookResults(orgId: string) {
  const status = await getSampleWorkbookStatus(orgId);
  const { rows: conn } = await query<{ connector_id: string }>(
    `SELECT connector_id FROM connectors
     WHERE org_id=$1 AND adapter_key=$2 LIMIT 1`,
    [orgId, SAMPLE_WORKBOOK_ADAPTER_KEY],
  );
  if (!conn[0]) {
    return { status, byDomain: [], samples: [], metrics: null };
  }
  const cid = conn[0].connector_id;

  const { rows: byDomain } = await query<{
    domain_code: string;
    short_label: string;
    source_records: string;
    normalized_records: string;
    posture: string;
    events: string;
    unresolved: string;
    missing_ts: string;
  }>(
    `SELECT d.code::text AS domain_code, d.short_label,
            COUNT(*)::text AS source_records,
            COUNT(*) FILTER (WHERE s.lifecycle_status IN ('ready_for_correlation','deduplicated','normalized'))::text AS normalized_records,
            COUNT(*) FILTER (WHERE s.signal_kind = 'posture_metric')::text AS posture,
            COUNT(*) FILTER (WHERE s.signal_kind = 'event')::text AS events,
            COUNT(*) FILTER (WHERE s.unresolved_identifiers IS NOT NULL AND s.unresolved_identifiers::text NOT IN ('[]','null'))::text AS unresolved,
            COUNT(*) FILTER (WHERE s.missing_timestamp)::text AS missing_ts
     FROM security_signals s
     JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     WHERE s.org_id=$1 AND s.connector_id=$2
     GROUP BY d.code, d.short_label
     ORDER BY d.short_label`,
    [orgId, cid],
  );

  const { rows: samples } = await query(
    `SELECT s.signal_id, s.title, s.signal_kind::text, s.metric_id, s.event_type,
            s.severity::text, s.lifecycle_status::text, s.quality_flag,
            s.numerator, s.denominator, s.raw_event_id, s.observed_at,
            d.code::text AS domain_code, d.short_label,
            s.source_name, s.missing_timestamp, s.unmapped_domain
     FROM security_signals s
     JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     WHERE s.org_id=$1 AND s.connector_id=$2 AND s.is_duplicate = false
     ORDER BY s.ingested_at DESC
     LIMIT 40`,
    [orgId, cid],
  );

  const metrics = (status as { result?: Record<string, unknown> }).result ?? null;

  return {
    status,
    metrics,
    byDomain: byDomain.map((r) => ({
      domainCode: r.domain_code,
      label: r.short_label,
      sourceRecords: Number(r.source_records),
      normalizedRecords: Number(r.normalized_records),
      posture: Number(r.posture),
      events: Number(r.events),
      unresolved: Number(r.unresolved),
      missingTimestamps: Number(r.missing_ts),
      qualityState:
        Number(r.missing_ts) > 0 || Number(r.unresolved) > 0 ? "attention" : "ok",
    })),
    samples: samples.map((s) => ({
      signalId: s.signal_id,
      title: s.title,
      signalKind: s.signal_kind,
      metricId: s.metric_id,
      eventType: s.event_type,
      severity: s.severity,
      lifecycle: s.lifecycle_status,
      qualityFlag: s.quality_flag,
      numerator: s.numerator != null ? Number(s.numerator) : null,
      denominator: s.denominator != null ? Number(s.denominator) : null,
      rawEventId: s.raw_event_id,
      observedAt: s.observed_at,
      domainCode: s.domain_code,
      domainLabel: s.short_label,
      product: s.source_name,
      missingTimestamp: s.missing_timestamp,
      unmappedDomain: s.unmapped_domain,
    })),
  };
}

/** Full ingestion trace for one signal: source → raw → canonical → resolution → dedupe */
export async function getIngestionTrace(orgId: string, signalId: string) {
  const { rows: sig } = await query(
    `SELECT s.*, d.code::text AS domain_code, d.short_label
     FROM security_signals s
     LEFT JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     WHERE s.org_id=$1 AND s.signal_id=$2::uuid`,
    [orgId, signalId],
  );
  if (!sig[0]) return null;

  const s = sig[0];
  const { rows: raw } = await query(
    `SELECT * FROM raw_events WHERE org_id=$1 AND raw_event_id=$2`,
    [orgId, s.raw_event_id],
  );
  const { rows: unresolved } = await query(
    `SELECT id_type, id_value, normalized_value
     FROM unresolved_signal_identifiers WHERE org_id=$1 AND signal_id=$2`,
    [orgId, signalId],
  );
  const { rows: lifecycle } = await query(
    `SELECT from_status, to_status, reason, created_at
     FROM signal_lifecycle_events WHERE org_id=$1 AND signal_id=$2
     ORDER BY created_at`,
    [orgId, signalId],
  );

  const rawPayload = raw[0]?.payload;
  const sourceMeta =
    raw[0]?.source_metadata && typeof raw[0].source_metadata === "object"
      ? raw[0].source_metadata
      : {};

  return {
    steps: [
      {
        step: "SOURCE_ROW",
        label: "Source workbook row (synthetic)",
        data: sourceMeta,
      },
      {
        step: "RAW_EVENT",
        label: "Raw event — original payload preserved",
        data: {
          rawEventId: raw[0]?.raw_event_id,
          contentType: raw[0]?.content_type,
          payloadHash: raw[0]?.payload_hash,
          processingStatus: raw[0]?.processing_status,
          observedAt: raw[0]?.observed_at,
          payload: rawPayload,
        },
      },
      {
        step: "CANONICAL",
        label: "Canonical signal / observation",
        data: {
          signalId: s.signal_id,
          signalKind: s.signal_kind,
          domainCode: s.domain_code,
          eventType: s.event_type,
          severity: s.severity,
          metricId: s.metric_id,
          numerator: s.numerator,
          denominator: s.denominator,
          qualityFlag: s.quality_flag,
          title: s.title,
          observedAt: s.observed_at,
          note: "ECC does not reuse workbook Domain Risk Calc scores",
        },
      },
      {
        step: "ENTITY_RESOLUTION",
        label: "Entity resolution",
        data: {
          assetId: s.asset_id,
          unresolvedIdentifiers: unresolved,
          businessUnitId: s.business_unit_id,
          businessProcessId: s.business_process_id,
        },
      },
      {
        step: "DEDUPLICATION",
        label: "Deduplication",
        data: {
          isDuplicate: s.is_duplicate,
          duplicateOf: s.duplicate_of_signal_id,
          fingerprint: s.fingerprint,
        },
      },
      {
        step: "READY_FOR_CORRELATION",
        label: "Risk-ready data",
        data: {
          lifecycle: s.lifecycle_status,
          correlationEligible: s.signal_kind === "event" && !s.is_duplicate,
          lifecycleEvents: lifecycle,
          explanation:
            s.signal_kind === "event"
              ? "Event signals may enter the Phase 3 correlation engine"
              : "Posture/assessment/compliance observations feed intelligence quality views; they do not invent scenarios",
        },
      },
    ],
  };
}
