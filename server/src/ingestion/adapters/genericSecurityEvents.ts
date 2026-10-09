import type {
  AdapterContext,
  CanonicalSecuritySignalV1,
  ConnectorAdapter,
  RawEventInput,
} from "../types.js";

/**
 * Synthetic/demo adapter — NOT a vendor simulation.
 * Proves: connector → raw → canonical → resolve → dedupe → ready_for_correlation
 */
export const genericSecurityEventsAdapter: ConnectorAdapter = {
  adapterKey: "generic_security_events",

  validateConfiguration(config) {
    const errors: string[] = [];
    if (config && typeof config !== "object") {
      errors.push("configuration must be an object");
    }
    return { ok: errors.length === 0, errors };
  },

  async testConnection(ctx) {
    return {
      ok: true,
      message: `Demo adapter ready for connector ${ctx.connectorName} (no external network call)`,
    };
  },

  async fetch(ctx) {
    const now = new Date();
    const iso = (offsetSec: number) =>
      new Date(now.getTime() - offsetSec * 1000).toISOString();

    // Four synthetic events covering severities / domains
    return [
      {
        externalEventId: `demo-malware-${ctx.connectorId.slice(0, 8)}`,
        observedAt: iso(120),
        contentType: "application/json",
        payload: {
          kind: "malware_detection",
          severity: "critical",
          hostname: "web-prod-01",
          ip: "10.10.10.10",
          indicator: "sha256:deadbeefdemo0001",
          summary: "Critical malware detection on a server",
        },
        sourceMetadata: { generator: "generic_security_events", scenario: 1 },
      },
      {
        externalEventId: `demo-priv-${ctx.connectorId.slice(0, 8)}`,
        observedAt: iso(90),
        payload: {
          kind: "privilege_escalation",
          severity: "high",
          hostname: "jump-host-02",
          username: "svc_backup",
          summary: "High privilege escalation event",
        },
        sourceMetadata: { generator: "generic_security_events", scenario: 2 },
      },
      {
        externalEventId: `demo-cloud-${ctx.connectorId.slice(0, 8)}`,
        observedAt: iso(60),
        payload: {
          kind: "public_exposure",
          severity: "medium",
          cloud_resource_id: "arn:aws:s3:::demo-public-bucket",
          summary: "Medium public cloud exposure",
        },
        sourceMetadata: { generator: "generic_security_events", scenario: 3 },
      },
      {
        externalEventId: `demo-auth-${ctx.connectorId.slice(0, 8)}`,
        observedAt: iso(30),
        payload: {
          kind: "authentication_anomaly",
          severity: "low",
          hostname: "vpn-gateway",
          username: "j.smith",
          summary: "Low authentication anomaly",
        },
        sourceMetadata: { generator: "generic_security_events", scenario: 4 },
      },
    ];
  },

  normalize(raw: RawEventInput, ctx: AdapterContext): CanonicalSecuritySignalV1 {
    const p = raw.payload;
    const kind = String(p.kind ?? "unknown_event");
    const severityRaw = String(p.severity ?? "medium");
    const severity = (
      ["info", "low", "medium", "high", "critical"].includes(severityRaw)
        ? severityRaw
        : "medium"
    ) as NonNullable<CanonicalSecuritySignalV1["severity"]>;

    const domainByKind: Record<string, string> = {
      malware_detection: "soc_mdr",
      privilege_escalation: "iam_pam",
      public_exposure: "cspm_cnapp",
      authentication_anomaly: "iam_pam",
    };

    const identifiers = [];
    if (p.hostname) {
      identifiers.push({ idType: "hostname", idValue: String(p.hostname) });
    }
    if (p.ip) {
      identifiers.push({ idType: "ip", idValue: String(p.ip) });
    }
    if (p.cloud_resource_id) {
      identifiers.push({
        idType: "cloud_resource_id",
        idValue: String(p.cloud_resource_id),
      });
    }

    const evidenceRefs = [];
    if (p.indicator) {
      evidenceRefs.push({
        kind: "hash",
        value: String(p.indicator),
        label: "indicator",
      });
    }

    return {
      orgId: ctx.orgId,
      connectorId: ctx.connectorId,
      sourceType:
        kind === "public_exposure"
          ? "cloud"
          : kind === "privilege_escalation" || kind === "authentication_anomaly"
            ? "iam"
            : "soc",
      sourceName: "generic_security_events",
      domainCode: domainByKind[kind] ?? ctx.domainCode,
      signalKind: "event",
      eventType: kind,
      severity,
      vendorSeverity: String(p.severity ?? ""),
      title: String(p.summary ?? kind),
      observedAt: raw.observedAt ?? new Date().toISOString(),
      identifiers,
      // Do NOT map username → ECC user_id
      securityIdentityRef: p.username ? String(p.username) : null,
      evidenceRefs,
      vendorMetadata: {
        vendor: "ecc-demo",
        product: "Generic Security Events",
        integrationVersion: "1.0.0",
        sourceEventType: kind,
        sourceSeverity: String(p.severity ?? ""),
        sourceRecordId: raw.externalEventId,
        generator: "generic_security_events",
      },
    };
  },

  async healthCheck(ctx) {
    return this.testConnection(ctx);
  },
};
