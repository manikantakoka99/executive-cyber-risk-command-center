import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASELINE,
  adjustedScore,
  bandOf,
  feedTotals,
  format1,
  ransomRaw,
  weightedCoverage,
  WHATIF_PRESETS,
} from "./model.js";

describe("reference scoring model", () => {
  it("adjusts unobserved assets up to the policy default", () => {
    assert.equal(adjustedScore(76, 0.7), 76);
    assert.equal(adjustedScore(47, 0.5), 53.5);
    assert.equal(bandOf(53.5), "Medium");
    assert.equal(bandOf(76), "Critical");
  });

  it("floors the headline at High when any domain is Critical", () => {
    assert.equal(BASELINE.counts.Critical, 2);
    assert.equal(bandOf(BASELINE.arithmetic), "Medium");
    assert.equal(BASELINE.floored, true);
    assert.equal(BASELINE.headline, "High");
    assert.equal(format1(BASELINE.plain), "42.8");
    assert.equal(format1(BASELINE.arithmetic), "50.8");
  });

  it("counts fresh feeds and weighted coverage", () => {
    const feeds = feedTotals();
    assert.equal(feeds.fresh, 35);
    assert.equal(feeds.total, 39);
    assert.equal(Math.round(BASELINE.confidence * 100), 72);
    assert.equal(Math.round(weightedCoverage() * 100), 78);
  });

  it("recomputes ransomware raw score from control gaps", () => {
    assert.equal(ransomRaw(WHATIF_PRESETS.now!), 54);
    assert.equal(ransomRaw(WHATIF_PRESETS.A!), 44);
    assert.equal(ransomRaw(WHATIF_PRESETS.C!), 32);
  });
});
