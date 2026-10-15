import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL } from "./command/canonical.js";
import { query } from "./db.js";
import { getActivity, listFindings } from "./services/catalog.js";
import {
  getControlPosture,
  getExecutiveBriefing,
  getHotspots,
  getPortfolio,
  getTrends,
  listMaterialChanges,
} from "./services/intelligence.js";
import { getOverview } from "./services/overview.js";
import { createIsolatedScenario } from "./services/closedLoop.js";
import { isSeededTestText } from "./command/testFixtures.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";

describe("seeded test text helper", () => {
  it("matches fixture tokens and (DEMO) titles, and keeps executive scenario titles", () => {
    assert.equal(isSeededTestText("Scenario decision approved: P4 isolated 1792056833739-9ea8b1"), true);
    assert.equal(isSeededTestText("p3-corr-1792056901353 suspicious_process"), true);
    assert.equal(isSeededTestText("P4 isolated 1792056833739-9ea8b1-ctrl"), true);
    assert.equal(
      isSeededTestText("Internet-exposed payment gateway with weak recovery posture (DEMO)"),
      true,
    );
    assert.equal(isSeededTestText("Critical vulnerability on internet-facing business API"), false);
    assert.equal(isSeededTestText("Generated immutable executive report"), false);
  });
});

describe("seeded fixtures stay out of executive feeds", () => {
  it("drops test rows from activity, intelligence, and findings", async () => {
    const marker = `p3-corr-${Date.now()}`;
    await createIsolatedScenario(AL, { title: `P4 isolated ${Date.now()}-9ea8b1` });
    const { rows: domains } = await query<{ risk_domain_id: string }>(
      `SELECT risk_domain_id FROM risk_domains LIMIT 1`,
    );
    await query(
      `INSERT INTO command_center_activity (org_id, activity_type, summary)
       VALUES
         ($1, 'decision_resolved', $2),
         ($1, 'report_generated', 'Generated immutable executive report for the board')`,
      [AL, `Scenario decision approved: P4 isolated ${Date.now()}-9ea8b1`],
    );
    await query(
      `INSERT INTO risk_findings (
         org_id, risk_domain_id, title, severity, status, fingerprint, raw_payload
       ) VALUES (
         $1, $2, $3, 'high', 'open', $4, '{"demo":true}'::jsonb
       )`,
      [
        AL,
        domains[0]!.risk_domain_id,
        "Internet-exposed payment gateway with weak recovery posture (DEMO)",
        `ecc-demo-${marker}-finding`,
      ],
    );
    await query(
      `INSERT INTO security_signals (
         org_id, risk_domain_id, event_type, severity, observed_at, title,
         source_type, source_name, lifecycle_status
       ) VALUES (
         $1, $2, 'suspicious_process', 'critical', now(), $3,
         'soc', 'phase3_test', 'ready_for_correlation'
       )`,
      [AL, domains[0]!.risk_domain_id, `${marker} suspicious_process`],
    );

    const activity = await getActivity(AL);
    assert.ok(activity.some((row) => /immutable executive report/i.test(row.summary)));
    assert.ok(!activity.some((row) => isSeededTestText(row.summary)));

    const overview = await getOverview(AL);
    assert.ok(overview);
    assert.ok(!overview.activity.some((row) => isSeededTestText(row.summary)));

    const findings = await listFindings(AL);
    assert.ok(!findings.some((row) => isSeededTestText(String(row.title))));
    assert.ok(!findings.some((row) => /\(DEMO\)\s*$/i.test(String(row.title))));

    const portfolio = await getPortfolio(AL);
    assert.ok(!portfolio.topRisks.some((row: { title?: string }) => isSeededTestText(row.title)));

    const controls = await getControlPosture(AL);
    const controlBlob = JSON.stringify(controls.supportingCriticalScenarios);
    assert.equal(/P4 isolated|p3-corr-|-ctrl/.test(controlBlob), false);

    const changes = await listMaterialChanges(AL);
    assert.ok(!changes.some((row) => isSeededTestText(String(row.summary))));

    const hotspots = await getHotspots(AL);
    assert.ok(!hotspots.statements.some((line) => isSeededTestText(line)));
  });
});

describe("intelligence and operations counts share one source", () => {
  it("briefing outside-tolerance matches the top-risk list and the hotspot denominator", async () => {
    const portfolio = await getPortfolio(AL);
    const briefing = await getExecutiveBriefing(AL);
    const hotspots = await getHotspots(AL);
    const outsideInList = portfolio.topRisks.filter(
      (row: { toleranceState?: string }) => row.toleranceState === "outside",
    ).length;
    const highCritical = portfolio.topRisks.filter(
      (row: { residualRisk?: number | null }) => (row.residualRisk ?? -1) >= 55,
    ).length;

    assert.equal(portfolio.scenarioSet.outsideTolerance, outsideInList);
    assert.equal(portfolio.scenarioSet.highCritical, highCritical);
    assert.match(
      briefing.sections.whatMatters.text,
      new RegExp(`^${outsideInList} outside-tolerance scenario`),
    );
    assert.equal(hotspots.denominatorHighCritical, highCritical);
    const denomInCopy = briefing.sections.whatMatters.text.match(/denominator: (\d+)/);
    if (denomInCopy) assert.equal(Number(denomInCopy[1]), highCritical);
    const trends = await getTrends(AL, "30d");
    assert.equal(trends.scenarioVelocity.outsideToleranceNow, outsideInList);

    // Headline figures stay on the canonical domain model.
    assert.equal(portfolio.totals.enterpriseScore, Number(CANONICAL.headlineScore));
    assert.equal(portfolio.totals.outsideTolerance, CANONICAL.outsideAppetite);
    assert.equal(portfolio.totals.openDecisions, CANONICAL.openDecisions);
    assert.equal(portfolio.totals.domainCount, CANONICAL.domainCount);
  });

  it("operations decisions panel lists the same 4 open decisions as the queue", async () => {
    const overview = await getOverview(AL);
    assert.ok(overview);
    assert.equal(overview.decisionsAwaitingCxo, CANONICAL.openDecisions);
    assert.equal(overview.pendingDecisions.length, CANONICAL.openDecisions);
    assert.equal(overview.executiveActionQueue.length, CANONICAL.openDecisions);
    assert.equal(overview.enterpriseRisk?.score, Number(CANONICAL.headlineScore));
    assert.ok(
      overview.pendingDecisions.every(
        (row: { status?: string }) => row.status === "awaiting_decision",
      ),
    );
  });
});
