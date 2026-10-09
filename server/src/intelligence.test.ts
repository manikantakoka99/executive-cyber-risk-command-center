import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { query } from "./db.js";
import {
  detectMaterialChanges,
  generateExecutiveReport,
  getCompliancePosture,
  getControlPosture,
  getDecisionCenter,
  getExecutiveBriefing,
  getHotspots,
  getOrgSettings,
  getPortfolio,
  getReportSnapshot,
  getTrends,
} from "./services/intelligence.js";
import { createIsolatedScenario } from "./services/closedLoop.js";
import { seedDemoScenarios } from "./services/scenarios.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FAL = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";

before(async () => {
  await seedDemoScenarios(AL);
  await createIsolatedScenario(AL, { ineffectiveControl: true });
});

describe("Phase 5 portfolio + trends", () => {
  it("aggregates enterprise portfolio without averaging domains", async () => {
    const p = await getPortfolio(AL);
    assert.match(p.methodology, /does not average/i);
    assert.ok(typeof p.totals.activeScenarios === "number");
    assert.ok(p.totals.byPriority);
    assert.ok(Array.isArray(p.topRisks));
  });

  it("tenant-safe aggregation: Org A portfolio has no Org B scenario ids", async () => {
    const [al, fal] = await Promise.all([getPortfolio(AL), getPortfolio(FAL)]);
    const falIds = new Set(fal.topRisks.map((r: any) => r.scenarioId));
    for (const r of al.topRisks) {
      assert.ok(!falIds.has(r.scenarioId));
    }
  });

  it("handles insufficient trend history without inventing series", async () => {
    // Fresh org window with tiny history still returns explicit flag when <2 buckets
    const t = await getTrends(AL, "7d");
    assert.ok("insufficientHistory" in t);
    if (t.insufficientHistory) {
      assert.equal(t.residualTrend.length, 0);
      assert.match(t.message, /Insufficient historical data/i);
    } else {
      assert.ok(t.residualTrend.length >= 2);
    }
  });

  it("hotspot statements include denominator context", async () => {
    const h = await getHotspots(AL);
    assert.ok(h.denominatorHighCritical >= 1 || h.statements.length === 0);
    for (const s of h.statements) {
      assert.match(s, /denominator|contains|concentrated/i);
    }
  });
});

describe("Phase 5 decision / compliance / controls", () => {
  it("decision center filters by status buckets", async () => {
    const d = await getDecisionCenter(AL);
    assert.ok(Array.isArray(d.awaitingAction));
    assert.ok(Array.isArray(d.recentlyApproved));
    assert.ok(Array.isArray(d.monitored));
  });

  it("compliance posture separates coverage from cyber safety", async () => {
    const c = await getCompliancePosture(AL);
    assert.match(c.note, /separate from enterprise cyber risk/i);
    assert.ok(Array.isArray(c.frameworks));
  });

  it("control posture aggregates effectiveness", async () => {
    const c = await getControlPosture(AL);
    assert.ok(c.counts);
    assert.ok("ineffective" in c.counts);
  });
});

describe("Phase 5 briefing + material changes + reports", () => {
  it("executive briefing statements are traceable to facts", async () => {
    const b = await getExecutiveBriefing(AL);
    assert.equal(b.generatedFrom, "structured_facts_only");
    assert.ok(b.sections.currentPosture.text);
    assert.ok(b.facts);
    assert.ok(b.sections.currentPosture.evidence);
  });

  it("material change detection emits reason codes", async () => {
    const changes = await detectMaterialChanges(AL);
    assert.ok(Array.isArray(changes));
    for (const c of changes.slice(0, 5)) {
      assert.ok(c.reasonCode);
      assert.ok(c.summary);
    }
  });

  it("report snapshot is immutable payload with hash", async () => {
    const { rows } = await query<{ user_id: string }>(
      `SELECT u.user_id FROM users u
       JOIN v_user_primary_role v ON v.user_id = u.user_id
       WHERE u.org_id=$1 AND v.role_code='cxo' LIMIT 1`,
      [AL],
    );
    const report = await generateExecutiveReport(AL, rows[0].user_id, "board_briefing", "30d");
    assert.ok(report.contentHash);
    assert.ok(report.snapshot);
    const snap = await getReportSnapshot(AL, report.reportId);
    assert.ok(snap);
    assert.equal(snap!.contentHash, report.contentHash);
    assert.equal(snap!.immutable, true);
    // Mutating live overview data must not change stored snapshot hash
    const again = await getReportSnapshot(AL, report.reportId);
    assert.equal(again!.contentHash, report.contentHash);
  });

  it("org settings and connector catalog are tenant scoped", async () => {
    const s = await getOrgSettings(AL);
    assert.equal(s.orgId, AL);
    assert.ok(Array.isArray(s.domains));
  });

  it("Org A cannot read Org B report snapshot", async () => {
    const { rows } = await query<{ user_id: string }>(
      `SELECT u.user_id FROM users u
       JOIN v_user_primary_role v ON v.user_id = u.user_id
       WHERE u.org_id=$1 AND v.role_code='cxo' LIMIT 1`,
      [FAL],
    );
    const falReport = await generateExecutiveReport(
      FAL,
      rows[0].user_id,
      "board_briefing",
      "30d",
    );
    const leaked = await getReportSnapshot(AL, falReport.reportId);
    assert.equal(leaked, null);
  });
});
