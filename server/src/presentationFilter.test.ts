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
import { isSeededTestScenarioTitle, isSeededTestText } from "./command/testFixtures.js";
import { listScenarios, seedDemoScenarios } from "./services/scenarios.js";

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
    // Scenario titles are start-anchored. A real seed that merely contains a token stays.
    assert.equal(isSeededTestScenarioTitle("Payment path P4-al-noted exposure"), false);
    assert.equal(isSeededTestScenarioTitle("P4-al-1792082404151"), true);
    assert.equal(isSeededTestScenarioTitle("Branch recovery posture (DEMO)"), false);
    assert.equal(isSeededTestText("Branch recovery posture (DEMO)"), true);
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

/** Deterministic demo-seed residuals (same scorer as 7bcc5be). */
const SEEDED_SCENARIOS: Array<{ title: string; residual: number }> = [
  {
    title: "Potential compromise of externally exposed payment infrastructure",
    residual: 65.4,
  },
  {
    title: "Ransomware resilience risk on critical recovery path",
    residual: 58.56,
  },
  {
    title: "Critical vulnerability on internet-facing business API",
    residual: 55.83,
  },
  {
    title: "Credential compromise path via phishing and privileged access",
    residual: 48.97,
  },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe("portfolio and scenario list share one filtered set", () => {
  const extraTitles = [
    "Payment path P4-al-noted exposure",
    "Branch recovery posture (DEMO)",
    "Leaked score 65.4",
  ];

  async function insertScored(title: string, residual: number, isDemo = false) {
    const { rows } = await query<{ scenario_id: string }>(
      `INSERT INTO risk_scenarios (
         org_id, title, description, status, scenario_type, priority, priority_score, is_demo
       ) VALUES (
         $1, $2, 'regression fixture', 'active', 'correlated',
         'high'::priority_tier, 90, $3
       ) RETURNING scenario_id`,
      [AL, title, isDemo],
    );
    const scenarioId = rows[0]!.scenario_id;
    const { rows: ra } = await query<{ risk_assessment_id: string }>(
      `INSERT INTO risk_assessments (
         org_id, scenario_id, residual_risk, inherent_risk, likelihood_score, impact_score,
         confidence, priority_score, priority_tier, is_current, explanation
       ) VALUES (
         $1, $2, $3, $3, 50, 50, 70, 90, 'high'::priority_tier, true, 'regression'
       ) RETURNING risk_assessment_id`,
      [AL, scenarioId, residual],
    );
    await query(
      `UPDATE risk_scenarios SET current_assessment_id = $2
       WHERE org_id = $1 AND scenario_id = $3`,
      [AL, ra[0]!.risk_assessment_id, scenarioId],
    );
    return scenarioId;
  }

  it("keeps the seeded residuals, hides test rows, and counts the visible list", async () => {
    await seedDemoScenarios(AL);
    // Unanchored "P4-al-" and a trailing (DEMO) used to drop real rows.
    const keptMid = await insertScored("Payment path P4-al-noted exposure", 52.82);
    const keptDemo = await insertScored("Branch recovery posture (DEMO)", 33.7);
    const leak = await insertScored("Leaked score 65.4", 65.4, false);
    const { rows: domains } = await query<{ risk_domain_id: string }>(
      `SELECT risk_domain_id FROM risk_domains LIMIT 1`,
    );
    const { rows: sig } = await query<{ signal_id: string }>(
      `INSERT INTO security_signals (
         org_id, risk_domain_id, event_type, severity, observed_at, title,
         source_type, source_name, lifecycle_status
       ) VALUES (
         $1, $2, 'suspicious_process', 'critical', now(), 'leaked 65.4 signal',
         'soc', 'p4_test', 'ready_for_correlation'
       ) RETURNING signal_id`,
      [AL, domains[0]!.risk_domain_id],
    );
    await query(
      `INSERT INTO risk_scenario_signals (scenario_id, signal_id, org_id) VALUES ($1,$2,$3)`,
      [leak, sig[0]!.signal_id, AL],
    );
    // A test signal linked onto a real demo seed must not remove that seed.
    const portfolioBeforeLink = await getPortfolio(AL);
    const hero = portfolioBeforeLink.topRisks.find(
      (row: { title?: string }) => row.title === SEEDED_SCENARIOS[0]!.title,
    );
    assert.ok(hero?.scenarioId);
    await query(
      `INSERT INTO risk_scenario_signals (scenario_id, signal_id, org_id) VALUES ($1,$2,$3)`,
      [hero.scenarioId, sig[0]!.signal_id, AL],
    );

    try {
      const portfolio = await getPortfolio(AL);
      const scenarios = await listScenarios(AL, { limit: 200 });
      const listedIds = new Set(scenarios.map((row) => row.scenarioId));

      assert.equal(portfolio.totals.activeScenarios, portfolio.topRisks.length);
      for (const row of portfolio.topRisks) {
        assert.ok(listedIds.has(row.scenarioId), row.title);
      }

      for (const expected of SEEDED_SCENARIOS) {
        const card = portfolio.topRisks.find(
          (row: { title?: string }) => row.title === expected.title,
        );
        const listed = scenarios.find((row) => row.title === expected.title);
        assert.ok(card, expected.title);
        assert.ok(listed, expected.title);
        assert.equal(round2(card.residualRisk), expected.residual);
        assert.equal(round2(Number(listed.residualRisk)), expected.residual);
        assert.equal(card.scenarioId, listed.scenarioId);
      }

      const residuals = portfolio.topRisks.map((row: { residualRisk?: number }) =>
        round2(Number(row.residualRisk)),
      );
      assert.ok(residuals.includes(52.82));
      assert.ok(residuals.includes(33.7));
      assert.ok(portfolio.topRisks.some((row: { scenarioId?: string }) => row.scenarioId === keptMid));
      assert.ok(portfolio.topRisks.some((row: { scenarioId?: string }) => row.scenarioId === keptDemo));
      assert.equal(
        portfolio.topRisks.some((row: { scenarioId?: string }) => row.scenarioId === leak),
        false,
      );
      assert.equal(
        scenarios.some((row) => row.scenarioId === leak),
        false,
      );
      assert.ok(
        !portfolio.topRisks.some((row: { title?: string }) =>
          /^P4 isolated|^P4-base-|^p3-corr-/i.test(String(row.title ?? "")),
        ),
      );

      // Headline figures stay canonical.
      assert.equal(portfolio.totals.enterpriseScore, Number(CANONICAL.headlineScore));
      assert.equal(portfolio.totals.openDecisions, CANONICAL.openDecisions);
    } finally {
      await query(`DELETE FROM risk_scenarios WHERE org_id = $1 AND scenario_id = ANY($2::uuid[])`, [
        AL,
        [keptMid, keptDemo, leak],
      ]);
      await query(`DELETE FROM security_signals WHERE signal_id = $1`, [sig[0]!.signal_id]);
    }
  });
});
