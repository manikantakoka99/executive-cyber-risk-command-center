import { AsyncLocalStorage } from "node:async_hooks";
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

const conn = connectionString();

export const pool = new Pool({
  connectionString: conn,
  max: Number(process.env.PG_POOL_MAX ?? 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: /supabase\.co|pooler\.supabase\.com/i.test(conn)
    ? { rejectUnauthorized: false }
    : undefined,
});

type TenantStore = { orgId: string; userId: string | null };

/** Request-scoped tenant binding — never use process-global vars (causes cross-request races / 502s). */
const tenantAls = new AsyncLocalStorage<TenantStore>();

export function runWithTenant<T>(orgId: string, userId: string, fn: () => Promise<T>): Promise<T> {
  return tenantAls.run({ orgId, userId }, fn);
}

/** Bind an empty ALS store for the lifetime of one HTTP request (call from onRequest). */
export function runWithRequestTenant<T>(fn: () => T): T {
  return tenantAls.run({ orgId: "", userId: null }, fn);
}

/** Mutate the current request ALS store. Requires runWithRequestTenant / runWithTenant. */
export async function setTenantContext(orgId: string, userId: string) {
  const store = tenantAls.getStore();
  if (store) {
    store.orgId = orgId;
    store.userId = userId;
    return;
  }
  // Tests / scripts without an HTTP request: bind for the remainder of this async chain.
  tenantAls.enterWith({ orgId, userId });
}

/** Org bound by the authenticated session. Empty when the request has no session. */
export function sessionOrgId(): string | null {
  const orgId = tenantAls.getStore()?.orgId?.trim() ?? "";
  return orgId || null;
}

export function clearTenantContext() {
  const store = tenantAls.getStore();
  if (store) {
    store.orgId = "";
    store.userId = null;
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  const store = tenantAls.getStore();
  const orgId = store?.orgId || null;
  const userId = store?.userId || null;

  if (!orgId) {
    return pool.query<T>(text, params);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    if (userId) {
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);
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
