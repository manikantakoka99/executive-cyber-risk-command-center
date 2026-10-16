/**
 * Seeded test fixtures must not reach executive feeds.
 *
 * Principled markers (preferred over title matching):
 * - risk_scenarios.scenario_type = 'isolated_test'  (createIsolatedScenario)
 * - security_signals.source_name in ('p4_test', 'phase3_test')
 * - risk_findings.fingerprint LIKE 'ecc-demo-%'
 * - risk_findings.raw_payload.demo = true
 *
 * Activity rows have no flag column, so free text uses the same token list.
 */
import { BAND_THRESHOLDS } from "../risk/bands.js";

/** PostgreSQL ~* pattern. Keep in sync with FIXTURE_TEXT. */
export const SEEDED_TEST_TITLE_SQL =
  "(P4 isolated|P4-base-|P4-al-|P4-fal-|p3-corr-|Isolated scenario |Generic Security Events [0-9]+|isolated_test)";

const FIXTURE_TEXT =
  /(P4 isolated|P4-base-|P4-al-|P4-fal-|p3-corr-|Isolated scenario |Generic Security Events \d+|\bisolated_test\b)/i;

export function isSeededTestText(text: string | null | undefined): boolean {
  if (!text) return false;
  return (
    FIXTURE_TEXT.test(text) ||
    /\(DEMO\)\s*$/i.test(text) ||
    /Unnamed process/i.test(text) ||
    /\btest host\b/i.test(text)
  );
}

/** True when a scenario row is a seeded test fixture. */
export function sqlScenarioIsTest(alias = "s"): string {
  const title = `COALESCE(${alias}.title, '')`;
  return `(
    COALESCE(${alias}.scenario_type, '') = 'isolated_test'
    OR ${title} ~* '${SEEDED_TEST_TITLE_SQL}'
    OR EXISTS (
      SELECT 1 FROM risk_scenario_signals rss
      JOIN security_signals sig
        ON sig.signal_id = rss.signal_id AND sig.org_id = rss.org_id
      WHERE rss.scenario_id = ${alias}.scenario_id
        AND rss.org_id = ${alias}.org_id
        AND sig.source_name IN ('p4_test', 'phase3_test')
    )
  )`;
}

export function sqlExcludeTestScenario(alias = "s"): string {
  return `NOT ${sqlScenarioIsTest(alias)}`;
}

/** Synthetic demo-seed findings (fingerprint / payload), plus title fallback. */
export function sqlFindingIsSeededTest(alias = "f"): string {
  const title = `COALESCE(${alias}.title, '')`;
  return `(
    COALESCE(${alias}.fingerprint, '') LIKE 'ecc-demo-%'
    OR COALESCE(${alias}.raw_payload->>'demo', '') IN ('true', '1')
    OR COALESCE(${alias}.source, '') IN ('demo_seed', 'ecc-demo', 'p4_test', 'phase3_test')
    OR ${title} ~* '\\(DEMO\\)[[:space:]]*$'
    OR ${title} ~* '${SEEDED_TEST_TITLE_SQL}'
  )`;
}

export function sqlExcludeTestFinding(alias = "f"): string {
  return `NOT ${sqlFindingIsSeededTest(alias)}`;
}

/** Activity and other free-text columns with no fixture flag. */
export function sqlTextIsSeededTest(expr: string): string {
  return `(
    COALESCE(${expr}, '') ~* '${SEEDED_TEST_TITLE_SQL}'
    OR COALESCE(${expr}, '') ~* '\\(DEMO\\)[[:space:]]*$'
  )`;
}

export function sqlExcludeTestText(expr: string): string {
  return `NOT ${sqlTextIsSeededTest(expr)}`;
}

export type ScenarioSetCounts = {
  outsideTolerance: number;
  highCritical: number;
};

/** Outside-tolerance and high/critical counts for one already-filtered scenario list. */
export function scenarioSetFromRisks(
  risks: ReadonlyArray<{
    toleranceState?: unknown;
    residualRisk?: unknown;
    title?: unknown;
    name?: unknown;
  }>,
): ScenarioSetCounts {
  return {
    outsideTolerance: risks.filter((r) => r.toleranceState === "outside").length,
    highCritical: risks.filter((r) => Number(r.residualRisk ?? -1) >= BAND_THRESHOLDS.highMin).length,
  };
}
