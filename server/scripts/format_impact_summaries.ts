#!/usr/bin/env npx tsx
/**
 * Non-destructive: rewrite executive_decisions.impact_summary AED chips
 * from linked business_impact_assessments numbers (AED x.xM / xxxK).
 *
 * Usage (from server/):
 *   npx tsx scripts/format_impact_summaries.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sqlPath = path.join(
    __dirname,
    "../../db/docker-init/04_format_aed_impact_summaries.sql",
  );
  const sql = readFileSync(sqlPath, "utf8");
  const before = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM executive_decisions
     WHERE impact_summary ~ 'AED[[:space:]]*[0-9]{1,3}(,[0-9]{3})+'`,
  );
  await query(sql);
  const after = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM executive_decisions
     WHERE impact_summary ~ 'AED[[:space:]]*[0-9]{1,3}(,[0-9]{3})+'`,
  );
  console.log(
    `[format_impact_summaries] comma-AED rows: ${before.rows[0]?.n} → ${after.rows[0]?.n}`,
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
