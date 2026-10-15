import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

function connectionString(): string {
  const raw =
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL ??
    "postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (
      (host.includes("supabase.co") || host.includes("pooler.supabase.com")) &&
      !url.searchParams.has("sslmode")
    ) {
      url.searchParams.set("sslmode", "require");
      return url.toString();
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

export const pool = new Pool({
  connectionString: connectionString(),
  ssl:
    /supabase\.co|pooler\.supabase\.com/i.test(connectionString())
      ? { rejectUnauthorized: false }
      : undefined,
});

/** Request-scoped tenant ids applied inside each pooled query transaction. */
let boundOrgId: string | null = null;
let boundUserId: string | null = null;

export async function setTenantContext(orgId: string, userId: string) {
  boundOrgId = orgId;
  boundUserId = userId;
}

export function clearTenantContext() {
  boundOrgId = null;
  boundUserId = null;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  // No tenant binding — plain query (bootstrap / health).
  if (!boundOrgId) {
    return pool.query<T>(text, params);
  }

  const client = await pool.connect();
  try {
    // Local GUCs last for the transaction only — wrap the statement.
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [boundOrgId]);
    if (boundUserId) {
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [boundUserId]);
    }
    const result = await client.query<T>(text, params);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Run work on one connection with tenant GUC set (for multi-statement RLS). */
export async function withTenant<T>(
  orgId: string,
  userId: string,
  fn: (q: <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<pg.QueryResult<R>>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const q = async <R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => client.query<R>(text, params);
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);
    const out = await fn(q);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}
