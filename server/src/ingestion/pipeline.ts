import { query } from "../db.js";
import {
  buildIdempotencyKey,
  computePayloadHash,
  computeSignalFingerprint,
} from "./fingerprint.js";
import { resolveAssetFromIdentifiers } from "./entityResolution.js";
import { resolveDomainId, validateCanonicalSignal } from "./validateSignal.js";
import type {
  CanonicalSecuritySignalV1,
  IngestionResult,
  RawEventInput,
} from "./types.js";

async function recordLifecycle(
  orgId: string,
  signalId: string,
  fromStatus: string | null,
  toStatus: string,
  reason?: string,
) {
  await query(
    `INSERT INTO signal_lifecycle_events (org_id, signal_id, from_status, to_status, reason)
     VALUES ($1, $2, $3::signal_lifecycle, $4::signal_lifecycle, $5)`,
    [orgId, signalId, fromStatus, toStatus, reason ?? null],
  );
}

/**
 * Ingest raw events (idempotent), normalize via caller-supplied normalize fn,
 * validate, resolve entities, dedupe → ready_for_correlation.
 */
export async function ingestAndNormalize(opts: {
  orgId: string;
  connectorId: string;
  syncRunId?: string;
  events: RawEventInput[];
  normalize: (raw: RawEventInput) => CanonicalSecuritySignalV1;
}): Promise<IngestionResult> {
  const result: IngestionResult = {
    receivedCount: opts.events.length,
    acceptedCount: 0,
    rejectedCount: 0,
    duplicateCount: 0,
    errorCount: 0,
    unresolvedAssets: 0,
    unresolvedIdentities: 0,
    unresolvedFindings: 0,
    missingTimestamps: 0,
    missingSeverity: 0,
    unknownEventTypes: 0,
    unmappedDomains: 0,
    postureMetrics: 0,
    eventSignals: 0,
    assessmentSignals: 0,
    complianceObservations: 0,
    readyForCorrelation: 0,
    rawEventIds: [],
    signalIds: [],
    syncRunId: opts.syncRunId,
    errors: [],
  };

  // Fail fast if connector is not in this org (tenant isolation)
  const { rows: connOk } = await query(
    `SELECT 1 FROM connectors WHERE org_id = $1 AND connector_id = $2`,
    [opts.orgId, opts.connectorId],
  );
  if (!connOk[0]) {
    result.errorCount = opts.events.length;
    result.errors.push({
      reason: "connector not found in organization (cross-tenant rejected)",
    });
    return result;
  }

  for (const raw of opts.events) {
    try {
      // Count missing timestamps after normalize (source may carry collected_at in payload)

      const payloadHash = computePayloadHash(raw.payload);
      const idempotencyKey = buildIdempotencyKey({
        externalEventId: raw.externalEventId,
        payloadHash,
        observedAt: raw.observedAt,
      });
      // Use external id when present; else hash+time (also stored as source_event_id)
      const sourceEventId = raw.externalEventId?.trim() || idempotencyKey;

      const inserted = await query<{ raw_event_id: string }>(
        `INSERT INTO raw_events (
           org_id, connector_id, source_event_id, event_type, source_timestamp,
           observed_at, payload, payload_hash, content_type, source_metadata,
           processing_status, idempotency_key
         ) VALUES (
           $1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb, $8, $9, $10::jsonb,
           'received', $11
         )
         ON CONFLICT (org_id, connector_id, source_event_id) DO NOTHING
         RETURNING raw_event_id`,
        [
          opts.orgId,
          opts.connectorId,
          sourceEventId,
          null,
          raw.observedAt ?? null,
          raw.observedAt ?? null,
          JSON.stringify(raw.payload),
          payloadHash,
          raw.contentType ?? "application/json",
          JSON.stringify(raw.sourceMetadata ?? {}),
          idempotencyKey,
        ],
      );

      if (!inserted.rows[0]) {
        result.duplicateCount += 1;
        continue;
      }

      const rawEventId = inserted.rows[0].raw_event_id;
      result.rawEventIds.push(rawEventId);

      // Preserve original payload — never mutate raw.payload after insert
      const canonical = opts.normalize(raw);
      canonical.orgId = opts.orgId;
      canonical.connectorId = opts.connectorId;
      canonical.rawEventId = rawEventId;

      const kind = canonical.signalKind ?? "event";
      // Only count missing severity for events — posture must not invent severity
      if (kind === "event" && !canonical.severity) result.missingSeverity += 1;
      if (canonical.missingTimestamp || !canonical.observedAt) {
        result.missingTimestamps += 1;
        canonical.missingTimestamp = true;
      }
      if (canonical.unmappedDomain) result.unmappedDomains += 1;
      if (kind === "posture_metric") result.postureMetrics += 1;
      else if (kind === "assessment") result.assessmentSignals += 1;
      else if (kind === "compliance_observation") result.complianceObservations += 1;
      else result.eventSignals += 1;

      await query(
        `UPDATE raw_events SET processing_status = 'parsed' WHERE raw_event_id = $1`,
        [rawEventId],
      );

      const validation = await validateCanonicalSignal(canonical);
      if (!validation.ok) {
        result.rejectedCount += 1;
        const reason = validation.failures.map((f) => `${f.field}: ${f.reason}`).join("; ");
        result.errors.push({ externalEventId: raw.externalEventId, reason });
        if (validation.failures.some((f) => f.field === "eventType")) {
          result.unknownEventTypes += 1;
        }
        await query(
          `UPDATE raw_events
           SET processing_status = 'rejected', processing_error = $2
           WHERE raw_event_id = $1`,
          [rawEventId, reason],
        );
        continue;
      }

      await query(
        `UPDATE raw_events SET processing_status = 'validated' WHERE raw_event_id = $1`,
        [rawEventId],
      );

      const domain = await resolveDomainId(
        opts.orgId,
        canonical.domainCode,
        canonical.sourceType,
      );
      canonical.domainCode = domain.domainCode;

      const resolved = await resolveAssetFromIdentifiers(
        opts.orgId,
        canonical.identifiers,
      );
      if (!resolved.assetId && (canonical.identifiers?.length ?? 0) > 0) {
        result.unresolvedAssets += 1;
      }
      if (canonical.securityIdentityRef) {
        // We intentionally do NOT bind to ECC users — count as unresolved identity for metrics
        result.unresolvedIdentities += 1;
      }
      if (canonical.findingId) {
        // already validated same-org; metric reserved for future soft refs
      }

      const buId = canonical.businessUnitId ?? resolved.businessUnitId;
      const bpId = canonical.businessProcessId ?? resolved.businessProcessId;
      const fingerprint = computeSignalFingerprint({
        ...canonical,
        domainCode: domain.domainCode,
      });

      // Dedup: existing non-duplicate with same fingerprint
      const { rows: existing } = await query<{ signal_id: string }>(
        `SELECT signal_id FROM security_signals
         WHERE org_id = $1 AND fingerprint = $2 AND is_duplicate = false
         LIMIT 1`,
        [opts.orgId, fingerprint],
      );

      const processedAt = new Date().toISOString();
      const ingestedAt = new Date().toISOString();

      if (existing[0]) {
        result.duplicateCount += 1;
        const { rows: dup } = await query<{ signal_id: string }>(
          `INSERT INTO security_signals (
             org_id, raw_event_id, connector_id, risk_domain_id, event_type, severity,
             vendor_severity, asset_id, related_user_id, observed_at, ingested_at, processed_at,
             title, normalized_payload, vendor_extensions, source_type, source_name,
             finding_id, business_unit_id, business_process_id, lifecycle_status,
             fingerprint, evidence_refs, security_identity_ref, unresolved_identifiers,
             sync_run_id, is_duplicate, duplicate_of_signal_id,
             signal_kind, metric_id, numerator, denominator, quality_flag, tool_category,
             missing_timestamp, unmapped_domain
           ) VALUES (
             $1,$2,$3,$4,$5,$6::severity_level,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12::timestamptz,
             $13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,'deduplicated',
             $21,$22::jsonb,$23,$24::jsonb,$25,true,$26,
             $27::signal_kind,$28,$29,$30,$31,$32,$33,$34
           ) RETURNING signal_id`,
          [
            opts.orgId,
            rawEventId,
            opts.connectorId,
            domain.riskDomainId,
            canonical.eventType,
            canonical.severity ?? null,
            canonical.vendorSeverity ?? null,
            resolved.assetId,
            canonical.eccUserId ?? null,
            canonical.observedAt ?? null,
            ingestedAt,
            processedAt,
            canonical.title ?? null,
            JSON.stringify({
              eventType: canonical.eventType,
              sourceType: canonical.sourceType,
              signalKind: kind,
              metricId: canonical.metricId ?? null,
            }),
            JSON.stringify(canonical.vendorMetadata ?? {}),
            canonical.sourceType,
            canonical.sourceName,
            canonical.findingId ?? null,
            buId,
            bpId,
            fingerprint,
            JSON.stringify(canonical.evidenceRefs ?? []),
            canonical.securityIdentityRef ?? null,
            JSON.stringify(resolved.unresolved),
            opts.syncRunId ?? null,
            existing[0].signal_id,
            kind,
            canonical.metricId ?? null,
            canonical.numerator ?? null,
            canonical.denominator ?? null,
            canonical.qualityFlag ?? null,
            canonical.toolCategory ?? null,
            canonical.missingTimestamp ?? false,
            canonical.unmappedDomain ?? false,
          ],
        );
        result.signalIds.push(dup[0].signal_id);
        await recordLifecycle(opts.orgId, dup[0].signal_id, null, "deduplicated", "fingerprint match");
        await query(
          `UPDATE raw_events SET processing_status = 'deduplicated' WHERE raw_event_id = $1`,
          [rawEventId],
        );

        for (const u of resolved.unresolved) {
          await query(
            `INSERT INTO unresolved_signal_identifiers
               (org_id, signal_id, id_type, id_value, normalized_value)
             VALUES ($1,$2,$3,$4,$5)`,
            [opts.orgId, dup[0].signal_id, u.idType, u.idValue, u.normalizedValue],
          );
        }
        continue;
      }

      const { rows: sig } = await query<{ signal_id: string }>(
        `INSERT INTO security_signals (
           org_id, raw_event_id, connector_id, risk_domain_id, event_type, severity,
           vendor_severity, asset_id, related_user_id, observed_at, ingested_at, processed_at,
           title, normalized_payload, vendor_extensions, source_type, source_name,
           finding_id, business_unit_id, business_process_id, lifecycle_status,
           fingerprint, evidence_refs, security_identity_ref, unresolved_identifiers,
           sync_run_id, is_duplicate,
           signal_kind, metric_id, numerator, denominator, quality_flag, tool_category,
           missing_timestamp, unmapped_domain
         ) VALUES (
           $1,$2,$3,$4,$5,$6::severity_level,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12::timestamptz,
           $13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,'ready_for_correlation',
           $21,$22::jsonb,$23,$24::jsonb,$25,false,
           $26::signal_kind,$27,$28,$29,$30,$31,$32,$33
         ) RETURNING signal_id`,
        [
          opts.orgId,
          rawEventId,
          opts.connectorId,
          domain.riskDomainId,
          canonical.eventType,
          canonical.severity ?? null,
          canonical.vendorSeverity ?? null,
          resolved.assetId,
          canonical.eccUserId ?? null,
          canonical.observedAt ?? null,
          ingestedAt,
          processedAt,
          canonical.title ?? null,
          JSON.stringify({
            eventType: canonical.eventType,
            sourceType: canonical.sourceType,
            signalKind: kind,
            identifiers: canonical.identifiers ?? [],
            metricId: canonical.metricId ?? null,
            numerator: canonical.numerator ?? null,
            denominator: canonical.denominator ?? null,
          }),
          JSON.stringify(canonical.vendorMetadata ?? {}),
          canonical.sourceType,
          canonical.sourceName,
          canonical.findingId ?? null,
          buId,
          bpId,
          fingerprint,
          JSON.stringify(canonical.evidenceRefs ?? []),
          canonical.securityIdentityRef ?? null,
          JSON.stringify(resolved.unresolved),
          opts.syncRunId ?? null,
          kind,
          canonical.metricId ?? null,
          canonical.numerator ?? null,
          canonical.denominator ?? null,
          canonical.qualityFlag ?? null,
          canonical.toolCategory ?? null,
          canonical.missingTimestamp ?? false,
          canonical.unmappedDomain ?? false,
        ],
      );

      const signalId = sig[0].signal_id;
      result.signalIds.push(signalId);
      result.acceptedCount += 1;
      result.readyForCorrelation += 1;

      await recordLifecycle(opts.orgId, signalId, null, "normalized");
      await recordLifecycle(opts.orgId, signalId, "normalized", "resolved");
      await recordLifecycle(
        opts.orgId,
        signalId,
        "resolved",
        "ready_for_correlation",
        kind === "event"
          ? "eligible for correlation (Phase 3+)"
          : "normalized observation — available to intelligence; correlation uses events only",
      );

      for (const u of resolved.unresolved) {
        await query(
          `INSERT INTO unresolved_signal_identifiers
             (org_id, signal_id, id_type, id_value, normalized_value)
           VALUES ($1,$2,$3,$4,$5)`,
          [opts.orgId, signalId, u.idType, u.idValue, u.normalizedValue],
        );
      }

      await query(
        `UPDATE raw_events SET processing_status = 'ready_for_correlation' WHERE raw_event_id = $1`,
        [rawEventId],
      );
    } catch (err) {
      result.errorCount += 1;
      result.errors.push({
        externalEventId: raw.externalEventId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
