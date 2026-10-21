import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { app } from "../index.js";
import { query } from "../db.js";
import { ensureAuthSchema } from "./schema.js";
import { hashPassword } from "./passwords.js";
import { resetLoginThrottle } from "./loginThrottle.js";
import { homeFor } from "../command/rbac.js";
import { roleLogins, TENANT_B_ORG_ID } from "../command/personas.js";

const PASSWORD = "role-login-test-password";

function cookieFrom(raw: string | string[] | undefined): string {
  const line = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(line, "session cookie");
  return line.split(";")[0];
}

describe("role domain logins", () => {
  before(async () => {
    await ensureAuthSchema();
    resetLoginThrottle();
    const passwordHash = await hashPassword(PASSWORD);
    for (const persona of roleLogins()) {
      const updated = await query(`UPDATE users SET email = $2, first_name = $3, last_name = $4 WHERE user_id = $1`, [
        persona.userId,
        persona.email,
        persona.firstName,
        persona.lastName,
      ]);
      if (updated.rowCount === 0) {
        await query(
          `INSERT INTO users (user_id, org_id, first_name, last_name, email) VALUES ($1, $2, $3, $4, $5)`,
          [persona.userId, persona.orgId, persona.firstName, persona.lastName, persona.email],
        );
      }
      await query(
        `INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
         SELECT $1, r.role_id, $2, true FROM roles r WHERE r.code = $3
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [persona.userId, persona.orgId, persona.role],
      );
      const found = await query<{ account_id: string }>(
        `SELECT account_id FROM auth_accounts WHERE lower(email) = lower($1)`,
        [persona.email],
      );
      let accountId = found.rows[0]?.account_id;
      if (accountId) {
        await query(`UPDATE auth_accounts SET password_hash = $2 WHERE account_id = $1`, [accountId, passwordHash]);
      } else {
        const inserted = await query<{ account_id: string }>(
          `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
           VALUES ($1, $2, $3, $4) RETURNING account_id`,
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
      if (persona.email === "layla@ciso.com") {
        await query(
          `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
           VALUES ($1, $2, $3, 'ciso', 'active')
           ON CONFLICT (account_id, org_id)
           DO UPDATE SET role_code = 'ciso', status = 'active'`,
          [accountId, TENANT_B_ORG_ID, persona.userId],
        );
      }
    }
  });

  after(() => {
    resetLoginThrottle();
  });

  for (const persona of roleLogins()) {
    it(`logs ${persona.email} into ${homeFor(persona.role)} and rejects a wrong password`, async () => {
      const wrong = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        payload: { email: persona.email, password: "not-the-password" },
      });
      assert.equal(wrong.statusCode, 401);

      const login = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        payload: { email: persona.email, password: PASSWORD },
      });
      assert.equal(login.statusCode, 200);
      const body = login.json() as { user: { role: string; email: string; home: string; orgId: string; memberships: { orgId: string }[] } };
      assert.equal(body.user.email, persona.email);
      assert.equal(body.user.role, persona.role);
      assert.equal(body.user.orgId, persona.orgId);
      assert.equal(body.user.home, homeFor(persona.role));

      const me = await app.inject({
        method: "GET",
        url: "/api/ecc/me",
        headers: { cookie: cookieFrom(login.headers["set-cookie"]) },
      });
      assert.equal(me.statusCode, 200);
      const session = me.json() as { user: { home: string; role: string; memberships: { orgId: string }[] } };
      assert.equal(session.user.role, persona.role);
      assert.equal(session.user.home, homeFor(persona.role));
      if (persona.email === "layla@ciso.com") {
        const orgs = session.user.memberships.map((membership) => membership.orgId).sort();
        assert.deepEqual(orgs, [persona.orgId, TENANT_B_ORG_ID].sort());
      }
    });
  }
});
