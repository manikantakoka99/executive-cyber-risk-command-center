import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { app } from "../index.js";
import { query } from "../db.js";
import { ensureAuthSchema } from "./schema.js";
import { hashPassword } from "./passwords.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FAL = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";
const PASSWORD = "isolation-test-password";
const EMAIL_A = "isolation-a@ecc.test";
const EMAIL_B = "isolation-b@ecc.test";
const EMAIL_CXO = "isolation-cxo@ecc.test";

function cookieFrom(raw: string | string[] | undefined): string {
  const line = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(line, "session cookie");
  return line.split(";")[0];
}

async function roleId(code: string): Promise<string> {
  const { rows } = await query<{ role_id: string }>(`SELECT role_id FROM roles WHERE code = $1`, [code]);
  assert.ok(rows[0], code);
  return rows[0].role_id;
}

describe("session tenant isolation", () => {
  const ids: string[] = [];
  let findingB = "";
  let decisionB = "";
  let statusB = "";
  let findingA = "";
  let cookieA = "";
  let cookieCxO = "";
  const previousDemo = process.env.DEMO_AUTH;

  before(async () => {
    await ensureAuthSchema();
    const ciso = await roleId("ciso");
    const passwordHash = await hashPassword(PASSWORD);
    for (const [email, orgId] of [
      [EMAIL_A, AL],
      [EMAIL_B, FAL],
    ] as const) {
      const user = await query<{ user_id: string }>(
        `INSERT INTO users (org_id, first_name, last_name, email)
         VALUES ($1, 'Iso', $2, $3)
         RETURNING user_id`,
        [orgId, email, email],
      );
      const userId = user.rows[0].user_id;
      ids.push(userId);
      await query(
        `INSERT INTO user_roles (user_id, role_id, org_id, is_primary) VALUES ($1, $2, $3, true)`,
        [userId, ciso, orgId],
      );
      const account = await query<{ account_id: string }>(
        `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
         VALUES ($1, $2, 'Iso', $3)
         RETURNING account_id`,
        [email, passwordHash, email],
      );
      await query(
        `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
         VALUES ($1, $2, $3, 'ciso', 'active')`,
        [account.rows[0].account_id, orgId, userId],
      );
    }
    const falconFinding = await query<{ finding_id: string }>(
      `SELECT finding_id FROM risk_findings WHERE org_id = $1 LIMIT 1`,
      [FAL],
    );
    const alFinding = await query<{ finding_id: string }>(
      `SELECT finding_id FROM risk_findings WHERE org_id = $1 LIMIT 1`,
      [AL],
    );
    const falconDecision = await query<{ decision_id: string; status: string }>(
      `SELECT decision_id, status FROM executive_decisions WHERE org_id = $1 LIMIT 1`,
      [FAL],
    );
    findingB = falconFinding.rows[0]?.finding_id ?? "";
    findingA = alFinding.rows[0]?.finding_id ?? "";
    decisionB = falconDecision.rows[0]?.decision_id ?? "";
    statusB = falconDecision.rows[0]?.status ?? "";
    assert.ok(findingB && findingA && decisionB, "demo tenants have findings and a decision");
    const login = await app.inject({
      method: "POST",
      url: "/api/ecc/auth/login",
      payload: { email: EMAIL_A, password: PASSWORD },
    });
    assert.equal(login.statusCode, 200);
    cookieA = cookieFrom(login.headers["set-cookie"]);

    // Decision approve is limited to CxO at the route. That role is the one
    // that must still be unable to write another org's row.
    const cxoRole = await roleId("cxo");
    const cxoUser = await query<{ user_id: string }>(
      `INSERT INTO users (org_id, first_name, last_name, email)
       VALUES ($1, 'Iso', 'CxO', $2)
       RETURNING user_id`,
      [AL, EMAIL_CXO],
    );
    const cxoId = cxoUser.rows[0].user_id;
    ids.push(cxoId);
    await query(
      `INSERT INTO user_roles (user_id, role_id, org_id, is_primary) VALUES ($1, $2, $3, true)`,
      [cxoId, cxoRole, AL],
    );
    const cxoAccount = await query<{ account_id: string }>(
      `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
       VALUES ($1, $2, 'Iso', 'CxO')
       RETURNING account_id`,
      [EMAIL_CXO, passwordHash],
    );
    await query(
      `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
       VALUES ($1, $2, $3, 'cxo', 'active')`,
      [cxoAccount.rows[0].account_id, AL, cxoId],
    );
    const cxoLogin = await app.inject({
      method: "POST",
      url: "/api/ecc/auth/login",
      payload: { email: EMAIL_CXO, password: PASSWORD },
    });
    assert.equal(cxoLogin.statusCode, 200);
    cookieCxO = cookieFrom(cxoLogin.headers["set-cookie"]);
  });

  after(async () => {
    process.env.DEMO_AUTH = previousDemo;
    if (!ids.length) return;
    await query(`DELETE FROM org_invites WHERE lower(email) IN (lower($1), lower($2), lower($3))`, [
      EMAIL_A,
      EMAIL_B,
      EMAIL_CXO,
    ]);
    await query(`DELETE FROM auth_accounts WHERE lower(email) IN (lower($1), lower($2), lower($3))`, [
      EMAIL_A,
      EMAIL_B,
      EMAIL_CXO,
    ]);
    await query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [ids]);
  });

  it("does not let org A read or write org B rows by guessed id", async () => {
    const read = await app.inject({
      method: "GET",
      url: `/api/ecc/findings/${findingB}`,
      headers: { cookie: cookieA, "x-org-id": FAL, "x-user-id": ids[1] },
    });
    assert.equal(read.statusCode, 404);

    const write = await app.inject({
      method: "POST",
      url: `/api/ecc/decisions/${decisionB}/approve`,
      headers: { cookie: cookieCxO, "x-org-id": FAL, "x-user-id": ids[1] },
      payload: { notes: "cross-tenant attempt" },
    });
    assert.equal(write.statusCode, 404);
    const { rows } = await query<{ status: string }>(
      `SELECT status FROM executive_decisions WHERE decision_id = $1 AND org_id = $2`,
      [decisionB, FAL],
    );
    assert.equal(rows[0].status, statusB);
  });

  it("refuses an org switch without membership, then allows one that exists", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/ecc/auth/switch-org",
      headers: { cookie: cookieA },
      payload: { orgId: FAL },
    });
    assert.equal(denied.statusCode, 403);

    const { rows } = await query<{ account_id: string }>(
      `SELECT account_id FROM auth_accounts WHERE lower(email) = lower($1)`,
      [EMAIL_A],
    );
    await query(
      `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
       VALUES ($1, $2, $3, 'ciso', 'active')`,
      [rows[0].account_id, FAL, ids[0]],
    );
    const allowed = await app.inject({
      method: "POST",
      url: "/api/ecc/auth/switch-org",
      headers: { cookie: cookieA },
      payload: { orgId: FAL },
    });
    assert.equal(allowed.statusCode, 200);
    const body = allowed.json() as { user: { orgId: string; memberships: { orgId: string }[] } };
    assert.equal(body.user.orgId, FAL);
    assert.equal(body.user.memberships.length, 2);

    const back = await app.inject({
      method: "GET",
      url: `/api/ecc/findings/${findingA}`,
      headers: { cookie: cookieA, "x-org-id": AL, "x-user-id": ids[0] },
    });
    assert.equal(back.statusCode, 404);

    await query(`DELETE FROM org_memberships WHERE account_id = $1 AND org_id = $2`, [
      rows[0].account_id,
      FAL,
    ]);
    await query(`UPDATE auth_sessions SET org_id = $2, user_id = $3 WHERE user_id = $1`, [
      ids[0],
      AL,
      ids[0],
    ]);
  });

  it("rejects header impersonation when DEMO_AUTH is false", async () => {
    process.env.DEMO_AUTH = "false";
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/ecc/me",
        headers: { "x-org-id": AL, "x-user-id": ids[0] },
      });
      assert.equal(res.statusCode, 401);
    } finally {
      process.env.DEMO_AUTH = previousDemo;
    }
  });

  it("invite acceptance is single use and does not open public signup", async () => {
    const open = await app.inject({
      method: "POST",
      url: "/api/ecc/auth/signup",
      payload: { email: "anyone@ecc.test", password: PASSWORD },
    });
    assert.equal(open.statusCode, 404);

    const adminRole = await roleId("admin");
    const adminUser = await query<{ user_id: string }>(
      `INSERT INTO users (org_id, first_name, last_name, email)
       VALUES ($1, 'Iso', 'Admin', 'isolation-admin@ecc.test')
       RETURNING user_id`,
      [AL],
    );
    const adminId = adminUser.rows[0].user_id;
    ids.push(adminId);
    await query(
      `INSERT INTO user_roles (user_id, role_id, org_id, is_primary) VALUES ($1, $2, $3, true)`,
      [adminId, adminRole, AL],
    );
    const adminAccount = await query<{ account_id: string }>(
      `INSERT INTO auth_accounts (email, password_hash, first_name)
       VALUES ('isolation-admin@ecc.test', $1, 'Iso')
       RETURNING account_id`,
      [await hashPassword(PASSWORD)],
    );
    await query(
      `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
       VALUES ($1, $2, $3, 'admin', 'active')`,
      [adminAccount.rows[0].account_id, AL, adminId],
    );
    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/ecc/auth/login",
      payload: { email: "isolation-admin@ecc.test", password: PASSWORD },
    });
    assert.equal(adminLogin.statusCode, 200);
    const adminCookie = cookieFrom(adminLogin.headers["set-cookie"]);
    const invite = await app.inject({
      method: "POST",
      url: "/api/ecc/admin/invites",
      headers: { cookie: adminCookie },
      payload: { email: "invited-person@ecc.test", role: "auditor" },
    });
    assert.equal(invite.statusCode, 200);
    const invitePath = (invite.json() as { invitePath: string }).invitePath;
    const token = invitePath.split("/").pop() ?? "";
    const preview = await app.inject({ method: "GET", url: `/api/ecc/auth/invite/${token}` });
    assert.equal(preview.statusCode, 200);
    const previewBody = preview.json() as { email: string; orgName: string; role: string };
    assert.equal(previewBody.email, "invited-person@ecc.test");
    assert.equal(previewBody.role, "auditor");
    assert.ok(previewBody.orgName);

    const analyst = await app.inject({
      method: "POST",
      url: "/api/ecc/admin/invites",
      headers: { cookie: cookieA },
      payload: { email: "other@ecc.test", role: "auditor" },
    });
    assert.equal(analyst.statusCode, 403);

    const accept = await app.inject({
      method: "POST",
      url: `/api/ecc/auth/invite/${token}`,
      payload: { password: PASSWORD },
    });
    assert.equal(accept.statusCode, 200);
    const again = await app.inject({
      method: "POST",
      url: `/api/ecc/auth/invite/${token}`,
      payload: { password: PASSWORD },
    });
    assert.equal(again.statusCode, 400);
    const { rows } = await query<{ password_hash: string }>(
      `SELECT password_hash FROM auth_accounts WHERE lower(email) = 'invited-person@ecc.test'`,
    );
    assert.ok(rows[0]);
    assert.equal(rows[0].password_hash.includes(PASSWORD), false);

    await query(`DELETE FROM auth_accounts WHERE lower(email) IN ('invited-person@ecc.test', 'isolation-admin@ecc.test')`);
    await query(`DELETE FROM users WHERE email IN ('invited-person@ecc.test', 'isolation-admin@ecc.test')`);
  });
});
