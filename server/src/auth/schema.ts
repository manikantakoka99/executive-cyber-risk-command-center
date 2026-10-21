import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../db.js";

const PENDING = ["009_ecc_auth.sql", "010_decision_log_org.sql"];

let pending: Promise<void> | null = null;

/** Apply migration 009 once when the database is reachable and it is not recorded. */
export function ensureAuthSchema(): Promise<void> {
  if (!pending) {
    pending = apply().catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

async function apply(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const file of PENDING) {
    const version = file.replace(/\.sql$/, "");
    try {
      const { rows } = await query<{ version: string }>(
        `SELECT version FROM schema_migrations WHERE version = $1`,
        [version],
      );
      if (rows[0]) continue;
    } catch {
      return;
    }
    const sql = readFileSync(path.resolve(here, "../../../db/migrations", file), "utf8");
    await query(sql);
  }
}
