import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { app } from "../index.js";
import { query } from "../db.js";
import { ensureAuthSchema } from "../auth/schema.js";
import { hashPassword } from "../auth/passwords.js";
import { NIST_CATEGORIES, emptyNist, scoreNist, type DomainEvidence } from "./nistCsf.js";

const PASSWORD = "nist-isolation-password";
const EMAIL_A = "nist-own-a@ecc.test";
const EMAIL_B = "nist-own-b@ecc.test";
const EMAIL_C = "nist-own-c@ecc.test";
const CONNECTOR = "nist-isolation-own";
const SIGNAL = "nist-isolation-own-expired";

function cookieFrom(raw: string | string[] | undefined): string {
  const line = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(line, "session cookie");
  return line.split(";")[0];
}

function nistPct(body: { nist?: { coveragePct?: number | null; empty?: boolean }; frameworks?: { code?: string; coveragePct?: number | null }[] }) {
  const row = body.frameworks?.find((framework) => framework.code === "nist_csf_2");
  assert.equal(row?.coveragePct ?? null, body.nist?.coveragePct ?? null);
  return body.nist?.coveragePct ?? null;
}

describe("NIST compliance is scoped to the session org", () => {
  const orgs: string[] = [];
  let cookieA = "";
  let cookieB = "";
  let cookieC = "";
  let userB = "";
  let expectedA = 0;
  let expectedB = 0;

  before(async () => {
    await ensureAuthSchema();
    await query(`DELETE FROM auth_accounts WHERE lower(email) IN (lower($1), lower($2), lower($3))`, [
      EMAIL_A,
      EMAIL_B,
      EMAIL_C,
    ]);
    await query(`DELETE FROM organizations WHERE name LIKE 'NIST Isolation %'`);

    const { rows: roles } = await query<{ role_id: string }>(
      `SELECT role_id FROM roles WHERE code = 'ciso'`,
    );
    const ciso = roles[0]?.role_id;
    assert.ok(ciso, "ciso role");
    const passwordHash = await hashPassword(PASSWORD);
    const codes = [...new Set(NIST_CATEGORIES.flatMap((category) => category.domains))];
    const fresh: DomainEvidence = { fresh: 1, total: 1, evidenceExpired: false };
    const expired: DomainEvidence = { fresh: 1, total: 1, evidenceExpired: true };
    expectedA = scoreNist(Object.fromEntries(codes.map((code) => [code, fresh]))).coveragePct;
    expectedB = scoreNist(Object.fromEntries(codes.map((code) => [code, expired]))).coveragePct;
    assert.notEqual(expectedA, expectedB);

    for (const [email, name] of [
      [EMAIL_A, "NIST Isolation A"],
      [EMAIL_B, "NIST Isolation B"],
      [EMAIL_C, "NIST Isolation C"],
    ] as const) {
      const org = await query<{ org_id: string }>(
        `INSERT INTO organizations (name, industry) VALUES ($1, 'Test') RETURNING org_id`,
        [name],
      );
      const orgId = org.rows[0]!.org_id;
      orgs.push(orgId);
      const user = await query<{ user_id: string }>(
        `INSERT INTO users (org_id, first_name, last_name, email)
         VALUES ($1, 'Nist', $2, $3)
         RETURNING user_id`,
        [orgId, email, email],
      );
      const userId = user.rows[0]!.user_id;
      if (email === EMAIL_B) userB = userId;
      await query(
        `INSERT INTO user_roles (user_id, role_id, org_id, is_primary) VALUES ($1, $2, $3, true)`,
        [userId, ciso, orgId],
      );
      const account = await query<{ account_id: string }>(
        `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
         VALUES ($1, $2, 'Nist', $3)
         RETURNING account_id`,
        [email, passwordHash, email],
      );
      await query(
        `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
         VALUES ($1, $2, $3, 'ciso', 'active')`,
        [account.rows[0]!.account_id, orgId, userId],
      );
    }

    const [orgA, orgB] = orgs;
    for (const code of codes) {
      await query(
        `INSERT INTO connectors (org_id, risk_domain_id, name, connector_type, status, last_sync_at)
         SELECT $1, risk_domain_id, $2, 'api', 'active', now()
         FROM risk_domains WHERE code = $3`,
        [orgA, CONNECTOR, code],
      );
      await query(
        `INSERT INTO connectors (org_id, risk_domain_id, name, connector_type, status, last_sync_at)
         SELECT $1, risk_domain_id, $2, 'api', 'active', now()
         FROM risk_domains WHERE code = $3`,
        [orgB, CONNECTOR, code],
      );
    }
    await query(
      `INSERT INTO security_signals (org_id, risk_domain_id, event_type, observed_at, title, lifecycle_status)
       SELECT $1, risk_domain_id, 'evidence_expired', now(), $2, 'received'
       FROM risk_domains
       WHERE code::text = ANY($3::text[])`,
      [orgB, SIGNAL, codes],
    );

    for (const [email, slot] of [
      [EMAIL_A, "A"],
      [EMAIL_B, "B"],
      [EMAIL_C, "C"],
    ] as const) {
      const login = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        payload: { email, password: PASSWORD },
      });
      assert.equal(login.statusCode, 200, email);
      const cookie = cookieFrom(login.headers["set-cookie"]);
      if (slot === "A") cookieA = cookie;
      if (slot === "B") cookieB = cookie;
      if (slot === "C") cookieC = cookie;
    }
  });

  after(async () => {
    await query(`DELETE FROM auth_accounts WHERE lower(email) IN (lower($1), lower($2), lower($3))`, [
      EMAIL_A,
      EMAIL_B,
      EMAIL_C,
    ]);
    if (orgs.length) {
      await query(`DELETE FROM organizations WHERE org_id = ANY($1::uuid[])`, [orgs]);
    }
  });

  it("shows each private org its own score and does not write on read", async () => {
    const before = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM org_compliance_status
       WHERE org_id = ANY($1::uuid[])
         AND framework_id IN (SELECT framework_id FROM compliance_frameworks WHERE code = 'nist_csf_2')`,
      [orgs],
    );

    const ownA = await app.inject({ method: "GET", url: "/api/ecc/compliance", headers: { cookie: cookieA } });
    const ownB = await app.inject({ method: "GET", url: "/api/ecc/compliance", headers: { cookie: cookieB } });
    const ownC = await app.inject({ method: "GET", url: "/api/ecc/compliance", headers: { cookie: cookieC } });
    assert.equal(ownA.statusCode, 200);
    assert.equal(ownB.statusCode, 200);
    assert.equal(ownC.statusCode, 200);
    assert.equal(nistPct(ownA.json()), expectedA);
    assert.equal(nistPct(ownB.json()), expectedB);
    const empty = ownC.json() as { nist?: { empty?: boolean; note?: string; coveragePct?: number | null } };
    assert.equal(empty.nist?.empty, true);
    assert.equal(empty.nist?.coveragePct, null);
    assert.equal(empty.nist?.note, emptyNist().note);
    assert.notEqual(nistPct(ownA.json()), nistPct(ownB.json()));

    const forged = await app.inject({
      method: "GET",
      url: `/api/ecc/compliance?orgId=${orgs[1]}&org_id=${orgs[1]}`,
      headers: {
        cookie: cookieA,
        "x-org-id": orgs[1],
        "x-user-id": userB,
      },
      payload: { orgId: orgs[1], org_id: orgs[1] },
    });
    assert.equal(forged.statusCode, 200);
    assert.equal(nistPct(forged.json()), expectedA);

    const afterRead = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM org_compliance_status
       WHERE org_id = ANY($1::uuid[])
         AND framework_id IN (SELECT framework_id FROM compliance_frameworks WHERE code = 'nist_csf_2')`,
      [orgs],
    );
    assert.equal(afterRead.rows[0]?.n, before.rows[0]?.n);

    const written = await app.inject({
      method: "POST",
      url: "/api/ecc/compliance/recompute",
      headers: { cookie: cookieA },
    });
    assert.equal(written.statusCode, 200);
    const body = written.json() as { written: boolean; coveragePct: number | null };
    assert.equal(body.coveragePct, expectedA);
    const stored = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM org_compliance_status WHERE org_id = $1`,
      [orgs[0]],
    );
    assert.equal(Number(stored.rows[0]?.n) > Number(before.rows[0]?.n), true);
  });
});
