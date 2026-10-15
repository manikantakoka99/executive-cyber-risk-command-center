import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { app } from "./index.js";
import { formatAed } from "./lib/money.js";

const ORG = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const CISO = "c1500001-a090-41a0-8ecc-000000000001";
/** Has decisions.read but not command.loss — money must be stripped. */
const PROGRAM_OFFICE = "c1500001-a090-41a0-8ecc-00000000000b";

/** Comma-grouped dirham amounts that must never appear once formatted. */
const RAW_COMMA_AED = /AED\s*\d{1,3}(,\d{3})+/;

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectStrings(child, out);
    }
  }
  return out;
}

describe("formatted AED on decisions + decision-center APIs", () => {
  before(async () => {
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("GET /api/ecc/decisions impactSummary uses AED x.xM / xxxK only", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ecc/decisions",
      headers: { "x-org-id": ORG, "x-user-id": CISO },
    });
    assert.equal(res.statusCode, 200, res.body.slice(0, 240));
    const body = res.json() as { decisions?: Array<{ impactSummary?: string }> };
    const decisions = body.decisions ?? (Array.isArray(body) ? body : []);
    assert.ok(Array.isArray(decisions));
    const withAed = decisions.filter((d) => /AED/i.test(String(d.impactSummary ?? "")));
    assert.ok(withAed.length >= 1, "expected seeded decisions with AED impact text");
    for (const d of withAed) {
      const text = String(d.impactSummary);
      assert.equal(RAW_COMMA_AED.test(text), false, text);
      assert.match(text, /AED\s+\d+(\.\d)?[KkMm]\b|AED\s+\d+\b/);
    }
    // Spot-check known seed exposures.
    const joined = withAed.map((d) => d.impactSummary).join(" | ");
    assert.ok(joined.includes("AED 611K") || joined.includes(formatAed(610_959)), joined);
    assert.ok(joined.includes("AED 1.5M") || joined.includes("AED 2.9M"), joined);
  });

  it("GET /api/ecc/decision-center businessImpact uses AED x.xM / xxxK only", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ecc/decision-center",
      headers: { "x-org-id": ORG, "x-user-id": CISO },
    });
    assert.equal(res.statusCode, 200, res.body.slice(0, 240));
    const body = res.json() as Record<string, unknown>;
    const texts = collectStrings(body).filter((t) => /\bAED\b/i.test(t));
    assert.ok(texts.length >= 1, "expected AED strings in decision-center payload");
    for (const text of texts) {
      assert.equal(RAW_COMMA_AED.test(text), false, text);
    }
  });

  it("still strips AED entirely for roles without financial access", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ecc/decisions",
      headers: { "x-org-id": ORG, "x-user-id": PROGRAM_OFFICE },
    });
    assert.equal(res.statusCode, 200, res.body.slice(0, 240));
    const texts = collectStrings(res.json()).filter((t) => /\bAED\b/i.test(t));
    assert.equal(texts.length, 0, texts.join(" | "));
  });
});
