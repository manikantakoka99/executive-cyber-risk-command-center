import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getOverview } from "./services/overview.js";

const AL_DHABI = "2accc7de-f693-4b19-8fe8-6db501be05e2";

describe("overview aggregates", () => {
  it("returns Al Dhabi KPIs from database", async () => {
    const o = await getOverview(AL_DHABI);
    assert.ok(o);
    assert.equal(o.org.name, "Al Dhabi Holdings");
    assert.equal(o.domainsMonitored, 12);
    assert.ok(o.enterpriseRisk);
    assert.equal(o.enterpriseRisk.score, 42.83);
    assert.ok(o.businessImpactExposureAed > 5_000_000);
    assert.equal(o.compliancePosturePct, 80);
    assert.equal(o.decisionsAwaitingCxo, 0);
    assert.equal(o.pendingDecisions.length, 0);
    assert.equal(o.riskTrend.length, 6);
  });

  it("Falcon awaiting queue matches KPI", async () => {
    const FALCON = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";
    const o = await getOverview(FALCON);
    assert.ok(o);
    assert.equal(o.org.name, "Falcon National Bank");
    assert.equal(o.decisionsAwaitingCxo, o.pendingDecisions.length);
    assert.ok(o.decisionsAwaitingCxo >= 1);
    assert.ok(o.pendingDecisions.every((d) => d.status === "awaiting_decision"));
  });
});
