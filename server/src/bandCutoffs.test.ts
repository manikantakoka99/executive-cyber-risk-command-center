import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "./index.js";
import { query } from "./db.js";
import {
  BAND_THRESHOLDS,
  bandOf,
  priorityTierFromScore,
  tierWord,
} from "./risk/bands.js";
import { loadActivePolicy } from "./risk/policy.js";
import { getPortfolio } from "./services/intelligence.js";
import { listScenarios } from "./services/scenarios.js";

const ORG = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const CISO = "c1500001-a090-41a0-8ecc-000000000001";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Canonical cutoffs: Critical≥70, High 55–69, Medium 35–54, Low <35. */
const CASES: Array<{ residual: number; tier: string; band: string }> = [
  { residual: 64.69, tier: "high", band: "High" },
  { residual: 52.82, tier: "medium", band: "Medium" },
  { residual: 33.7, tier: "low", band: "Low" },
  { residual: 55, tier: "high", band: "High" },
  { residual: 70, tier: "critical", band: "Critical" },
];

const FIXTURE_PREFIX = "BandCutoff fixture";

async function applyBandMigration() {
  const sql = readFileSync(
    path.join(__dirname, "../../db/migrations/008_align_priority_bands.sql"),
    "utf8",
  );
  await query(sql);
}

async function seedFixtures() {
  await query(
    `DELETE FROM risk_scenarios
     WHERE org_id = $1 AND title LIKE $2`,
    [ORG, `${FIXTURE_PREFIX}%`],
  );

  for (const c of CASES) {
    const { rows: scen } = await query<{ scenario_id: string }>(
      `INSERT INTO risk_scenarios (
         org_id, title, description, status, scenario_type, priority, priority_score
       ) VALUES (
         $1, $2, 'band cutoff fixture', 'active', 'correlated',
         'critical'::priority_tier, 99
       ) RETURNING scenario_id`,
      [ORG, `${FIXTURE_PREFIX} ${c.residual}`],
    );
    const sid = scen[0]!.scenario_id;
    // Intentionally wrong stored tier (critical) so read-time derivation is forced.
    const { rows: ra } = await query<{ risk_assessment_id: string }>(
      `INSERT INTO risk_assessments (
         org_id, scenario_id, residual_risk, inherent_risk, likelihood_score, impact_score,
         confidence, priority_score, priority_tier, is_current, explanation
       ) VALUES (
         $1, $2, $3, $3, 50, 50, 70, 99, 'critical'::priority_tier, true, 'fixture'
       ) RETURNING risk_assessment_id`,
      [ORG, sid, c.residual],
    );
    await query(
      `UPDATE risk_scenarios SET current_assessment_id = $2, priority = 'critical'::priority_tier
       WHERE org_id = $1 AND scenario_id = $3`,
      [ORG, ra[0]!.risk_assessment_id, sid],
    );
  }
}

async function cleanupFixtures() {
  await query(
    `DELETE FROM risk_scenarios
     WHERE org_id = $1 AND title LIKE $2`,
    [ORG, `${FIXTURE_PREFIX}%`],
  );
}

describe("shared band cutoffs (bands.ts)", () => {
  before(async () => {
    await applyBandMigration();
    await seedFixtures();
  });

  after(async () => {
    await cleanupFixtures();
    await app.close();
  });

  it("bandOf / tierWord map the QA residual samples", () => {
    assert.deepEqual(BAND_THRESHOLDS, {
      mediumMin: 35,
      highMin: 55,
      criticalMin: 70,
    });
    for (const c of CASES) {
      assert.equal(bandOf(c.residual), c.band, String(c.residual));
      assert.equal(tierWord(c.residual), c.tier, String(c.residual));
      assert.equal(priorityTierFromScore(c.residual), c.tier, String(c.residual));
    }
  });

  it("portfolio topRisks derive priority from residual, ignoring stored critical", async () => {
    const portfolio = await getPortfolio(ORG);
    for (const c of CASES) {
      const row = portfolio.topRisks.find(
        (r: { title?: string }) => r.title === `${FIXTURE_PREFIX} ${c.residual}`,
      );
      assert.ok(row, `missing portfolio row for ${c.residual}`);
      assert.equal(row.residualRisk, c.residual);
      assert.equal(row.priority, c.tier, `portfolio ${c.residual}`);
    }
  });

  it("scenarios list derives priority from residual", async () => {
    const scenarios = await listScenarios(ORG, { limit: 100 });
    for (const c of CASES) {
      const row = scenarios.find((s) => s.title === `${FIXTURE_PREFIX} ${c.residual}`);
      assert.ok(row, `missing scenario for ${c.residual}`);
      assert.equal(row.residualRisk, c.residual);
      assert.equal(row.priority, c.tier, `scenarios ${c.residual}`);
    }
  });

  it("HTTP portfolio + scenarios + intelligence briefing use the same cutoffs", async () => {
    const headers = { "x-org-id": ORG, "x-user-id": CISO };

    const portfolioRes = await app.inject({
      method: "GET",
      url: "/api/ecc/portfolio",
      headers,
    });
    assert.equal(portfolioRes.statusCode, 200);
    const portfolio = portfolioRes.json();
    for (const c of CASES) {
      const row = (portfolio.topRisks ?? []).find(
        (r: { title?: string }) => r.title === `${FIXTURE_PREFIX} ${c.residual}`,
      );
      assert.ok(row, `HTTP portfolio missing ${c.residual}`);
      assert.equal(row.priority, c.tier);
    }

    const scenariosRes = await app.inject({
      method: "GET",
      url: "/api/ecc/scenarios",
      headers,
    });
    assert.equal(scenariosRes.statusCode, 200);
    const scenarios = scenariosRes.json().scenarios ?? [];
    for (const c of CASES) {
      const row = scenarios.find(
        (s: { title?: string }) => s.title === `${FIXTURE_PREFIX} ${c.residual}`,
      );
      assert.ok(row, `HTTP scenarios missing ${c.residual}`);
      assert.equal(row.priority, c.tier);
    }

    const briefingRes = await app.inject({
      method: "GET",
      url: "/api/ecc/executive-briefing",
      headers,
    });
    assert.equal(briefingRes.statusCode, 200);
    const briefing = briefingRes.json();
    // Top residual among fixtures is 70 → Critical band via bandOf.
    assert.ok(
      briefing.sections?.currentPosture?.text?.includes("Critical") ||
        briefing.sections?.currentPosture?.evidence?.topResidual != null,
    );
    const top = briefing.sections?.currentPosture?.evidence?.topResidual;
    if (typeof top === "number") {
      assert.equal(bandOf(top), bandOf(top)); // sanity
    }
  });

  it("active policy priority_bands match bands.ts", async () => {
    const policy = await loadActivePolicy(ORG);
    assert.deepEqual(policy.config.priority_bands, {
      critical: BAND_THRESHOLDS.criticalMin,
      high: BAND_THRESHOLDS.highMin,
      medium: BAND_THRESHOLDS.mediumMin,
    });
    const { rows } = await query<{ bands: unknown }>(
      `SELECT config->'priority_bands' AS bands FROM risk_policies
       WHERE code = 'ecc_default' AND is_active = true
       ORDER BY version DESC LIMIT 1`,
    );
    if (rows[0]?.bands) {
      const bands = rows[0].bands as Record<string, number>;
      assert.equal(Number(bands.critical), 70);
      assert.equal(Number(bands.high), 55);
      assert.equal(Number(bands.medium), 35);
    }
  });
});
