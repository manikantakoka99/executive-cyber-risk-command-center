import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { formatAedMillions } from "../lib/money.js";
import { DOMAINS, LOSS, compute, ransomRaw, scoredById } from "./model.js";
import { presentWorkspace } from "./present.js";
import { getState, resetState, updateWhatIf } from "./store.js";

const ORG = "org-whatif-loss-direction";

function lossDelta(gaps: { edr: number; siem: number; imm: number; dr: number }) {
  const before = scoredById("ran")!;
  const after = scoredById("ran", compute(DOMAINS, { ran: ransomRaw(gaps) }))!;
  const red = LOSS.ran!.ale - LOSS.ran!.ale * (after.adjusted / before.adjusted);
  return { red, text: formatAedMillions(Math.abs(red)) };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("what-if expected loss direction", () => {
  beforeEach(() => resetState(ORG));

  it("says falls by the absolute AED amount when expected loss decreases", () => {
    const gaps = { edr: 10, siem: 10, imm: 10, dr: 10 };
    assert.equal(updateWhatIf(ORG, "cxo", gaps).ok, true);
    const title = presentWorkspace("cxo", getState(ORG)).whatif?.title ?? "";
    const { red, text } = lossDelta(gaps);
    assert.ok(red > 0, `expected a reduction, got ${red}`);
    assert.match(title, new RegExp(`expected loss falls by ${escapeRegExp(text)} a year`));
    assert.equal(title.includes("rises by"), false);
  });

  it("says rises by the absolute AED amount when expected loss increases", () => {
    const gaps = { edr: 100, siem: 100, imm: 100, dr: 100 };
    assert.equal(updateWhatIf(ORG, "cxo", gaps).ok, true);
    const title = presentWorkspace("cxo", getState(ORG)).whatif?.title ?? "";
    const { red, text } = lossDelta(gaps);
    assert.ok(red < 0, `expected an increase, got ${red}`);
    assert.match(title, new RegExp(`expected loss rises by ${escapeRegExp(text)} a year`));
    assert.equal(title.includes("falls by"), false);
    assert.equal(title.includes(`- ${text}`) || title.includes(`-${text}`), false);
  });
});
