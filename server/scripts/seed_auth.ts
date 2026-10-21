/**
 * Local-only demo passwords.
 *
 * Reads ECC_DEMO_PASSWORD from the environment (see .env.example).
 * Writes bcrypt hashes into auth_accounts. Never prints the password.
 *
 *   ECC_DEMO_PASSWORD='replace-me' npm run auth:seed
 *
 * Layla Al Hashimi is also a CISO member of Falcon National Bank so the
 * org switcher can be exercised. Her Falcon access uses the same login.
 */
import { query, pool } from "../src/db.js";
import { PERSONAS, TENANT_B_ORG_ID } from "../src/command/personas.js";
import { hashPassword } from "../src/auth/passwords.js";
import { ensureAuthSchema } from "../src/auth/schema.js";

const PLACEHOLDERS = new Set(["", "replace-with-a-local-password", "changeme", "password"]);

async function main() {
  const password = process.env.ECC_DEMO_PASSWORD ?? "";
  if (PLACEHOLDERS.has(password) || password.length < 10) {
    console.error("Set ECC_DEMO_PASSWORD to a local password of at least 10 characters. Do not commit it.");
    process.exit(1);
  }
  await ensureAuthSchema();
  const passwordHash = await hashPassword(password);

  for (const persona of PERSONAS) {
    const found = await query<{ account_id: string }>(
      `SELECT account_id FROM auth_accounts WHERE lower(email) = lower($1)`,
      [persona.email],
    );
    let accountId = found.rows[0]?.account_id;
    if (accountId) {
      await query(
        `UPDATE auth_accounts
         SET password_hash = $2, first_name = $3, last_name = $4
         WHERE account_id = $1`,
        [accountId, passwordHash, persona.firstName, persona.lastName],
      );
    } else {
      const inserted = await query<{ account_id: string }>(
        `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
         VALUES ($1, $2, $3, $4)
         RETURNING account_id`,
        [persona.email, passwordHash, persona.firstName, persona.lastName],
      );
      accountId = inserted.rows[0].account_id;
    }
    await query(
      `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (account_id, org_id)
       DO UPDATE SET user_id = EXCLUDED.user_id, role_code = EXCLUDED.role_code, status = 'active'`,
      [accountId, persona.orgId, persona.userId, persona.role],
    );
  }

  const layla = PERSONAS.find((p) => p.email === "layla.hashimi@aldhabi.demo");
  if (layla) {
    const { rows } = await query<{ account_id: string }>(
      `SELECT account_id FROM auth_accounts WHERE lower(email) = lower($1)`,
      [layla.email],
    );
    if (rows[0]) {
      await query(
        `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
         VALUES ($1, $2, $3, 'ciso', 'active')
         ON CONFLICT (account_id, org_id)
         DO UPDATE SET role_code = 'ciso', status = 'active'`,
        [rows[0].account_id, TENANT_B_ORG_ID, layla.userId],
      );
    }
  }

  console.log(`Hashed demo passwords for ${PERSONAS.length} personas. Layla can switch to Falcon National Bank.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
