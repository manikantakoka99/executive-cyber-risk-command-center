import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { CANONICAL } from "./command/canonical.js";
import { canonicalLossAbsolute } from "./command/demoOverlay.js";
import { ENTERPRISE_LOSS } from "./command/model.js";
import { query } from "./db.js";
import { getOverview } from "./services/overview.js";

const AL_DHABI = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FALCON = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";

describe("overview aggregates", () => {
  before(async () => {
    // Decision workflow tests may approve Falcon rows; restore one awaiting decision.
    await query(
      `UPDATE executive_decisions SET status='awaiting_decision', decided_by=NULL, decided_at=NULL
       WHERE org_id=$1 AND status <> 'awaiting_decision'
         AND decision_id = (
           SELECT decision_id FROM executive_decisions
           WHERE org_id=$1 ORDER BY escalated_at DESC NULLS LAST LIMIT 1
         )`,
      [FALCON],
    );
  });

  it("returns Al Dhabi KPIs aligned to canonical Headline", async () => {
    const o = await getOverview(AL_DHABI);
    const loss = canonicalLossAbsolute();
    assert.ok(o);
    assert.equal(o.org.name, "Al Dhabi Holdings");
    assert.equal(o.domainsMonitored, CANONICAL.domainCount);
    assert.ok(o.enterpriseRisk);
    assert.equal(o.enterpriseRisk.score, Number(CANONICAL.headlineScore));
    assert.equal(o.enterpriseRisk.severity, CANONICAL.headlineBand.toLowerCase());
    assert.equal(o.businessImpactExposureAed, loss.aleAed);
    assert.equal(o.businessImpactExposureAed, Math.round(ENTERPRISE_LOSS.ale * 1_000_000));
    assert.deepEqual(o.annualLossAedM, ENTERPRISE_LOSS);
    assert.equal(o.decisionsAwaitingCxo, CANONICAL.openDecisions);
  });

  it("Falcon awaiting queue matches KPI", async () => {
    const o = await getOverview(FALCON);
    assert.ok(o);
    assert.equal(o.org.name, "Falcon National Bank");
    assert.equal(o.decisionsAwaitingCxo, o.pendingDecisions.length);
    assert.ok(o.decisionsAwaitingCxo >= 1);
    assert.ok(o.pendingDecisions.every((d) => d.status === "awaiting_decision"));
  });
});
