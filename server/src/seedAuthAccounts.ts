/**
 * One-shot script: seed auth_accounts + org_memberships for all demo personas.
 * Run with: npx tsx src/seedAuthAccounts.ts
 *
 * Credentials are taken directly from logins.csv in the project root.
 * Safe to re-run — uses UPSERT everywhere.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, pool } from "./db.js";
import { hashPassword } from "./auth/passwords.js";
import { roleLogins, DEMO_ORG_ID } from "./command/personas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse logins.csv  → Map<email, password>
const csvPath = path.resolve(__dirname, "../../logins.csv");
const csvLines = readFileSync(csvPath, "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim());
const creds = new Map<string, string>();
for (const line of csvLines) {
  const [email, password] = line.split(",");
  if (email && password) creds.set(email.trim().toLowerCase(), password.trim());
}

console.log(`Loaded ${creds.size} credential(s) from logins.csv`);

for (const persona of roleLogins()) {
  const email = persona.email.toLowerCase();
  const password = creds.get(email);
  if (!password) {
    console.warn(`  ⚠ No password found for ${email} — skipping`);
    continue;
  }

  const passwordHash = await hashPassword(password);

  // Upsert user row
  const updated = await query(
    `UPDATE users SET first_name = $2, last_name = $3, email = $4
     WHERE user_id = $1`,
    [persona.userId, persona.firstName, persona.lastName, persona.email],
  );
  if (updated.rowCount === 0) {
    await query(
      `INSERT INTO users (user_id, org_id, first_name, last_name, email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [persona.userId, persona.orgId, persona.firstName, persona.lastName, persona.email],
    );
  }

  // Upsert user_roles
  await query(
    `INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
     SELECT $1, r.role_id, $2, true FROM roles r WHERE r.code = $3
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [persona.userId, persona.orgId, persona.role],
  );

  // Upsert auth_account
  const found = await query<{ account_id: string }>(
    `SELECT account_id FROM auth_accounts WHERE lower(email) = $1`,
    [email],
  );
  let accountId = found.rows[0]?.account_id;
  if (accountId) {
    await query(
      `UPDATE auth_accounts SET password_hash = $2 WHERE account_id = $1`,
      [accountId, passwordHash],
    );
    console.log(`  ↻ Updated account for ${email}`);
  } else {
    const ins = await query<{ account_id: string }>(
      `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4) RETURNING account_id`,
      [email, passwordHash, persona.firstName, persona.lastName ?? ""],
    );
    accountId = ins.rows[0].account_id;
    console.log(`  ✔ Created account for ${email}`);
  }

  // Upsert org_membership
  await query(
    `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (account_id, org_id)
     DO UPDATE SET user_id = EXCLUDED.user_id, role_code = EXCLUDED.role_code, status = 'active'`,
    [accountId, persona.orgId, persona.userId, persona.role],
  );

  // Give layla (CISO) membership in both orgs for cross-tenant demo
  if (email === "layla@ciso.com") {
    const TENANT_B_ORG_ID = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";
    await query(
      `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
       VALUES ($1, $2, $3, 'ciso', 'active')
       ON CONFLICT (account_id, org_id)
       DO UPDATE SET role_code = 'ciso', status = 'active'`,
      [accountId, TENANT_B_ORG_ID, persona.userId],
    );
  }
}

console.log("\n✅ Auth accounts seeded successfully.");
console.log("You can now log in at http://localhost:5173");
console.log("\nCredentials:");
for (const [email, pass] of creds) {
  console.log(`  ${email.padEnd(35)} ${pass}`);
}

await pool.end();
