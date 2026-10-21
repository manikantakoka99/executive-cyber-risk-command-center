import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { app } from "../index.js";
import { query } from "../db.js";
import { ensureAuthSchema } from "../auth/schema.js";
import { hashPassword } from "../auth/passwords.js";
import { resetLoginThrottle } from "../auth/loginThrottle.js";
import { personasForOrg, TENANT_B_ORG_ID } from "./personas.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FAL = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";
const PASSWORD = "directory-test-password";
const EMAIL_ADMIN = "dir-admin@ecc.test";
const EMAIL_CISO = "dir-ciso@ecc.test";

function cookieFrom(raw: string | string[] | undefined): string {
  const line = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(line, "session cookie");
  assert.match(line, /HttpOnly/);
  assert.match(line, /SameSite=Lax/);
  return line.split(";")[0];
}

async function roleId(code: string): Promise<string> {
  const { rows } = await query<{ role_id: string }>(`SELECT role_id FROM roles WHERE code = $1`, [code]);
  assert.ok(rows[0], code);
  return rows[0].role_id;
}

describe("organization directory", () => {
  const ids: string[] = [];
  let adminCookie = "";
  let cisoCookie = "";
  const previousDemo = process.env.DEMO_AUTH;

  before(async () => {
    await ensureAuthSchema();
    const passwordHash = await hashPassword(PASSWORD);
    for (const [email, role] of [
      [EMAIL_ADMIN, "admin"],
      [EMAIL_CISO, "ciso"],
    ] as const) {
      const user = await query<{ user_id: string }>(
        `INSERT INTO users (org_id, first_name, last_name, email)
         VALUES ($1, 'Dir', $2, $3)
         RETURNING user_id`,
        [AL, role, email],
      );
      const userId = user.rows[0].user_id;
      ids.push(userId);
      await query(
        `INSERT INTO user_roles (user_id, role_id, org_id, is_primary) VALUES ($1, $2, $3, true)`,
        [userId, await roleId(role), AL],
      );
      const account = await query<{ account_id: string }>(
        `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
         VALUES ($1, $2, 'Dir', $3)
         RETURNING account_id`,
        [email, passwordHash, role],
      );
      await query(
        `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [account.rows[0].account_id, AL, userId, role],
      );
      const login = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        payload: { email, password: PASSWORD },
      });
      assert.equal(login.statusCode, 200);
      const cookie = cookieFrom(login.headers["set-cookie"]);
      if (role === "admin") adminCookie = cookie;
      else cisoCookie = cookie;
    }
  });

  after(async () => {
    process.env.DEMO_AUTH = previousDemo;
    resetLoginThrottle();
    if (!ids.length) return;
    await query(`DELETE FROM auth_accounts WHERE lower(email) IN (lower($1), lower($2))`, [
      EMAIL_ADMIN,
      EMAIL_CISO,
    ]);
    await query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [ids]);
  });

  it("requires a session for the organization directory", async () => {
    const anon = await app.inject({ method: "GET", url: "/api/ecc/organizations" });
    assert.equal(anon.statusCode, 401);
    const anonUsers = await app.inject({ method: "GET", url: `/api/ecc/organizations/${FAL}/users` });
    assert.equal(anonUsers.statusCode, 401);

    process.env.DEMO_AUTH = "false";
    try {
      const denied = await app.inject({
        method: "GET",
        url: "/api/ecc/organizations",
        headers: { "x-org-id": AL, "x-user-id": ids[0] },
      });
      assert.equal(denied.statusCode, 401);
    } finally {
      process.env.DEMO_AUTH = previousDemo;
    }
  });

  it("returns only orgs the signed-in user belongs to", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ecc/organizations",
      headers: { cookie: adminCookie, "x-org-id": FAL, "x-user-id": ids[1] },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { organizations: { orgId: string; name: string }[] };
    assert.deepEqual(
      body.organizations.map((org) => org.orgId),
      [AL],
    );
    assert.equal(body.organizations.some((org) => org.orgId === FAL), false);
  });

  it("lets an admin read only the session org and hides the other org", async () => {
    const own = await app.inject({
      method: "GET",
      url: `/api/ecc/organizations/${AL}/users`,
      headers: { cookie: adminCookie },
    });
    assert.equal(own.statusCode, 200);
    const users = (own.json() as { users: { orgId: string; email: string }[] }).users;
    assert.ok(users.some((user) => user.email === EMAIL_ADMIN));
    assert.ok(users.every((user) => user.orgId === AL));
    const falconEmails = new Set(personasForOrg(TENANT_B_ORG_ID).map((persona) => persona.email));
    assert.equal(users.some((user) => falconEmails.has(user.email)), false);

    const other = await app.inject({
      method: "GET",
      url: `/api/ecc/organizations/${FAL}/users`,
      headers: { cookie: adminCookie, "x-org-id": FAL, "x-user-id": ids[1] },
    });
    assert.equal(other.statusCode, 404);
  });

  it("does not let a user in org A read org B users", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/ecc/organizations/${FAL}/users`,
      headers: { cookie: cisoCookie, "x-org-id": FAL },
    });
    assert.equal(res.statusCode, 403);
  });

  it("throttles repeated sign-in attempts for one email", async () => {
    await withThrottle("2", "20", async () => {
      for (let i = 0; i < 2; i += 1) {
        const attempt = await loginAs("throttle-one@ecc.test", "not-the-password");
        assert.equal(attempt.statusCode, 401);
      }
      const blocked = await loginAs("throttle-one@ecc.test", "not-the-password");
      assert.equal(blocked.statusCode, 429);
      assert.match(String(blocked.headers["retry-after"] ?? ""), /^[1-9]/);
      const other = await loginAs("throttle-two@ecc.test", "not-the-password");
      assert.equal(other.statusCode, 401);
    });
  });

  it("lets twenty successful sign-ins through in one window", async () => {
    await withThrottle("8", "30", async () => {
      for (let i = 0; i < 20; i += 1) {
        const attempt = await loginAs(EMAIL_ADMIN, PASSWORD);
        assert.equal(attempt.statusCode, 200);
      }
    });
  });

  it("returns 429 after eight failures and does not clear that block with the right password", async () => {
    await withThrottle("8", "30", async () => {
      for (let i = 0; i < 8; i += 1) {
        const attempt = await loginAs(EMAIL_ADMIN, "not-the-password");
        assert.equal(attempt.statusCode, 401);
      }
      const blocked = await loginAs(EMAIL_ADMIN, PASSWORD);
      assert.equal(blocked.statusCode, 429);
      const still = await loginAs(EMAIL_ADMIN, "not-the-password");
      assert.equal(still.statusCode, 429);
    });
  });

  it("resets the email failure count after a successful sign-in", async () => {
    await withThrottle("8", "30", async () => {
      for (let i = 0; i < 3; i += 1) {
        assert.equal((await loginAs(EMAIL_CISO, "not-the-password")).statusCode, 401);
      }
      assert.equal((await loginAs(EMAIL_CISO, PASSWORD)).statusCode, 200);
      for (let i = 0; i < 8; i += 1) {
        assert.equal((await loginAs(EMAIL_CISO, "not-the-password")).statusCode, 401);
      }
      assert.equal((await loginAs(EMAIL_CISO, "not-the-password")).statusCode, 429);
    });
  });

  it("does not lock a second email before the per-IP failure limit", async () => {
    await withThrottle("8", "30", async () => {
      for (let i = 0; i < 8; i += 1) {
        assert.equal((await loginAs("throttle-a@ecc.test", "not-the-password")).statusCode, 401);
      }
      assert.equal((await loginAs("throttle-a@ecc.test", "not-the-password")).statusCode, 429);
      assert.equal((await loginAs("throttle-b@ecc.test", "not-the-password")).statusCode, 401);
    });
  });

  it("uses X-Forwarded-For for the login IP only when TRUST_PROXY is on", async () => {
    const previousProxy = process.env.TRUST_PROXY;
    try {
      delete process.env.TRUST_PROXY;
      await withThrottle("10", "2", async () => {
        assert.equal((await loginAs("xff-a@ecc.test", "not-the-password", "203.0.113.1")).statusCode, 401);
        assert.equal((await loginAs("xff-b@ecc.test", "not-the-password", "203.0.113.2")).statusCode, 401);
        assert.equal((await loginAs("xff-c@ecc.test", "not-the-password", "203.0.113.3")).statusCode, 429);
      });
      process.env.TRUST_PROXY = "1";
      await withThrottle("10", "2", async () => {
        assert.equal((await loginAs("xff-a@ecc.test", "not-the-password", "203.0.113.1")).statusCode, 401);
        assert.equal((await loginAs("xff-b@ecc.test", "not-the-password", "203.0.113.2")).statusCode, 401);
        assert.equal((await loginAs("xff-c@ecc.test", "not-the-password", "203.0.113.3")).statusCode, 401);
      });
      await withThrottle("10", "2", async () => {
        assert.equal(
          (await loginAs("xff-spoof-a@ecc.test", "not-the-password", "203.0.113.9, 198.51.100.20")).statusCode,
          401,
        );
        assert.equal(
          (await loginAs("xff-spoof-b@ecc.test", "not-the-password", "198.51.100.99, 198.51.100.20")).statusCode,
          401,
        );
        assert.equal(
          (await loginAs("xff-spoof-c@ecc.test", "not-the-password", "203.0.113.1, 198.51.100.20")).statusCode,
          429,
        );
        assert.equal(
          (await loginAs("xff-spoof-d@ecc.test", "not-the-password", "203.0.113.9, 198.51.100.21")).statusCode,
          401,
        );
      });
    } finally {
      if (previousProxy === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previousProxy;
      resetLoginThrottle();
    }
  });
});

function loginAs(email: string, password: string, forwardedFor?: string) {
  return app.inject({
    method: "POST",
    url: "/api/ecc/auth/login",
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
    payload: { email, password },
  });
}

async function withThrottle(emailLimit: string, ipLimit: string, run: () => Promise<void>) {
  const previousEmail = process.env.LOGIN_THROTTLE_EMAIL;
  const previousIp = process.env.LOGIN_THROTTLE_IP;
  process.env.LOGIN_THROTTLE_EMAIL = emailLimit;
  process.env.LOGIN_THROTTLE_IP = ipLimit;
  resetLoginThrottle();
  try {
    await run();
  } finally {
    resetLoginThrottle();
    if (previousEmail === undefined) delete process.env.LOGIN_THROTTLE_EMAIL;
    else process.env.LOGIN_THROTTLE_EMAIL = previousEmail;
    if (previousIp === undefined) delete process.env.LOGIN_THROTTLE_IP;
    else process.env.LOGIN_THROTTLE_IP = previousIp;
  }
}
