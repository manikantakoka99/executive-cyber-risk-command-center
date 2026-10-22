import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASELINE,
  adjustedScore,
  applyFloor,
  bandOf,
  compute,
  feedTotals,
  format1,
  ransomRaw,
  weightedCoverage,
  WHATIF_PRESETS,
  type DomainDef,
} from "./model.js";

describe("reference scoring model", () => {
  it("adjusts unobserved assets up to the policy default", () => {
    assert.equal(adjustedScore(76, 0.7), 76);
    assert.equal(adjustedScore(47, 0.5), 53.5);
    assert.equal(bandOf(53.5), "Medium");
    assert.equal(bandOf(76), "Critical");
  });

  it("floors the headline to the worst High or Critical domain", () => {
    assert.equal(BASELINE.counts.Critical, 2);
    assert.equal(bandOf(BASELINE.arithmetic), "Medium");
    assert.equal(BASELINE.floored, true);
    assert.equal(BASELINE.headline, "Critical");
    assert.equal(BASELINE.floorDomain?.domain.name, "Attack Surface and VAPT");
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

function domain(id: string, name: string, raw: number): DomainDef {
  return {
    id,
    name,
    csf: "",
    raw,
    coverage: 1,
    weight: 1,
    appetite: 90,
    fresh: 1,
    total: 1,
    trend: [],
  };
}

describe("floor rule", () => {
  it("holds an otherwise Low average at High when one domain is High", () => {
    const card = compute([domain("low", "Low", 10), domain("id", "Identity", 55)]);
    assert.equal(bandOf(card.arithmetic), "Low");
    assert.equal(card.headline, "High");
    assert.equal(card.floored, true);
    assert.equal(card.floorDomain?.domain.name, "Identity");
  });

  it("holds the org at Critical when one domain is Critical", () => {
    const card = compute([domain("low", "Low", 10), domain("pay", "Payments", 80)]);
    assert.equal(card.headline, "Critical");
    assert.equal(card.floored, true);
    assert.equal(card.floorDomain?.domain.name, "Payments");
  });

  it("does not floor or name a domain when every domain is Low", () => {
    const card = compute([domain("a", "Alpha", 10), domain("b", "Bravo", 12)]);
    assert.equal(card.headline, "Low");
    assert.equal(card.floored, false);
    assert.equal(card.floorDomain, null);
  });

  it("names the higher score, then the earlier row, when two domains tie", () => {
    const worse = compute([
      domain("a", "Alpha", 60),
      domain("b", "Bravo", 68),
      domain("c", "Charlie", 10),
    ]);
    assert.equal(worse.headline, "High");
    assert.equal(worse.floorDomain?.domain.name, "Bravo");

    const tied = compute([
      domain("a", "Alpha", 60),
      domain("b", "Bravo", 60),
      domain("c", "Charlie", 10),
    ]);
    assert.equal(tied.headline, "High");
    assert.equal(tied.floorDomain?.domain.id, "a");
    const same = applyFloor(tied.rows, "Low");
    assert.equal(same.floorDomain?.domain.id, "a");
  });
});
