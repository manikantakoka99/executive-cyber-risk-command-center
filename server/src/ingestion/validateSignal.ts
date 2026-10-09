import { query } from "../db.js";
import type { CanonicalSecuritySignalV1, CanonicalSeverity } from "./types.js";

const SEVERITIES = new Set<CanonicalSeverity>([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

export type ValidationFailure = { field: string; reason: string };

export async function validateCanonicalSignal(
  signal: CanonicalSecuritySignalV1,
): Promise<{ ok: true } | { ok: false; failures: ValidationFailure[] }> {
  const failures: ValidationFailure[] = [];

  const kind = signal.signalKind ?? "event";

  if (!signal.orgId) failures.push({ field: "orgId", reason: "required" });
  if (!signal.connectorId) failures.push({ field: "connectorId", reason: "required" });
  if (!signal.sourceType) failures.push({ field: "sourceType", reason: "required" });
  if (!signal.sourceName) failures.push({ field: "sourceName", reason: "required" });
  if (!signal.eventType) failures.push({ field: "eventType", reason: "required" });

  // Events require severity when present in source — do not invent for posture
  if (kind === "event" && !signal.severity && !signal.vendorSeverity) {
    // Allow missing severity with quality_flag; do not reject purely for this
  }
  if (signal.severity && !SEVERITIES.has(signal.severity)) {
    failures.push({
      field: "severity",
      reason: `invalid severity '${signal.severity}' — expected info|low|medium|high|critical`,
    });
  }

  if (kind === "event" && !signal.observedAt && !signal.missingTimestamp) {
    failures.push({
      field: "observedAt",
      reason: "required for events unless missingTimestamp is marked",
    });
  }
  if (signal.observedAt) {
    const obs = Date.parse(signal.observedAt);
    if (Number.isNaN(obs)) {
      failures.push({ field: "observedAt", reason: "malformed timestamp" });
    }
  }
  if (kind === "posture_metric") {
    if (signal.metricId == null) {
      failures.push({ field: "metricId", reason: "required for posture_metric" });
    }
  }

  // org exists
  const { rows: org } = await query(`SELECT 1 FROM organizations WHERE org_id = $1`, [
    signal.orgId,
  ]);
  if (!org[0]) failures.push({ field: "orgId", reason: "organization not found" });

  // connector belongs to org
  const { rows: conn } = await query<{ risk_domain_id: string }>(
    `SELECT risk_domain_id FROM connectors WHERE org_id = $1 AND connector_id = $2`,
    [signal.orgId, signal.connectorId],
  );
  if (!conn[0]) {
    failures.push({ field: "connectorId", reason: "connector not found in organization" });
  }

  // source type
  const { rows: st } = await query(
    `SELECT 1 FROM signal_source_types WHERE code = $1 AND is_active = true`,
    [signal.sourceType],
  );
  if (!st[0]) {
    failures.push({ field: "sourceType", reason: `unknown source_type '${signal.sourceType}'` });
  }

  // event type taxonomy
  const { rows: et } = await query(
    `SELECT 1 FROM signal_event_types WHERE code = $1 AND is_active = true`,
    [signal.eventType],
  );
  if (!et[0]) {
    failures.push({
      field: "eventType",
      reason: `unknown event_type '${signal.eventType}' — use taxonomy or unknown_event`,
    });
  }

  // domain (compare as text — never cast untrusted input to enum)
  if (signal.domainCode) {
    const { rows: d } = await query(
      `SELECT 1 FROM risk_domains WHERE code::text = $1`,
      [signal.domainCode],
    );
    if (!d[0]) {
      failures.push({ field: "domainCode", reason: `invalid domain '${signal.domainCode}'` });
    }
  }

  // raw event same org
  if (signal.rawEventId) {
    const { rows: re } = await query(
      `SELECT 1 FROM raw_events WHERE org_id = $1 AND raw_event_id = $2`,
      [signal.orgId, signal.rawEventId],
    );
    if (!re[0]) {
      failures.push({ field: "rawEventId", reason: "raw event not in organization" });
    }
  }

  // finding same org
  if (signal.findingId) {
    const { rows: f } = await query(
      `SELECT 1 FROM risk_findings WHERE org_id = $1 AND finding_id = $2`,
      [signal.orgId, signal.findingId],
    );
    if (!f[0]) {
      failures.push({
        field: "findingId",
        reason: "finding not in organization (cross-tenant rejected)",
      });
    }
  }

  // ECC user same org (if set)
  if (signal.eccUserId) {
    const { rows: u } = await query(
      `SELECT 1 FROM users WHERE org_id = $1 AND user_id = $2`,
      [signal.orgId, signal.eccUserId],
    );
    if (!u[0]) {
      failures.push({
        field: "eccUserId",
        reason: "user is not an ECC login user in this organization",
      });
    }
  }

  // business context same org
  if (signal.businessUnitId) {
    const { rows: bu } = await query(
      `SELECT 1 FROM business_units WHERE org_id = $1 AND business_unit_id = $2`,
      [signal.orgId, signal.businessUnitId],
    );
    if (!bu[0]) {
      failures.push({ field: "businessUnitId", reason: "business unit not in organization" });
    }
  }
  if (signal.businessProcessId) {
    const { rows: bp } = await query(
      `SELECT 1 FROM business_processes WHERE org_id = $1 AND business_process_id = $2`,
      [signal.orgId, signal.businessProcessId],
    );
    if (!bp[0]) {
      failures.push({
        field: "businessProcessId",
        reason: "business process not in organization",
      });
    }
  }

  // vendor metadata structural check
  if (signal.vendorMetadata !== undefined && signal.vendorMetadata !== null) {
    if (typeof signal.vendorMetadata !== "object" || Array.isArray(signal.vendorMetadata)) {
      failures.push({ field: "vendorMetadata", reason: "must be a JSON object" });
    }
  }

  if (failures.length) return { ok: false, failures };
  return { ok: true };
}

export async function resolveDomainId(
  orgId: string,
  domainCode: string | undefined,
  sourceType: string,
): Promise<{ riskDomainId: string; domainCode: string; unmapped: boolean }> {
  let code = domainCode;
  if (!code) {
    const { rows } = await query<{ domain_code: string | null }>(
      `SELECT domain_code::text AS domain_code FROM signal_source_types WHERE code = $1`,
      [sourceType],
    );
    code = rows[0]?.domain_code ?? "unmapped";
  }

  const { rows: d } = await query<{ risk_domain_id: string; code: string }>(
    `SELECT risk_domain_id, code::text AS code FROM risk_domains WHERE code::text = $1`,
    [code],
  );
  if (!d[0]) {
    const { rows: u } = await query<{ risk_domain_id: string }>(
      `SELECT risk_domain_id FROM risk_domains WHERE code = 'unmapped'`,
    );
    return {
      riskDomainId: u[0].risk_domain_id,
      domainCode: "unmapped",
      unmapped: true,
    };
  }

  // Prefer subscribed domain; if org not subscribed, still allow but mark path via unmapped only when code unknown
  const { rows: sub } = await query(
    `SELECT 1 FROM org_domain_subscriptions
     WHERE org_id = $1 AND risk_domain_id = $2 AND is_active = true`,
    [orgId, d[0].risk_domain_id],
  );
  // Unmapped domain or subscribed domain OK; non-subscribed still accepted (signal retained)
  void sub;
  return {
    riskDomainId: d[0].risk_domain_id,
    domainCode: d[0].code,
    unmapped: d[0].code === "unmapped",
  };
}
