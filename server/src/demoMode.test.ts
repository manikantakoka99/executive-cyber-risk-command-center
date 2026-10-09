import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HERO_SCENARIO_TITLE,
  prepareManagerDemo,
  demoUuid,
} from "./services/demoMode.js";
import { getScenario, seedDemoScenarios } from "./services/scenarios.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FAL = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";

describe("Manager demo mode", () => {
  it("prepare yields deterministic hero with full graph", async () => {
    const prepared = await prepareManagerDemo(AL);
    assert.equal(prepared.heroScenarioId, demoUuid(AL, "scenario:hero-payment"));
    assert.equal(prepared.heroTitle, HERO_SCENARIO_TITLE);
    assert.ok(prepared.verified.ok, JSON.stringify(prepared.verified.checks, null, 2));

    const hero = await getScenario(AL, prepared.heroScenarioId!);
    assert.ok(hero);
    assert.equal(hero!.isDemo, true);
    assert.ok((hero!.signals?.length ?? 0) >= 3);
    assert.ok((hero!.domains?.length ?? 0) >= 3);
    assert.ok((hero!.findings?.length ?? 0) >= 1);
    assert.ok((hero!.controls?.length ?? 0) >= 1);
    assert.ok(hero!.businessImpact);
    assert.ok(hero!.recommendation);
    assert.ok(hero!.currentAssessment?.residual_risk != null);
    assert.ok(hero!.businessUnitId && hero!.businessProcessId);

    // Re-seed is idempotent for hero id
    const again = await seedDemoScenarios(AL);
    assert.equal(again.heroScenarioId, prepared.heroScenarioId);
  });

  it("tenant isolation: Falcon hero id differs and Al Dhabi cannot see it", async () => {
    const fal = await seedDemoScenarios(FAL);
    assert.ok(fal.heroScenarioId);
    assert.equal(fal.heroScenarioId, demoUuid(FAL, "scenario:hero-payment"));
    assert.notEqual(fal.heroScenarioId, demoUuid(AL, "scenario:hero-payment"));
    const leaked = await getScenario(AL, fal.heroScenarioId!);
    assert.equal(leaked, null);
  });
});
