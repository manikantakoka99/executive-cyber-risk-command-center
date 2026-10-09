import { query } from "../db.js";

export async function listSignals(
  orgId: string,
  opts?: { lifecycle?: string; limit?: number },
) {
  const limit = Math.min(opts?.limit ?? 100, 500);
  const params: unknown[] = [orgId];
  let where = "s.org_id = $1";
  if (opts?.lifecycle) {
    params.push(opts.lifecycle);
    where += ` AND s.lifecycle_status = $${params.length}::signal_lifecycle`;
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT s.*, d.code::text AS domain_code, d.short_label,
            a.name AS asset_name
     FROM security_signals s
     JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     LEFT JOIN assets a ON a.asset_id = s.asset_id AND a.org_id = s.org_id
     WHERE ${where}
     ORDER BY s.observed_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapSignal);
}

export async function getSignal(orgId: string, signalId: string) {
  const { rows } = await query(
    `SELECT s.*, d.code::text AS domain_code, d.short_label,
            a.name AS asset_name
     FROM security_signals s
     JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     LEFT JOIN assets a ON a.asset_id = s.asset_id AND a.org_id = s.org_id
     WHERE s.org_id = $1 AND s.signal_id = $2`,
    [orgId, signalId],
  );
  if (!rows[0]) return null;

  const { rows: lifecycle } = await query(
    `SELECT from_status, to_status, reason, created_at
     FROM signal_lifecycle_events
     WHERE org_id = $1 AND signal_id = $2
     ORDER BY created_at`,
    [orgId, signalId],
  );

  const { rows: unresolved } = await query(
    `SELECT id_type, id_value, normalized_value
     FROM unresolved_signal_identifiers
     WHERE org_id = $1 AND signal_id = $2`,
    [orgId, signalId],
  );

  const { rows: raw } = await query(
    `SELECT raw_event_id, payload_hash, processing_status, received_at, payload
     FROM raw_events WHERE org_id = $1 AND raw_event_id = $2`,
    [orgId, rows[0].raw_event_id],
  );

  return {
    ...mapSignal(rows[0]),
    lifecycle,
    unresolvedIdentifiers: unresolved,
    rawEvent: raw[0]
      ? {
          rawEventId: raw[0].raw_event_id,
          payloadHash: raw[0].payload_hash,
          processingStatus: raw[0].processing_status,
          receivedAt: raw[0].received_at,
          // Include payload for lineage proof — immutable source
          payload: raw[0].payload,
        }
      : null,
  };
}

function mapSignal(s: Record<string, unknown>) {
  return {
    signalId: s.signal_id,
    orgId: s.org_id,
    connectorId: s.connector_id,
    rawEventId: s.raw_event_id,
    domainCode: s.domain_code,
    domainLabel: s.short_label,
    signalKind: s.signal_kind,
    eventType: s.event_type,
    severity: s.severity,
    vendorSeverity: s.vendor_severity,
    sourceType: s.source_type,
    sourceName: s.source_name,
    title: s.title,
    metricId: s.metric_id,
    numerator: s.numerator != null ? Number(s.numerator) : null,
    denominator: s.denominator != null ? Number(s.denominator) : null,
    qualityFlag: s.quality_flag,
    toolCategory: s.tool_category,
    missingTimestamp: s.missing_timestamp,
    unmappedDomain: s.unmapped_domain,
    assetId: s.asset_id,
    assetName: s.asset_name,
    findingId: s.finding_id,
    businessUnitId: s.business_unit_id,
    businessProcessId: s.business_process_id,
    securityIdentityRef: s.security_identity_ref,
    observedAt: s.observed_at,
    ingestedAt: s.ingested_at,
    processedAt: s.processed_at,
    lifecycleStatus: s.lifecycle_status,
    rejectionReason: s.rejection_reason,
    fingerprint: s.fingerprint,
    evidenceRefs: s.evidence_refs,
    vendorMetadata: s.vendor_extensions,
    isDuplicate: s.is_duplicate,
    duplicateOfSignalId: s.duplicate_of_signal_id,
    unresolvedIdentifiers: s.unresolved_identifiers,
  };
}
