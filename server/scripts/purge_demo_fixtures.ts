#!/usr/bin/env npx tsx
/**
 * Non-destructive purge of automated test leftovers from the Al Dhabi demo tenant.
 * Soft-closes matching scenarios (status → closed) and leaves Falcon / other orgs alone.
 *
 * Usage (from server/):
 *   npx tsx scripts/purge_demo_fixtures.ts
 *   npx tsx scripts/purge_demo_fixtures.ts --dry-run
 *
 * Does NOT drop tenants, wipe registers, or call demo:reset.
 */
import "dotenv/config";
import { pool, query } from "../src/db.js";

const DEMO_ORG = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const dryRun = process.argv.includes("--dry-run");

const TITLE_SQL = `
  title ~* '^(P4 isolated|P4-base-|P4-al-|P4-fal-|p3-corr-|Isolated scenario |BandCutoff fixture)'
  OR title ~* 'test host'
  OR title ~* 'Generic Security Events [0-9]'
  OR title ~* '^Al Dhabi Generic '
  OR scenario_type = 'isolated_test'
`;

async function main() {
  const { rows: found } = await query<{
    scenario_id: string;
    title: string;
    status: string;
    scenario_type: string | null;
  }>(
    `SELECT scenario_id, title, status::text, scenario_type
     FROM risk_scenarios
     WHERE org_id = $1
       AND status NOT IN ('closed')
       AND (${TITLE_SQL})
     ORDER BY title`,
    [DEMO_ORG],
  );

  console.log(
    `[purge_demo_fixtures] ${dryRun ? "DRY RUN — " : ""}found ${found.length} open fixture scenario(s) in Al Dhabi`,
  );
  for (const row of found) {
    console.log(`  · ${row.status.padEnd(10)} ${row.scenario_type ?? "-"}  ${row.title}`);
  }

  if (!found.length) {
    console.log("[purge_demo_fixtures] nothing to do");
    return;
  }
  if (dryRun) return;

  const { rowCount } = await query(
    `UPDATE risk_scenarios
     SET status = 'closed',
         updated_at = now(),
         explanation = COALESCE(explanation, '') || E'\n[purged test fixture]'
     WHERE org_id = $1
       AND status NOT IN ('closed')
       AND (${TITLE_SQL})`,
    [DEMO_ORG],
  );

  // Disable (do not DELETE) test-created Generic Security Events connectors —
  // hard delete cascades with SET NULL on security_signals.org_id and fails NOT NULL.
  const conn = await query(
    `UPDATE connectors
     SET status = 'disabled',
         name = left('disabled-' || name, 160),
         updated_at = now()
     WHERE org_id = $1
       AND name ~* '^Generic Security Events [0-9]'
       AND status IS DISTINCT FROM 'disabled'
     RETURNING connector_id, name`,
    [DEMO_ORG],
  );

  console.log(
    `[purge_demo_fixtures] closed ${rowCount ?? 0} scenario(s); disabled ${conn.rowCount ?? 0} test connector(s)`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
