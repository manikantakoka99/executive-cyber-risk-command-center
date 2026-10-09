/** Canonical Security Signal v1 — vendor-neutral contract */

export type CanonicalSeverity = "info" | "low" | "medium" | "high" | "critical";

export type SignalKind =
  | "event"
  | "posture_metric"
  | "assessment"
  | "compliance_observation";

export type SignalLifecycle =
  | "received"
  | "parsed"
  | "validated"
  | "normalized"
  | "resolved"
  | "deduplicated"
  | "ready_for_correlation"
  | "rejected"
  | "error";

export type SourceIdentifier = {
  idType: string; // ip | hostname | fqdn | cloud_resource_id | application_id | url | device_id | …
  idValue: string;
};

export type EvidenceRef = {
  kind: string; // url | hash | indicator | log_snippet | field_ref
  value: string;
  label?: string;
};

/** Vendor/source extensions — never pollute canonical columns */
export type VendorMetadata = {
  vendor?: string;
  product?: string;
  integrationVersion?: string;
  sourceEventType?: string;
  sourceSeverity?: string;
  sourceRecordId?: string;
  sourceUrl?: string;
  sourceTags?: string[];
  sourceLabels?: Record<string, string>;
  [key: string]: unknown;
};

/**
 * Intermediate object produced by adapters / normalize step.
 * Persistable as security_signals after validation + resolution.
 */
export type CanonicalSecuritySignalV1 = {
  orgId: string;
  connectorId: string;
  rawEventId?: string;

  sourceType: string;
  sourceName: string;

  domainCode?: string; // maps to risk_domains.code; omit → resolve via source_type
  signalKind?: SignalKind;
  eventType: string;
  /** Required for events; must NOT be fabricated for posture metrics */
  severity?: CanonicalSeverity | null;
  vendorSeverity?: string;

  title?: string;
  /** ISO when present in source; never invent "now" for event time */
  observedAt?: string | null;
  missingTimestamp?: boolean;
  unmappedDomain?: boolean;
  ingestedAt?: string;
  processedAt?: string;

  metricId?: string | null;
  numerator?: number | null;
  denominator?: number | null;
  qualityFlag?: string | null;
  toolCategory?: string | null;

  /** Identifiers used for entity resolution (not free-text-only asset names) */
  identifiers?: SourceIdentifier[];

  /** Optional ECC login user — only when known to be an app user */
  eccUserId?: string | null;
  /** External security identity (username/SID) — NOT an ECC users.user_id */
  securityIdentityRef?: string | null;

  findingId?: string | null;

  evidenceRefs?: EvidenceRef[];
  vendorMetadata?: VendorMetadata;

  businessUnitId?: string | null;
  businessProcessId?: string | null;
};

export type IngestionResult = {
  receivedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  errorCount: number;
  unresolvedAssets: number;
  unresolvedIdentities: number;
  unresolvedFindings: number;
  missingTimestamps: number;
  missingSeverity: number;
  unknownEventTypes: number;
  unmappedDomains: number;
  postureMetrics: number;
  eventSignals: number;
  assessmentSignals: number;
  complianceObservations: number;
  readyForCorrelation: number;
  rawEventIds: string[];
  signalIds: string[];
  syncRunId?: string;
  errors: Array<{ externalEventId?: string; reason: string }>;
};

export type RawEventInput = {
  externalEventId?: string;
  observedAt?: string | null;
  contentType?: string;
  /** Structural JSON wrapper; original source bytes preserved under payload.original */
  payload: Record<string, unknown>;
  sourceMetadata?: Record<string, unknown>;
};

export interface ConnectorAdapter {
  readonly adapterKey: string;
  validateConfiguration(config: Record<string, unknown> | null): { ok: boolean; errors: string[] };
  testConnection(ctx: AdapterContext): Promise<{ ok: boolean; message: string }>;
  fetch(ctx: AdapterContext): Promise<RawEventInput[]>;
  normalize(raw: RawEventInput, ctx: AdapterContext): CanonicalSecuritySignalV1;
  healthCheck(ctx: AdapterContext): Promise<{ ok: boolean; message: string }>;
}

export type AdapterContext = {
  orgId: string;
  connectorId: string;
  connectorName: string;
  riskDomainId: string;
  domainCode: string;
  config: Record<string, unknown>;
};
