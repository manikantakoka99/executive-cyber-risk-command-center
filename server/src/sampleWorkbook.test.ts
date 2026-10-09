import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { query } from "./db.js";
import { mapWorkbookDomain } from "./ingestion/domainMapping.js";
import { classifySignalKind } from "./ingestion/signalKind.js";
import {
  loadWorkbookRows,
  resolveWorkbookFixturePath,
  sampleWorkbookAdapter,
} from "./ingestion/adapters/sampleWorkbook.js";
import {
  getIngestionTrace,
  resetSampleWorkbookIngestion,
  runSampleWorkbookIngestion,
} from "./services/sampleWorkbookIngestion.js";
import { computePayloadHash } from "./ingestion/fingerprint.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FAL = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";

describe("Phase 6 sample workbook ingestion", () => {
  before(async () => {
    await resetSampleWorkbookIngestion(AL);
  });

  it("fixture contains all Products and Samples rows", () => {
    const rows = loadWorkbookRows(resolveWorkbookFixturePath({}));
    assert.equal(rows.length, 127);
    assert.ok(rows.some((r) => String(r.format).toUpperCase() === "XML"));
    assert.ok(rows.some((r) => String(r.format).toUpperCase() === "JSON"));
  });

  it("domain mapping uses ECC taxonomy and unmapped fallback", () => {
    assert.equal(mapWorkbookDomain("SOC / MDR").domainCode, "soc_mdr");
    assert.equal(mapWorkbookDomain("AI Security & GenAI Governance").domainCode, "ai_governance");
    assert.equal(mapWorkbookDomain("Totally Fake Domain").domainCode, "unmapped");
    assert.equal(mapWorkbookDomain("Totally Fake Domain").unmapped, true);
  });

  it("classifies posture vs event deterministically", () => {
    assert.equal(
      classifySignalKind({
        domain: "Ransomware Readiness",
        toolCategory: "Backup / Recovery",
        metricId: "M04-1",
        payloadText: '{"collected_at":"2026-09-05T02:00:00Z"}',
        numerator: 10,
        denominator: 20,
      }),
      "posture_metric",
    );
    assert.equal(
      classifySignalKind({
        domain: "SOC / MDR",
        toolCategory: "EDR / XDR",
        metricId: "M06-1",
        payloadText:
          '{"sample_record":{"action":"blocked","verdict":"malware"},"collected_at":"2026-09-05T02:00:00Z"}',
        numerator: 1,
        denominator: 1,
      }),
      "event",
    );
    assert.equal(
      classifySignalKind({
        domain: "Continuous Compliance",
        toolCategory: "GRC / Compliance Platform",
        metricId: "M12-1",
        payloadText: "{}",
        numerator: 1,
        denominator: 2,
      }),
      "compliance_observation",
    );
  });

  it("preserves JSON structure and XML text in normalize payload path", async () => {
    const rows = loadWorkbookRows(resolveWorkbookFixturePath({}));
    const jsonRow = rows.find((r) => String(r.format).toUpperCase() === "JSON")!;
    const xmlRow = rows.find((r) => String(r.format).toUpperCase() === "XML")!;
    const events = await sampleWorkbookAdapter.fetch({
      orgId: AL,
      connectorId: "00000000-0000-4000-8000-000000000001",
      connectorName: "t",
      riskDomainId: "x",
      domainCode: "unmapped",
      config: {},
    });
    const j = events.find((e) => e.sourceMetadata?.metricId === jsonRow.metricId);
    const x = events.find((e) => e.contentType === "application/xml");
    assert.ok(j);
    assert.equal(j!.payload.originalEncoding, "json");
    assert.equal(typeof j!.payload.original, "object");
    assert.ok(x);
    assert.equal(x!.payload.originalEncoding, "raw_text");
    assert.equal(typeof x!.payload.original, "string");
    assert.match(String(x!.payload.original), /<|>/);
    // payload hash stable
    assert.equal(computePayloadHash(j!.payload).length, 64);
    void xmlRow;
  });

  it("ingests workbook, is idempotent on rerun, and exposes lineage", async () => {
    const first = await runSampleWorkbookIngestion(AL, { correlate: true });
    assert.equal(first.result.receivedCount, 127);
    assert.ok(first.result.acceptedCount > 0);
    assert.ok(first.result.postureMetrics > 0);
    assert.equal(first.result.rawEventIds.length, first.result.acceptedCount + 0);

    const second = await runSampleWorkbookIngestion(AL, { correlate: false });
    assert.equal(second.result.receivedCount, 127);
    assert.ok(second.result.duplicateCount > 0);
    assert.equal(second.result.acceptedCount, 0);

    const { rows: signals } = await query<{ signal_id: string; raw_event_id: string }>(
      `SELECT signal_id, raw_event_id FROM security_signals
       WHERE org_id=$1 AND connector_id=$2 AND is_duplicate=false LIMIT 1`,
      [AL, first.connectorId],
    );
    assert.ok(signals[0]);
    const trace = await getIngestionTrace(AL, signals[0]!.signal_id);
    assert.ok(trace);
    assert.equal(trace!.steps[0]!.step, "SOURCE_ROW");
    assert.equal(trace!.steps[1]!.step, "RAW_EVENT");
    assert.ok((trace!.steps[1]!.data as any).payload);
    assert.equal(trace!.steps[2]!.step, "CANONICAL");
  });

  it("tenant isolation: Falcon cannot see Al Dhabi workbook signals", async () => {
    await resetSampleWorkbookIngestion(FAL);
    await runSampleWorkbookIngestion(FAL, { correlate: false });
    const { rows: al } = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM security_signals s
       JOIN connectors c ON c.connector_id = s.connector_id
       WHERE s.org_id=$1 AND c.adapter_key='ecc.sample_workbook'`,
      [AL],
    );
    const { rows: fal } = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM security_signals s
       JOIN connectors c ON c.connector_id = s.connector_id
       WHERE s.org_id=$1 AND c.adapter_key='ecc.sample_workbook'`,
      [FAL],
    );
    assert.ok(Number(al[0]!.n) > 0);
    assert.ok(Number(fal[0]!.n) > 0);
    const leaked = await getIngestionTrace(FAL, (
      await query<{ signal_id: string }>(
        `SELECT signal_id FROM security_signals WHERE org_id=$1 LIMIT 1`,
        [AL],
      )
    ).rows[0]!.signal_id);
    assert.equal(leaked, null);
  });
});
