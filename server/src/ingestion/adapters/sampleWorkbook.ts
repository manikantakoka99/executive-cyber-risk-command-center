/**
 * ECC Sample Workbook connector — synthetic fixture only.
 * adapter_key: ecc.sample_workbook
 * Does NOT claim live vendor integrations.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterContext,
  CanonicalSecuritySignalV1,
  CanonicalSeverity,
  ConnectorAdapter,
  RawEventInput,
  SourceIdentifier,
} from "../types.js";
import {
  domainCodeToSourceType,
  mapWorkbookDomain,
} from "../domainMapping.js";
import { classifySignalKind, eventTypeForKind } from "../signalKind.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../");

export const SAMPLE_WORKBOOK_ADAPTER_KEY = "ecc.sample_workbook";
export const SAMPLE_WORKBOOK_CONNECTOR_NAME = "ECC Sample Workbook Ingestion";

export type WorkbookSampleRow = {
  rowNumber: number;
  metricId: string;
  domain: string;
  toolCategory: string;
  product: string;
  typicalIntegration: string;
  format: string;
  ingestionPattern: string;
  sampleRawPayload: string;
  numerator: number | null;
  denominator: number | null;
};

export function resolveWorkbookFixturePath(config?: Record<string, unknown>): string {
  if (config?.fixturePath && typeof config.fixturePath === "string") {
    return path.resolve(REPO_ROOT, config.fixturePath);
  }
  return path.join(
    REPO_ROOT,
    "reference",
    "sample_workbook_products_and_samples.json",
  );
}

export function loadWorkbookRows(fixturePath: string): WorkbookSampleRow[] {
  if (!existsSync(fixturePath)) {
    throw new Error(`Sample workbook fixture not found: ${fixturePath}`);
  }
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    rows: WorkbookSampleRow[];
  };
  return raw.rows ?? [];
}

function extractObservedAt(payloadText: string, parsed: Record<string, unknown> | null): string | null {
  if (parsed) {
    for (const k of ["collected_at", "timestamp", "observed_at", "event_time", "time"]) {
      const v = parsed[k];
      if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
    }
    const sample = parsed.sample_record as Record<string, unknown> | undefined;
    if (sample) {
      for (const k of ["timestamp", "observed_at", "time"]) {
        const v = sample[k];
        if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
      }
    }
  }
  // XML date hints (do not invent)
  const begin = payloadText.match(/<begin>(\d+)<\/begin>/);
  if (begin) {
    const sec = Number(begin[1]);
    if (sec > 1e9 && sec < 2e10) return new Date(sec * 1000).toISOString();
  }
  return null;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractSeverity(
  kind: string,
  parsed: Record<string, unknown> | null,
  payloadText: string,
): { severity: CanonicalSeverity | null; vendorSeverity?: string } {
  const fromXml = payloadText.match(/<severity>\s*([^<]+)\s*<\/severity>/i);
  const raw =
    (parsed?.sample_record as Record<string, unknown> | undefined)?.severity ??
    parsed?.severity ??
    (fromXml ? fromXml[1] : null);
  if (raw == null) {
    return { severity: null };
  }
  const s = String(raw).toLowerCase().trim();
  const map: Record<string, CanonicalSeverity> = {
    info: "info",
    informational: "info",
    low: "low",
    medium: "medium",
    med: "medium",
    high: "high",
    critical: "critical",
    certain: "high",
  };
  // Only assign canonical severity for events when source actually provided it
  if (kind === "event" && map[s]) return { severity: map[s], vendorSeverity: String(raw) };
  return { severity: null, vendorSeverity: String(raw) };
}

function extractIdentifiers(
  parsed: Record<string, unknown> | null,
  payloadText: string,
): SourceIdentifier[] {
  const ids: SourceIdentifier[] = [];
  const sample = (parsed?.sample_record as Record<string, unknown> | undefined) ?? {};
  const host =
    sample.host ?? sample.device ?? sample.hostname ?? sample.app ?? sample.ai_asset;
  if (typeof host === "string" && host.trim()) {
    if (/^https?:\/\//i.test(host) || host.includes(".")) {
      ids.push({ idType: host.startsWith("http") ? "url" : "hostname", idValue: host });
    } else {
      ids.push({ idType: "hostname", idValue: host });
    }
  }
  const addr = payloadText.match(/addr="([^"]+)"/);
  if (addr) ids.push({ idType: "ip", idValue: addr[1]! });
  const user = sample.user ?? sample.username;
  // identity handled separately
  void user;
  return ids;
}

function rowToRawEvent(row: WorkbookSampleRow): RawEventInput {
  const format = String(row.format ?? "JSON").toUpperCase();
  const payloadText = String(row.sampleRawPayload ?? "");
  const parsed = format === "JSON" ? tryParseJson(payloadText) : null;
  const observedAt = extractObservedAt(payloadText, parsed);
  const payloadHash = createHash("sha256").update(payloadText).digest("hex");

  // Preserve original exactly: JSON structural when parseable; XML/other as original string
  const payload: Record<string, unknown> = {
    workbook: {
      metricId: row.metricId,
      domain: row.domain,
      toolCategory: row.toolCategory,
      product: row.product,
      format: row.format,
      ingestionPattern: row.ingestionPattern,
      numerator: row.numerator,
      denominator: row.denominator,
      rowNumber: row.rowNumber,
    },
    original: format === "JSON" && parsed ? parsed : payloadText,
    originalEncoding: format === "JSON" && parsed ? "json" : "raw_text",
  };

  const externalEventId = [
    "wb",
    row.metricId,
    row.product.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40),
    observedAt ?? "no-time",
    payloadHash.slice(0, 16),
  ].join(":");

  return {
    externalEventId,
    observedAt,
    contentType:
      format === "XML"
        ? "application/xml"
        : format === "JSON"
          ? "application/json"
          : "text/plain",
    payload,
    sourceMetadata: {
      metricId: row.metricId,
      domain: row.domain,
      toolCategory: row.toolCategory,
      product: row.product,
      typicalIntegration: row.typicalIntegration,
      format: row.format,
      ingestionPattern: row.ingestionPattern,
      numerator: row.numerator,
      denominator: row.denominator,
      rowNumber: row.rowNumber,
      fixture: "CyberCommandCenter_Tool_To_Risk_Domain_Solution.xlsx",
      synthetic: true,
    },
  };
}

export const sampleWorkbookAdapter: ConnectorAdapter = {
  adapterKey: SAMPLE_WORKBOOK_ADAPTER_KEY,

  validateConfiguration(config) {
    const errors: string[] = [];
    const p = resolveWorkbookFixturePath(config ?? {});
    if (!existsSync(p)) errors.push(`fixture missing: ${p}`);
    return { ok: errors.length === 0, errors };
  },

  async testConnection(ctx) {
    try {
      const rows = loadWorkbookRows(resolveWorkbookFixturePath(ctx.config));
      return {
        ok: true,
        message: `Sample workbook fixture readable (${rows.length} rows) — synthetic, not live vendor`,
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  },

  async fetch(ctx) {
    const rows = loadWorkbookRows(resolveWorkbookFixturePath(ctx.config));
    return rows.map(rowToRawEvent);
  },

  normalize(raw: RawEventInput, ctx: AdapterContext): CanonicalSecuritySignalV1 {
    const meta = (raw.sourceMetadata ?? {}) as Record<string, unknown>;
    const metricId = String(meta.metricId ?? "");
    const domainLabel = String(meta.domain ?? "");
    const toolCategory = String(meta.toolCategory ?? "");
    const product = String(meta.product ?? "unknown");
    const numerator =
      meta.numerator != null && meta.numerator !== ""
        ? Number(meta.numerator)
        : null;
    const denominator =
      meta.denominator != null && meta.denominator !== ""
        ? Number(meta.denominator)
        : null;

    const original = raw.payload.original;
    const payloadText =
      typeof original === "string" ? original : JSON.stringify(original ?? {});
    const parsed =
      raw.payload.originalEncoding === "json" &&
      original &&
      typeof original === "object"
        ? (original as Record<string, unknown>)
        : tryParseJson(payloadText);

    const kind = classifySignalKind({
      domain: domainLabel,
      toolCategory,
      metricId,
      payloadText,
      numerator: Number.isFinite(numerator as number) ? (numerator as number) : null,
      denominator: Number.isFinite(denominator as number)
        ? (denominator as number)
        : null,
    });

    const mapped = mapWorkbookDomain(domainLabel);
    const sourceType = mapped.unmapped
      ? "workbook_sample"
      : domainCodeToSourceType(mapped.domainCode);

    const observedAt = raw.observedAt ?? extractObservedAt(payloadText, parsed);
    const missingTimestamp = !observedAt;
    const sev = extractSeverity(kind, parsed, payloadText);

    let qualityFlag: string | null = null;
    if (missingTimestamp) qualityFlag = "missing_timestamp";
    if (kind !== "event" && !sev.severity) {
      qualityFlag = qualityFlag
        ? `${qualityFlag}|no_event_severity`
        : "no_event_severity";
    }
    if (mapped.unmapped) {
      qualityFlag = qualityFlag ? `${qualityFlag}|unmapped_domain` : "unmapped_domain";
    }

    const sample = (parsed?.sample_record as Record<string, unknown> | undefined) ?? {};
    const identity =
      sample.user || sample.username
        ? String(sample.user ?? sample.username)
        : null;

    const eventType = eventTypeForKind(kind, toolCategory, payloadText);

    return {
      orgId: ctx.orgId,
      connectorId: ctx.connectorId,
      sourceType,
      sourceName: product,
      domainCode: mapped.domainCode,
      signalKind: kind,
      eventType,
      severity: sev.severity,
      vendorSeverity: sev.vendorSeverity,
      title: `${metricId} · ${toolCategory} · ${product}`.slice(0, 240),
      observedAt,
      missingTimestamp,
      unmappedDomain: mapped.unmapped,
      metricId,
      numerator: Number.isFinite(numerator as number) ? (numerator as number) : null,
      denominator: Number.isFinite(denominator as number)
        ? (denominator as number)
        : null,
      qualityFlag,
      toolCategory,
      identifiers: extractIdentifiers(parsed, payloadText),
      securityIdentityRef: identity,
      evidenceRefs: [
        {
          kind: "field_ref",
          value: `workbook:${metricId}:${product}`,
          label: "sample workbook row",
        },
      ],
      vendorMetadata: {
        vendor: "ecc-sample-workbook",
        product,
        integrationVersion: "phase6-proof",
        sourceEventType: eventType,
        sourceSeverity: sev.vendorSeverity,
        sourceRecordId: raw.externalEventId,
        sourceTags: [String(meta.ingestionPattern ?? ""), String(meta.format ?? "")],
        synthetic: true,
        workbookSheet: "Products and Samples",
        metricId,
        toolCategory,
        domainLabel,
        ingestionPattern: meta.ingestionPattern,
        format: meta.format,
        note: "Synthetic fixture — not a live vendor connector",
      },
    };
  },

  async healthCheck(ctx) {
    return this.testConnection(ctx);
  },
};
