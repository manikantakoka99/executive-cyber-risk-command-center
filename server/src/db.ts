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

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return pool.query<T>(text, params);
}
