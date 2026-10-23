import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { app } from "../index.js";
import { query } from "../db.js";
import { ensureAuthSchema } from "../auth/schema.js";
import { hashPassword } from "../auth/passwords.js";
import {
  resetSampleWorkbookIngestion,
  runSampleWorkbookIngestion,
} from "../services/sampleWorkbookIngestion.js";
import { emptyNist, NIST_CATEGORIES } from "./nistCsf.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const PASSWORD = "nist-evidence-test-password";
const EMAIL_AL = "nist-evidence-al@ecc.test";
const EMAIL_EMPTY = "nist-evidence-empty@ecc.test";

function cookieFrom(raw: string | string[] | undefined): string {
  const line = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(line, "session cookie");
  return line.split(";")[0];
}

describe("NIST evidence comes from ingestion domain sync", () => {
  let cookieAl = "";
  let cookieEmpty = "";
  let emptyOrgId = "";

  before(async () => {
    await ensureAuthSchema();
    await query(`DELETE FROM auth_accounts WHERE lower(email) IN (lower($1), lower($2))`, [
      EMAIL_AL,
      EMAIL_EMPTY,
    ]);
    await query(`DELETE FROM organizations WHERE name = 'NIST Evidence Empty'`);

    const passwordHash = await hashPassword(PASSWORD);
    const { rows: roles } = await query<{ role_id: string }>(
      `SELECT role_id FROM roles WHERE code = 'ciso'`,
    );
    const ciso = roles[0]?.role_id;
    assert.ok(ciso);

    const alUser = await query<{ user_id: string }>(
      `SELECT u.user_id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.user_id AND ur.is_primary
       JOIN roles r ON r.role_id = ur.role_id
       WHERE u.org_id = $1 AND r.code = 'ciso'
       LIMIT 1`,
      [AL],
    );
    assert.ok(alUser.rows[0]);
    const alAccount = await query<{ account_id: string }>(
      `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
       VALUES ($1, $2, 'Nist', 'Evidence')
       RETURNING account_id`,
      [EMAIL_AL, passwordHash],
    );
    await query(
      `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
       VALUES ($1, $2, $3, 'ciso', 'active')`,
      [alAccount.rows[0]!.account_id, AL, alUser.rows[0]!.user_id],
    );

    const emptyOrg = await query<{ org_id: string }>(
      `INSERT INTO organizations (name, industry) VALUES ('NIST Evidence Empty', 'Test')
       RETURNING org_id`,
    );
    emptyOrgId = emptyOrg.rows[0]!.org_id;
    const emptyUser = await query<{ user_id: string }>(
      `INSERT INTO users (org_id, first_name, last_name, email)
       VALUES ($1, 'Empty', 'Org', $2) RETURNING user_id`,
      [emptyOrgId, EMAIL_EMPTY],
    );
    await query(
      `INSERT INTO user_roles (user_id, role_id, org_id, is_primary) VALUES ($1, $2, $3, true)`,
      [emptyUser.rows[0]!.user_id, ciso, emptyOrgId],
    );
    const emptyAccount = await query<{ account_id: string }>(
      `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
       VALUES ($1, $2, 'Empty', 'Org') RETURNING account_id`,
      [EMAIL_EMPTY, passwordHash],
    );
    await query(
      `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
       VALUES ($1, $2, $3, 'ciso', 'active')`,
      [emptyAccount.rows[0]!.account_id, emptyOrgId, emptyUser.rows[0]!.user_id],
    );

    for (const [email, slot] of [
      [EMAIL_AL, "al"],
      [EMAIL_EMPTY, "empty"],
    ] as const) {
      const login = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        payload: { email, password: PASSWORD },
      });
      assert.equal(login.statusCode, 200, email);
      const cookie = cookieFrom(login.headers["set-cookie"]);
      if (slot === "al") cookieAl = cookie;
      else cookieEmpty = cookie;
    }
  });

  after(async () => {
    await query(`DELETE FROM auth_accounts WHERE lower(email) IN (lower($1), lower($2))`, [
      EMAIL_AL,
      EMAIL_EMPTY,
    ]);
    if (emptyOrgId) {
      await query(`DELETE FROM organizations WHERE org_id = $1`, [emptyOrgId]);
    }
  });

  it("after sample ingestion Al Dhabi covers 20 of 22 NIST categories", async () => {
    await resetSampleWorkbookIngestion(AL);
    const run = await runSampleWorkbookIngestion(AL, { correlate: false });
    assert.ok(run.domainsEvidenced >= 12, `domainsEvidenced=${run.domainsEvidenced}`);

    const synced = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM connectors
       WHERE org_id = $1
         AND adapter_key = 'ecc.sample_workbook'
         AND last_sync_at IS NOT NULL
         AND risk_domain_id IN (
           SELECT risk_domain_id FROM risk_domains WHERE code::text <> 'unmapped'
         )`,
      [AL],
    );
    assert.ok(Number(synced.rows[0]?.n) >= 12);

    const res = await app.inject({
      method: "GET",
      url: "/api/ecc/compliance",
      headers: { cookie: cookieAl },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      nist: { coveragePct: number; evidenced: number; empty?: boolean; functions: { name: string; covered: number; total: number; gaps: string[] }[] };
    };
    assert.equal(body.nist.empty, undefined);
    assert.equal(body.nist.evidenced, 20);
    assert.equal(body.nist.coveragePct, 90.91);

    const gaps = NIST_CATEGORIES.filter((category) => category.gap).map((category) => category.id);
    assert.deepEqual(gaps.sort(), ["RC.CO", "RS.CO"]);
    const coveredIds = NIST_CATEGORIES.filter((category) => !category.gap).map((category) => category.id);
    assert.equal(coveredIds.length, 20);

    const before = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM org_compliance_status WHERE org_id = $1`,
      [AL],
    );
    const again = await app.inject({
      method: "GET",
      url: "/api/ecc/compliance",
      headers: { cookie: cookieAl },
    });
    assert.equal(again.statusCode, 200);
    const after = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM org_compliance_status WHERE org_id = $1`,
      [AL],
    );
    assert.equal(after.rows[0]?.n, before.rows[0]?.n);
  });

  it("an org with no connectors shows the empty NIST state", async () => {
    const { rows: connectors } = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM connectors WHERE org_id = $1`,
      [emptyOrgId],
    );
    assert.equal(Number(connectors[0]?.n), 0);

    const res = await app.inject({
      method: "GET",
      url: "/api/ecc/compliance",
      headers: { cookie: cookieEmpty },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { nist: { empty?: boolean; coveragePct: number | null; note?: string } };
    assert.equal(body.nist.empty, true);
    assert.equal(body.nist.coveragePct, null);
    assert.equal(body.nist.note, emptyNist().note);
  });

  it("ingested evidence for one org does not change another org's empty NIST reading", async () => {
    const empty = await app.inject({
      method: "GET",
      url: "/api/ecc/compliance",
      headers: { cookie: cookieEmpty },
    });
    const al = await app.inject({
      method: "GET",
      url: "/api/ecc/compliance",
      headers: { cookie: cookieAl },
    });
    assert.equal(empty.statusCode, 200);
    assert.equal(al.statusCode, 200);
    assert.equal((empty.json() as { nist: { empty?: boolean } }).nist.empty, true);
    assert.equal((al.json() as { nist: { evidenced: number } }).nist.evidenced, 20);
    assert.notEqual(
      (empty.json() as { nist: { coveragePct: number | null } }).nist.coveragePct,
      (al.json() as { nist: { coveragePct: number | null } }).nist.coveragePct,
    );
  });
});
