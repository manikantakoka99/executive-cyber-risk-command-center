import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { query } from "../db.js";

const { Client } = pg;
const MIGRATION = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../db/migrations/013_nist_csf_2.sql"),
  "utf8",
);
const MARKER = "-- >>> ENUMS_COMMIT_POINT <<<";
const SCRATCH = "ecc_nist_migration_check";

function connectionString(): string {
  return (
    process.env.DATABASE_URL ??
    "postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center"
  );
}

async function applyTwice(client: pg.Client) {
  const [before, afterSql] = MIGRATION.split(MARKER);
  assert.ok(before && afterSql, "migration commit marker");
  for (let pass = 0; pass < 2; pass++) {
    await client.query(before);
    await client.query(afterSql);
  }
}

describe("nist_csf_2 migration", () => {
  after(async () => {
    const admin = new Client({ connectionString: connectionString() });
    await admin.connect();
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [SCRATCH],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
    } finally {
      await admin.end();
    }
  });

  it("upgrades a master-shaped database and is a no-op the second time", async () => {
    const admin = new Client({ connectionString: connectionString() });
    await admin.connect();
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [SCRATCH],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
      await admin.query(`CREATE DATABASE ${SCRATCH}`);
    } finally {
      await admin.end();
    }

    const url = new URL(connectionString());
    url.pathname = `/${SCRATCH}`;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    try {
      await client.query(`
        CREATE TYPE framework_code AS ENUM ('dubai_isr','pci_dss_v4','iso_27001','nesa_uae_ia','gdpr');
        CREATE TABLE compliance_frameworks (
          framework_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          code framework_code NOT NULL UNIQUE,
          display_name VARCHAR(150) NOT NULL,
          renewal_cycle_months INT
        );
        CREATE TABLE schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          description TEXT
        );
      `);
      await applyTwice(client);
      const labels = await client.query<{ display_name: string; n: string }>(
        `SELECT display_name, COUNT(*)::text AS n
         FROM compliance_frameworks WHERE code = 'nist_csf_2'
         GROUP BY display_name`,
      );
      assert.equal(labels.rows.length, 1);
      assert.equal(labels.rows[0]?.display_name, "NIST CSF 2.0");
      assert.equal(labels.rows[0]?.n, "1");
      const value = await client.query(
        `SELECT 1 FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'framework_code' AND e.enumlabel = 'nist_csf_2'`,
      );
      assert.equal(value.rowCount, 1);
    } finally {
      await client.end();
    }
  });

  it("changes nothing when the fresh schema already has NIST", async () => {
    const before = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM compliance_frameworks WHERE code = 'nist_csf_2'`,
    );
    assert.equal(before.rows[0]?.n, "1");
    const client = new Client({ connectionString: connectionString() });
    await client.connect();
    try {
      await applyTwice(client);
    } finally {
      await client.end();
    }
    const afterCount = await query<{ n: string; display_name: string }>(
      `SELECT COUNT(*)::text AS n, MIN(display_name) AS display_name
       FROM compliance_frameworks WHERE code = 'nist_csf_2'`,
    );
    assert.equal(afterCount.rows[0]?.n, "1");
    assert.equal(afterCount.rows[0]?.display_name, "NIST CSF 2.0");
  });
});
