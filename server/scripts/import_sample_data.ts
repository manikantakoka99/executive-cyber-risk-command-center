import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import xlsxPkg from "xlsx";
const xlsx = (xlsxPkg as any).default ?? xlsxPkg;
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "../../.env") });
dotenv.config();

const { Client } = pg;

const DEFAULT_XLSX = path.resolve(here, "../../reference/CyberCommandCenter_Sample_Data.xlsx");
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://ecc:ecc_dev_password@127.0.0.1:5432/cyber_command_center";

const SHEET_LOAD_ORDER = [
  "organizations",
  "users",
  "risk_domains",
  "compliance_frameworks",
  "org_domain_subscriptions",
  "domain_risk_snapshots",
  "enterprise_risk_score_snapshots",
  "risk_findings",
  "business_impact_assessments",
  "executive_decisions",
  "decision_action_log",
  "org_compliance_status",
  "command_center_activity",
  "generated_reports",
];

const PK_MAP: Record<string, string[]> = {
  organizations: ["org_id"],
  users: ["user_id"],
  risk_domains: ["risk_domain_id"],
  compliance_frameworks: ["framework_id"],
  org_domain_subscriptions: ["org_id", "risk_domain_id"],
  domain_risk_snapshots: ["snapshot_id"],
  enterprise_risk_score_snapshots: ["snapshot_id"],
  risk_findings: ["finding_id"],
  business_impact_assessments: ["impact_id"],
  executive_decisions: ["decision_id"],
  decision_action_log: ["action_log_id"],
  org_compliance_status: ["status_id"],
  command_center_activity: ["activity_id"],
  generated_reports: ["report_id"],
  audit_log: ["log_id"],
};

function coerce(val: any) {
  if (val === undefined || val === null) return null;
  if (typeof val === "string") {
    const s = val.trim();
    if (s === "") return null;
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    }
    return s;
  }
  return val;
}

function formatAed(n: number | null | undefined): string | null {
  if (n == null || isNaN(Number(n))) return null;
  const num = Number(n);
  const abs = Math.abs(num);
  if (abs >= 1_000_000) {
    return `AED ${(num / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `AED ${Math.round(num / 1_000)}K`;
  }
  return `AED ${Math.round(num)}`;
}

async function getTableColumns(client: pg.Client, table: string): Promise<Set<string>> {
  const res = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return new Set(res.rows.map((r) => r.column_name));
}

async function upsertRows(
  client: pg.Client,
  table: string,
  cols: string[],
  rows: Record<string, any>[]
): Promise<number> {
  if (!rows.length) return 0;
  const existingCols = await getTableColumns(client, table);
  const validCols = cols.filter((c) => existingCols.has(c));
  if (!validCols.length) return 0;

  const pks = PK_MAP[table] || [];
  const colSql = validCols.map((c) => `"${c}"`).join(", ");
  const placeholders = validCols.map((_, i) => `$${i + 1}`).join(", ");
  const updateCols = validCols.filter((c) => !pks.includes(c));

  let sql: string;
  if (updateCols.length > 0 && pks.length > 0) {
    const updates = updateCols.map((c) => `"${c}"=EXCLUDED."${c}"`).join(", ");
    sql = `INSERT INTO "${table}" (${colSql}) VALUES (${placeholders}) ON CONFLICT (${pks.map((p) => `"${p}"`).join(", ")}) DO UPDATE SET ${updates}`;
  } else if (pks.length > 0) {
    sql = `INSERT INTO "${table}" (${colSql}) VALUES (${placeholders}) ON CONFLICT (${pks.map((p) => `"${p}"`).join(", ")}) DO NOTHING`;
  } else {
    sql = `INSERT INTO "${table}" (${colSql}) VALUES (${placeholders})`;
  }

  let count = 0;
  for (const row of rows) {
    const values = validCols.map((c) => coerce(row[c]));
    // Check if any pk is null
    const hasNullPk = pks.some((pk) => {
      const idx = validCols.indexOf(pk);
      return idx !== -1 && values[idx] == null;
    });
    if (hasNullPk) continue;

    await client.query(sql, values);
    count++;
  }
  return count;
}

async function main() {
  console.log(`Connecting to: ${DATABASE_URL}`);
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log(`Reading workbook: ${DEFAULT_XLSX}`);
  const wb = xlsx.readFile(DEFAULT_XLSX, { cellDates: true });

  const summary: Record<string, number> = {};

  try {
    await client.query("BEGIN");

    let userSheetRows: Record<string, any>[] = [];

    for (const sheet of SHEET_LOAD_ORDER) {
      if (!wb.SheetNames.includes(sheet)) {
        console.log(`  ${sheet}: not in workbook`);
        continue;
      }
      const ws = wb.Sheets[sheet];
      const rows = xlsx.utils.sheet_to_json<Record<string, any>>(ws, { defval: null });
      if (!rows.length) {
        console.log(`  ${sheet}: empty`);
        summary[sheet] = 0;
        continue;
      }
      const cols = Object.keys(rows[0]);
      if (sheet === "users") userSheetRows = rows;

      const n = await upsertRows(client, sheet, cols, rows);
      summary[sheet] = n;
      console.log(`  ${sheet}: upserted ${n}`);
    }

    // Assign user roles
    if (userSheetRows.length) {
      let roleCount = 0;
      for (const row of userSheetRows) {
        const uid = coerce(row.user_id);
        const oid = coerce(row.org_id);
        const role = coerce(row.role);
        if (!uid || !oid || !role) continue;
        const res = await client.query(
          `INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
           SELECT $1, r.role_id, $2, true
           FROM roles r WHERE r.code = $3
           ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true, org_id = EXCLUDED.org_id`,
          [uid, oid, String(role)]
        );
        roleCount += res.rowCount ?? 0;
      }
      summary.user_roles = roleCount;
      console.log(`  user_roles: assigned ${roleCount}`);
    }

    // Backfill assets from findings
    const assetRes = await client.query(`
      INSERT INTO assets (org_id, name, asset_type, criticality, environment, internet_exposed, status)
      SELECT DISTINCT f.org_id, f.affected_asset,
        CASE
          WHEN lower(f.affected_asset) LIKE '%gateway%'
            OR lower(f.affected_asset) LIKE '%portal%'
            OR lower(f.affected_asset) LIKE '%api%'
            OR lower(f.affected_asset) LIKE '%checkout%'
            OR lower(f.affected_asset) LIKE '%service%' THEN 'application'::asset_type
          WHEN lower(f.affected_asset) LIKE '%infrastructure%' THEN 'host'::asset_type
          ELSE 'other'::asset_type
        END,
        CASE
          WHEN lower(f.affected_asset) LIKE '%payment%'
            OR lower(f.affected_asset) LIKE '%gateway%' THEN 'critical'::asset_criticality
          ELSE 'medium'::asset_criticality
        END,
        'production'::asset_environment,
        (lower(f.affected_asset) LIKE '%public%'
          OR lower(f.affected_asset) LIKE '%customer%'
          OR lower(f.affected_asset) LIKE '%online%'
          OR lower(f.affected_asset) LIKE '%gateway%'),
        'active'
      FROM risk_findings f
      WHERE f.affected_asset IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM assets a WHERE a.org_id = f.org_id AND a.name = f.affected_asset
        )
    `);
    summary.assets_backfill = assetRes.rowCount ?? 0;
    console.log(`  assets_backfill: ${summary.assets_backfill}`);

    await client.query(`
      UPDATE risk_findings f
      SET asset_id = a.asset_id,
          first_seen_at = COALESCE(f.first_seen_at, f.detected_at),
          last_seen_at = COALESCE(f.last_seen_at, COALESCE(f.resolved_at, f.updated_at, f.detected_at))
      FROM assets a
      WHERE f.affected_asset IS NOT NULL
        AND a.org_id = f.org_id
        AND a.name = f.affected_asset
    `);

    // Format impact summaries
    const impactRows = await client.query(`
      SELECT ed.decision_id,
             b.financial_exposure_aed,
             b.downtime_cost_per_hour_aed
      FROM executive_decisions ed
      JOIN business_impact_assessments b ON b.impact_id = ed.impact_id
      WHERE b.financial_exposure_aed IS NOT NULL
         OR b.downtime_cost_per_hour_aed IS NOT NULL
    `);
    let impCount = 0;
    for (const r of impactRows.rows) {
      const parts: string[] = [];
      const exp = formatAed(r.financial_exposure_aed);
      const down = formatAed(r.downtime_cost_per_hour_aed);
      if (exp) parts.push(`${exp} exposure`);
      if (down) parts.push(`downtime ~${down}/hr`);
      if (!parts.length) continue;
      const res = await client.query(
        "UPDATE executive_decisions SET impact_summary = $1 WHERE decision_id = $2",
        [parts.join(", "), r.decision_id]
      );
      impCount += res.rowCount ?? 0;
    }
    summary.impact_summary_format = impCount;
    console.log(`  impact_summary_format: ${impCount}`);

    // Unmapped domain
    await client.query(`
      INSERT INTO risk_domains (code, display_name, short_label, yvi_solution, description)
      VALUES (
        'unmapped',
        'Unmapped / Unknown Source',
        'Unmapped',
        NULL,
        'Holding domain for signals that could not be mapped to a subscribed ECC domain'
      )
      ON CONFLICT (code) DO NOTHING
    `);
    console.log("  unmapped_domain: ensured");

    await client.query("COMMIT");
    console.log("Import successfully committed!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Import failed, rolled back:", err);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
