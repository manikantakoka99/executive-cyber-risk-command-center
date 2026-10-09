import { createHash } from "node:crypto";
import type { CanonicalSecuritySignalV1, EvidenceRef, SourceIdentifier } from "./types.js";

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${k}:${stableStringify(obj[k])}`).join(",")}}`;
}

function normId(id: SourceIdentifier): string {
  return `${id.idType.toLowerCase().trim()}=${id.idValue.toLowerCase().trim()}`;
}

function normEvidence(refs: EvidenceRef[] | undefined): string {
  if (!refs?.length) return "";
  return refs
    .map((r) => `${r.kind}:${r.value}`.toLowerCase())
    .sort()
    .join("|");
}

/** Deterministic fingerprint — never raw JSON key order */
export function computeSignalFingerprint(signal: CanonicalSecuritySignalV1): string {
  const kind = signal.signalKind ?? "event";
  // Posture metrics: org + product/source + metric_id + observed period (day bucket)
  if (kind === "posture_metric" || kind === "assessment" || kind === "compliance_observation") {
    const day =
      signal.observedAt && !Number.isNaN(Date.parse(signal.observedAt))
        ? new Date(signal.observedAt).toISOString().slice(0, 10)
        : "no-day";
    const parts = [
      signal.orgId,
      signal.sourceName.toLowerCase().trim(),
      signal.metricId ?? "",
      kind,
      day,
      String(signal.numerator ?? ""),
      String(signal.denominator ?? ""),
    ];
    return createHash("sha256").update(parts.join("|")).digest("hex");
  }

  const ids = (signal.identifiers ?? []).map(normId).sort().join(";");
  const obsMs = signal.observedAt ? Date.parse(signal.observedAt) : NaN;
  const bucket = Number.isNaN(obsMs)
    ? "no-time"
    : String(Math.floor(obsMs / (5 * 60 * 1000)));
  const parts = [
    signal.orgId,
    signal.connectorId,
    signal.domainCode ?? "",
    signal.eventType.toLowerCase().trim(),
    signal.severity ?? "none",
    ids,
    (signal.securityIdentityRef ?? "").toLowerCase().trim(),
    signal.findingId ?? "",
    normEvidence(signal.evidenceRefs),
    bucket,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function computePayloadHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function buildIdempotencyKey(opts: {
  externalEventId?: string | null;
  payloadHash: string;
  observedAt?: string | null;
}): string {
  if (opts.externalEventId && opts.externalEventId.trim()) {
    return `ext:${opts.externalEventId.trim()}`;
  }
  const obs = opts.observedAt ?? "no-time";
  return `hash:${opts.payloadHash}:${obs}`;
}
