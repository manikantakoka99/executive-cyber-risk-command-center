/**
 * Local-only demo passwords.
 *
 * Prefer ECC_DEMO_LOGINS_FILE: a gitignored CSV of `email,password` lines,
 * one per role login (see logins.example.csv). ECC_DEMO_PASSWORD is the
 * fallback when that file is unset, and applies to every role login.
 * The script hashes with bcrypt and never prints a password. A seeded login
 * with no file entry fails. Placeholder passwords are refused.
 *
 *   ECC_DEMO_LOGINS_FILE=../logins.csv npm run auth:seed
 *
 * Layla (layla@ciso.com) is also a CISO member of Falcon National Bank.
 * The role domains are public, so the app does not send mail to them.
 */
import { readFileSync } from "node:fs";
import { query, pool } from "../src/db.js";
import { roleLogins, TENANT_B_ORG_ID } from "../src/command/personas.js";
import { passwordsForDemoLogins } from "../src/auth/demoLogins.js";
import { hashPassword } from "../src/auth/passwords.js";
import { ensureAuthSchema } from "../src/auth/schema.js";

async function main() {
  const file = process.env.ECC_DEMO_LOGINS_FILE?.trim() ?? "";
  let fileText: string | null = null;
  if (file) {
    try {
      fileText = readFileSync(file, "utf8");
    } catch {
      console.error(`Cannot read ECC_DEMO_LOGINS_FILE (${file}).`);
      process.exit(1);
    }
  }
  const logins = roleLogins();
  let passwords: Map<string, string>;
  try {
    passwords = passwordsForDemoLogins({
      emails: logins.map((login) => login.email),
      fileText,
      fallbackPassword: process.env.ECC_DEMO_PASSWORD ?? null,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  await ensureAuthSchema();
  for (const persona of logins) {
    const password = passwords.get(persona.email.toLowerCase());
    if (!password) {
      console.error(`No password entry for ${persona.email}.`);
      process.exit(1);
    }
    const passwordHash = await hashPassword(password);
    const updated = await query(
      `UPDATE users SET email = $2, first_name = $3, last_name = $4 WHERE user_id = $1`,
      [persona.userId, persona.email, persona.firstName, persona.lastName],
    );
    if (updated.rowCount === 0) {
      await query(
        `INSERT INTO users (user_id, org_id, first_name, last_name, email)
         VALUES ($1, $2, $3, $4, $5)`,
        [persona.userId, persona.orgId, persona.firstName, persona.lastName, persona.email],
      );
    }
    await query(
      `INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
       SELECT $1, r.role_id, $2, true
       FROM roles r
       WHERE r.code = $3
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = $1 AND ur.is_primary = true
         )
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [persona.userId, persona.orgId, persona.role],
    );
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

  const layla = logins.find((login) => login.email === "layla@ciso.com");
  if (!layla) {
    console.error("No password entry for layla@ciso.com.");
    process.exit(1);
  }
  const { rows } = await query<{ account_id: string }>(
    `SELECT account_id FROM auth_accounts WHERE lower(email) = lower($1)`,
    [layla.email],
  );
  if (!rows[0]) {
    console.error("No password entry for layla@ciso.com.");
    process.exit(1);
  }
  await query(
    `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
     VALUES ($1, $2, $3, 'ciso', 'active')
     ON CONFLICT (account_id, org_id)
     DO UPDATE SET role_code = 'ciso', status = 'active'`,
    [rows[0].account_id, TENANT_B_ORG_ID, layla.userId],
  );

  console.log(`Hashed demo passwords for ${logins.length} role logins. Layla can switch to Falcon National Bank.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
