import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAed,
  formatImpactSummary,
  reformatAedInText,
} from "./money.js";

describe("formatAed", () => {
  it("uses one-decimal millions and whole thousands", () => {
    assert.equal(formatAed(1_539_905), "AED 1.5M");
    assert.equal(formatAed(2_947_126), "AED 2.9M");
    assert.equal(formatAed(610_959), "AED 611K");
    assert.equal(formatAed(179_096), "AED 179K");
    assert.equal(formatAed(999), "AED 999");
  });

  it("rounds multi-decimal millions (what-if lossAvoided) to one decimal", () => {
    assert.equal(formatAed(1.234567 * 1_000_000), "AED 1.2M");
    assert.equal(formatAed(2.98765 * 1_000_000), "AED 3.0M");
  });
});

describe("reformatAedInText / formatImpactSummary", () => {
  it("rewrites comma-grouped AED literals in stored chip text", () => {
    assert.equal(
      reformatAedInText("AED 610,959 exposure, downtime ~AED 179,096/hr"),
      "AED 611K exposure, downtime ~AED 179K/hr",
    );
    assert.equal(reformatAedInText("AED 1,539,905 exposure"), "AED 1.5M exposure");
    assert.equal(reformatAedInText("AED 2,947,126 exposure"), "AED 2.9M exposure");
  });

  it("regenerates from numeric columns when present", () => {
    assert.equal(
      formatImpactSummary({
        text: "AED 610,959 exposure, downtime ~AED 179,096/hr",
        financialExposureAed: 610_958.62,
        downtimeCostPerHourAed: 179_095.73,
      }),
      "AED 611K exposure, downtime ~AED 179K/hr",
    );
    assert.equal(
      formatImpactSummary({
        text: "stale",
        financialExposureAed: 1_539_904.63,
      }),
      "AED 1.5M exposure",
    );
  });
});
