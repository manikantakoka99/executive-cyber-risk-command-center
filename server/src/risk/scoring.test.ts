import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExplanation,
  confidenceScore,
  inherentRisk,
  priorityFromResidual,
  residualRisk,
  toleranceState,
  velocityFrom,
  weightedAverage,
} from "./scoring.js";
import type { RiskPolicyConfig } from "./policy.js";

const cfg: RiskPolicyConfig = {
  temporal_window_hours: 72,
  min_signals_for_scenario: 2,
  min_severity_for_single_signal: "critical",
  likelihood_weights: {
    threat_activity: 0.3,
    exposure_reachability: 0.25,
    exploitability: 0.2,
    control_weakness: 0.15,
    attack_evidence: 0.1,
  },
  impact_weights: {
    financial: 0.3,
    operational: 0.2,
    business_criticality: 0.25,
    regulatory_compliance: 0.15,
    data_impact: 0.1,
  },
  control_reduction: {
    effective: 0.45,
    partially_effective: 0.2,
    ineffective: 0,
    unknown: 0.05,
  },
  tolerance: { default_max_residual: 50, near_band: 10 },
  priority_bands: { critical: 80, high: 60, medium: 35 },
};

describe("risk scoring v1 (deterministic)", () => {
  it("computes inherent risk as sqrt(L*I)", () => {
    assert.equal(inherentRisk(64, 36), 48);
    assert.equal(inherentRisk(100, 100), 100);
    assert.equal(inherentRisk(0, 80), 0);
  });

  it("weighted average uses configured weights only", () => {
    const { score, used } = weightedAverage(
      [
        { code: "threat_activity", label: "t", raw: 80, note: "" },
        { code: "exposure_reachability", label: "e", raw: 40, note: "" },
        { code: "ignored", label: "x", raw: 99, note: "" },
      ],
      { threat_activity: 0.5, exposure_reachability: 0.5 },
    );
    assert.equal(score, 60);
    assert.equal(used.length, 2);
  });

  it("control effectiveness changes residual risk", () => {
    const inherent = 80;
    const ineffective = residualRisk(inherent, "ineffective", cfg);
    const effective = residualRisk(inherent, "effective", cfg);
    assert.equal(ineffective.residual, 80);
    assert.ok(effective.residual < ineffective.residual);
    assert.equal(effective.residual, 44);
  });

  it("missing financial does not invent values in explanation", () => {
    const text = buildExplanation({
      title: "Test scenario",
      residual: 70,
      inherent: 80,
      likelihood: 75,
      impact: 60,
      effectiveness: "ineffective",
      tolerance: "outside",
      confidenceLabel: "medium",
      confidenceNotes: ["financial exposure unknown"],
      domains: ["SOC", "ASM"],
      assetName: "web-01",
      processName: "Payments",
      financialKnown: false,
    });
    assert.match(text, /Financial exposure is unknown/);
    assert.doesNotMatch(text, /AED\s*\d/);
    assert.doesNotMatch(text, /\$\d/);
  });

  it("confidence increases with evidence quality", () => {
    const low = confidenceScore({
      signalCount: 1,
      domainCount: 1,
      assetResolved: false,
      hasBusinessContext: false,
      hasFinancial: false,
      controlKnown: false,
      freshnessHours: 200,
    });
    const high = confidenceScore({
      signalCount: 4,
      domainCount: 3,
      assetResolved: true,
      hasBusinessContext: true,
      hasFinancial: true,
      controlKnown: true,
      freshnessHours: 2,
    });
    assert.ok(high.score > low.score);
    assert.equal(high.label, "high");
  });

  it("tolerance breach is deterministic", () => {
    const outside = toleranceState(61, 50, 10);
    const near = toleranceState(45, 50, 10);
    const within = toleranceState(30, 50, 10);
    assert.equal(outside.state, "outside");
    assert.match(outside.reason, /exceeds policy threshold/);
    assert.equal(near.state, "near");
    assert.equal(within.state, "within");
  });

  it("priority bands map residual with boosts", () => {
    const base = priorityFromResidual(55, cfg.priority_bands, {});
    assert.equal(base.tier, "medium");
    const boosted = priorityFromResidual(55, cfg.priority_bands, {
      criticalAsset: true,
      outsideTolerance: true,
      increasing: true,
    });
    assert.ok(boosted.score > base.score);
    assert.equal(boosted.tier, "high");
  });

  it("velocity distinguishes new / increasing / aging", () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 2 * 3600000);
    assert.equal(velocityFrom(recent, now, null, 40), "new");
    assert.equal(
      velocityFrom(new Date(now.getTime() - 48 * 3600000), now, 40, 55),
      "increasing",
    );
    assert.equal(
      velocityFrom(
        new Date(now.getTime() - 30 * 24 * 3600000),
        new Date(now.getTime() - 10 * 24 * 3600000),
        50,
        50,
      ),
      "aging",
    );
  });
});
