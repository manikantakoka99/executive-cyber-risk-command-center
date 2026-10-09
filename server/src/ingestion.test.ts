import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { query } from "./db.js";
import { createConnector, runConnectorSync } from "./services/connectors.js";
import { getSignal, listSignals } from "./services/signals.js";
import { ingestAndNormalize } from "./ingestion/pipeline.js";
import { validateCanonicalSignal } from "./ingestion/validateSignal.js";
import { computePayloadHash } from "./ingestion/fingerprint.js";
import type { CanonicalSecuritySignalV1, RawEventInput } from "./ingestion/types.js";
import { genericSecurityEventsAdapter } from "./ingestion/adapters/genericSecurityEvents.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FAL = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";

let connectorId: string;
let socDomainId: string;

before(async () => {
  const { rows } = await query<{ risk_domain_id: string }>(
    `SELECT risk_domain_id FROM risk_domains WHERE code = 'soc_mdr'`,
  );
  socDomainId = rows[0].risk_domain_id;

  // Ensure a resolvable asset for Al Dhabi
  await query(
    `INSERT INTO assets (org_id, name, asset_type, criticality, environment, status)
     VALUES ($1, 'web-prod-01', 'host', 'high', 'production', 'active')
     ON CONFLICT (org_id, name) DO NOTHING`,
    [AL],
  );
  const { rows: a } = await query<{ asset_id: string }>(
    `SELECT asset_id FROM assets WHERE org_id = $1 AND name = 'web-prod-01'`,
    [AL],
  );
  await query(
    `INSERT INTO asset_identifiers (org_id, asset_id, id_type, id_value, is_primary)
     VALUES ($1, $2, 'hostname', 'web-prod-01', true)
     ON CONFLICT (org_id, id_type, id_value) DO NOTHING`,
    [AL, a[0].asset_id],
  );
  await query(
    `INSERT INTO asset_identifiers (org_id, asset_id, id_type, id_value)
     VALUES ($1, $2, 'ip', '10.10.10.10')
     ON CONFLICT (org_id, id_type, id_value) DO NOTHING`,
    [AL, a[0].asset_id],
  );

  const c = await createConnector(AL, {
    name: `Generic Security Events ${Date.now()}`,
    riskDomainId: socDomainId,
    adapterKey: "generic_security_events",
  });
  assert.ok(c);
  connectorId = c!.connectorId as string;
});

function baseSignal(over: Partial<CanonicalSecuritySignalV1> = {}): CanonicalSecuritySignalV1 {
  return {
    orgId: AL,
    connectorId,
    sourceType: "soc",
    sourceName: "generic_security_events",
    domainCode: "soc_mdr",
    eventType: "malware_detection",
    severity: "high",
    observedAt: new Date().toISOString(),
    title: "test",
    identifiers: [{ idType: "hostname", idValue: "web-prod-01" }],
    ...over,
  };
}

describe("canonical signal validation", () => {
  it("accepts a valid canonical signal", async () => {
    const v = await validateCanonicalSignal(baseSignal());
    assert.equal(v.ok, true);
  });

  it("rejects invalid severity", async () => {
    const v = await validateCanonicalSignal(
      baseSignal({ severity: "P1" as any }),
    );
    assert.equal(v.ok, false);
    if (!v.ok) assert.ok(v.failures.some((f) => f.field === "severity"));
  });

  it("rejects invalid domain", async () => {
    const v = await validateCanonicalSignal(
      baseSignal({ domainCode: "not_a_real_domain" }),
    );
    assert.equal(v.ok, false);
    if (!v.ok) assert.ok(v.failures.some((f) => f.field === "domainCode"));
  });

  it("rejects malformed timestamp", async () => {
    const v = await validateCanonicalSignal(
      baseSignal({ observedAt: "not-a-date" }),
    );
    assert.equal(v.ok, false);
    if (!v.ok) assert.ok(v.failures.some((f) => f.field === "observedAt"));
  });

  it("rejects cross-tenant finding reference", async () => {
    const { rows } = await query<{ finding_id: string }>(
      `SELECT finding_id FROM risk_findings WHERE org_id = $1 LIMIT 1`,
      [FAL],
    );
    assert.ok(rows[0]);
    const v = await validateCanonicalSignal(
      baseSignal({ findingId: rows[0].finding_id }),
    );
    assert.equal(v.ok, false);
    if (!v.ok) assert.ok(v.failures.some((f) => f.field === "findingId"));
  });
});

describe("ingestion pipeline", () => {
  it("detects duplicate raw events", async () => {
    const ext = `dup-raw-${Date.now()}`;
    const event: RawEventInput = {
      externalEventId: ext,
      observedAt: new Date().toISOString(),
      payload: { kind: "malware_detection", severity: "high", hostname: "web-prod-01" },
    };
    const ctx = {
      orgId: AL,
      connectorId,
      connectorName: "t",
      riskDomainId: socDomainId,
      domainCode: "soc_mdr",
      config: {},
    };
    const r1 = await ingestAndNormalize({
      orgId: AL,
      connectorId,
      events: [event],
      normalize: (raw) => genericSecurityEventsAdapter.normalize(raw, ctx),
    });
    const r2 = await ingestAndNormalize({
      orgId: AL,
      connectorId,
      events: [event],
      normalize: (raw) => genericSecurityEventsAdapter.normalize(raw, ctx),
    });
    assert.equal(r1.acceptedCount, 1);
    assert.equal(r2.duplicateCount, 1);
    assert.equal(r2.acceptedCount, 0);
  });

  it("detects duplicate signal fingerprints", async () => {
    const ts = new Date().toISOString();
    const make = (id: string): RawEventInput => ({
      externalEventId: id,
      observedAt: ts,
      payload: {
        kind: "malware_detection",
        severity: "critical",
        hostname: "web-prod-01",
        ip: "10.10.10.10",
        indicator: "sha256:same",
        summary: "same fingerprint",
      },
    });
    const ctx = {
      orgId: AL,
      connectorId,
      connectorName: "t",
      riskDomainId: socDomainId,
      domainCode: "soc_mdr",
      config: {},
    };
    const a = await ingestAndNormalize({
      orgId: AL,
      connectorId,
      events: [make(`fp-a-${Date.now()}`)],
      normalize: (raw) => genericSecurityEventsAdapter.normalize(raw, ctx),
    });
    const b = await ingestAndNormalize({
      orgId: AL,
      connectorId,
      events: [make(`fp-b-${Date.now()}`)],
      normalize: (raw) => genericSecurityEventsAdapter.normalize(raw, ctx),
    });
    assert.equal(a.acceptedCount, 1);
    assert.ok(b.duplicateCount >= 1);
  });

  it("resolves asset via identifier", async () => {
    const ctx = {
      orgId: AL,
      connectorId,
      connectorName: "t",
      riskDomainId: socDomainId,
      domainCode: "soc_mdr",
      config: {},
    };
    const r = await ingestAndNormalize({
      orgId: AL,
      connectorId,
      events: [
        {
          externalEventId: `resolve-${Date.now()}`,
          observedAt: new Date().toISOString(),
          payload: {
            kind: "malware_detection",
            severity: "high",
            hostname: "web-prod-01",
            summary: "resolve test",
          },
        },
      ],
      normalize: (raw) => genericSecurityEventsAdapter.normalize(raw, ctx),
    });
    assert.ok(r.acceptedCount + r.duplicateCount >= 1, JSON.stringify(r.errors));
    const sid = r.signalIds[0];
    assert.ok(sid);
    const sig = await getSignal(AL, sid);
    assert.ok(sig?.assetId, "expected resolved asset_id");
    assert.equal(sig?.assetName, "web-prod-01");
  });

  it("keeps unresolved asset identifiers traceable", async () => {
    const ctx = {
      orgId: AL,
      connectorId,
      connectorName: "t",
      riskDomainId: socDomainId,
      domainCode: "soc_mdr",
      config: {},
    };
    const r = await ingestAndNormalize({
      orgId: AL,
      connectorId,
      events: [
        {
          externalEventId: `unresolved-${Date.now()}`,
          observedAt: new Date().toISOString(),
          payload: {
            kind: "malware_detection",
            severity: "medium",
            hostname: "never-seen-host-xyz",
            summary: "unresolved",
          },
        },
      ],
      normalize: (raw) => genericSecurityEventsAdapter.normalize(raw, ctx),
    });
    assert.equal(r.acceptedCount, 1);
    assert.ok(r.unresolvedAssets >= 1);
    const sig = await getSignal(AL, r.signalIds[0]);
    assert.equal(sig?.assetId, null);
    assert.ok((sig?.unresolvedIdentifiers as any[])?.length || sig?.unresolvedIdentifiers);
  });

  it("preserves raw payload unchanged and links lineage", async () => {
    const payload = {
      kind: "malware_detection",
      severity: "high",
      hostname: "web-prod-01",
      marker: "LINEAGE_PROOF_42",
    };
    const hash = computePayloadHash(payload);
    const ctx = {
      orgId: AL,
      connectorId,
      connectorName: "t",
      riskDomainId: socDomainId,
      domainCode: "soc_mdr",
      config: {},
    };
    const r = await ingestAndNormalize({
      orgId: AL,
      connectorId,
      events: [
        {
          externalEventId: `lineage-${Date.now()}`,
          observedAt: new Date().toISOString(),
          payload,
        },
      ],
      normalize: (raw) => genericSecurityEventsAdapter.normalize(raw, ctx),
    });
    const sig = await getSignal(AL, r.signalIds[0]);
    assert.ok(sig?.rawEvent);
    assert.equal(sig!.rawEvent!.payloadHash, hash);
    assert.equal((sig!.rawEvent!.payload as any).marker, "LINEAGE_PROOF_42");
    assert.equal(sig!.rawEventId, sig!.rawEvent!.rawEventId);
  });

  it("rejects cross-tenant connector usage via org scoping", async () => {
    const falConn = await createConnector(FAL, {
      name: `Falcon Generic ${Date.now()}`,
      riskDomainId: socDomainId,
      adapterKey: "generic_security_events",
    });
    const ctx = {
      orgId: AL,
      connectorId: falConn!.connectorId as string,
      connectorName: "x",
      riskDomainId: socDomainId,
      domainCode: "soc_mdr",
      config: {},
    };
    // Connector belongs to Falcon — Al Dhabi ingest should reject at validation
    const r = await ingestAndNormalize({
      orgId: AL,
      connectorId: falConn!.connectorId as string,
      events: [
        {
          externalEventId: `xorg-${Date.now()}`,
          observedAt: new Date().toISOString(),
          payload: { kind: "malware_detection", severity: "low", hostname: "x" },
        },
      ],
      normalize: (raw) => genericSecurityEventsAdapter.normalize(raw, ctx),
    });
    assert.ok(r.errorCount >= 1);
    assert.ok(r.errors.some((e) => e.reason.includes("cross-tenant")));
  });
});

describe("demo connector end-to-end", () => {
  it("runs Generic Security Events through full pipeline", async () => {
    const out = await runConnectorSync(AL, connectorId);
    assert.ok(out);
    assert.ok(out!.result.receivedCount >= 4);
    assert.ok(out!.result.acceptedCount + out!.result.duplicateCount >= 4);

    const ready = await listSignals(AL, { lifecycle: "ready_for_correlation", limit: 50 });
    assert.ok(ready.length >= 1);

    const { rows: runs } = await query(
      `SELECT events_received, events_accepted, events_deduplicated
       FROM connector_sync_runs WHERE sync_run_id = $1`,
      [out!.syncRunId],
    );
    assert.ok(runs[0].events_received >= 4);
  });

  it("records connector sync metrics", async () => {
    const { rows } = await query(
      `SELECT events_received, events_accepted, events_rejected, events_deduplicated
       FROM connector_sync_runs
       WHERE org_id = $1 AND connector_id = $2
       ORDER BY started_at DESC LIMIT 1`,
      [AL, connectorId],
    );
    assert.ok(rows[0]);
    assert.ok(Number(rows[0].events_received) >= 0);
  });
});
