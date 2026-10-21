import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { app } from "../index.js";
import { query } from "../db.js";
import { ensureAuthSchema } from "../auth/schema.js";
import { hashPassword } from "../auth/passwords.js";
import { NIST_CATEGORIES, scoreNist, type DomainEvidence } from "./nistCsf.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FAL = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";
const PASSWORD = "nist-isolation-password";
const EMAIL_A = "nist-iso-a@ecc.test";
const EMAIL_B = "nist-iso-b@ecc.test";
const CONNECTOR = "nist-isolation";
const SIGNAL = "nist-isolation-expired";

function cookieFrom(raw: string | string[] | undefined): string {
  const line = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(line, "session cookie");
  return line.split(";")[0];
}

function nistPct(body: { nist?: { coveragePct?: number }; frameworks?: { code?: string; coveragePct?: number }[] }) {
  const row = body.frameworks?.find((framework) => framework.code === "nist_csf_2");
  assert.equal(row?.coveragePct, body.nist?.coveragePct);
  return body.nist?.coveragePct;
}

/** What this org's connectors and open evidence_expired signals score as. */
async function expectedCoverage(orgId: string): Promise<number> {
  const { rows } = await query<{ code: string; fresh: number; total: number; expired: boolean }>(
    `SELECT d.code,
            COUNT(c.connector_id)::int AS total,
            COUNT(c.connector_id) FILTER (
              WHERE c.status = 'active' AND c.last_sync_at IS NOT NULL
            )::int AS fresh,
            EXISTS (
              SELECT 1 FROM security_signals s
              WHERE s.org_id = $1
                AND s.risk_domain_id = d.risk_domain_id
                AND s.event_type = 'evidence_expired'
                AND s.lifecycle_status IS DISTINCT FROM 'resolved'
            ) AS expired
     FROM risk_domains d
     JOIN connectors c ON c.risk_domain_id = d.risk_domain_id AND c.org_id = $1
     GROUP BY d.risk_domain_id, d.code`,
    [orgId],
  );
  const evidence: Record<string, DomainEvidence> = {};
  for (const row of rows) {
    evidence[row.code] = {
      fresh: Number(row.fresh),
      total: Number(row.total),
      evidenceExpired: Boolean(row.expired),
    };
  }
  return scoreNist(evidence).coveragePct;
}

describe("NIST compliance is scoped to the session org", () => {
  const ids: string[] = [];
  let cookieA = "";
  let cookieB = "";
  let userB = "";

  before(async () => {
    await ensureAuthSchema();
    const { rows: roles } = await query<{ role_id: string }>(
      `SELECT role_id FROM roles WHERE code = 'ciso'`,
    );
    const ciso = roles[0]?.role_id;
    assert.ok(ciso, "ciso role");
    const passwordHash = await hashPassword(PASSWORD);
    for (const [email, orgId] of [
      [EMAIL_A, AL],
      [EMAIL_B, FAL],
    ] as const) {
      const user = await query<{ user_id: string }>(
        `INSERT INTO users (org_id, first_name, last_name, email)
         VALUES ($1, 'Nist', $2, $3)
         RETURNING user_id`,
        [orgId, email, email],
      );
      const userId = user.rows[0].user_id;
      ids.push(userId);
      if (orgId === FAL) userB = userId;
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
        [account.rows[0].account_id, orgId, userId],
      );
    }

    const codes = [...new Set(NIST_CATEGORIES.flatMap((category) => category.domains))];
    for (const code of codes) {
      await query(
        `INSERT INTO connectors (org_id, risk_domain_id, name, connector_type, status, last_sync_at)
         SELECT $1, risk_domain_id, $2, 'api', 'active', now()
         FROM risk_domains WHERE code = $3`,
        [AL, CONNECTOR, code],
      );
    }
    await query(
      `INSERT INTO security_signals (org_id, risk_domain_id, event_type, observed_at, title, lifecycle_status)
       SELECT $1, risk_domain_id, 'evidence_expired', now(), $2, 'received'
       FROM risk_domains
       WHERE code::text = ANY($3::text[])`,
      [FAL, SIGNAL, codes],
    );

    const loginA = await app.inject({
      method: "POST",
      url: "/api/ecc/auth/login",
      payload: { email: EMAIL_A, password: PASSWORD },
    });
    assert.equal(loginA.statusCode, 200);
    cookieA = cookieFrom(loginA.headers["set-cookie"]);
    const loginB = await app.inject({
      method: "POST",
      url: "/api/ecc/auth/login",
      payload: { email: EMAIL_B, password: PASSWORD },
    });
    assert.equal(loginB.statusCode, 200);
    cookieB = cookieFrom(loginB.headers["set-cookie"]);
  });

  after(async () => {
    await query(`DELETE FROM connectors WHERE name = $1`, [CONNECTOR]);
    await query(`DELETE FROM security_signals WHERE title = $1`, [SIGNAL]);
    await query(`DELETE FROM org_compliance_status WHERE org_id = ANY($1::uuid[]) AND framework_id IN (
      SELECT framework_id FROM compliance_frameworks WHERE code = 'nist_csf_2'
    )`, [[AL, FAL]]);
    if (!ids.length) return;
    await query(`DELETE FROM auth_accounts WHERE lower(email) IN (lower($1), lower($2))`, [EMAIL_A, EMAIL_B]);
    await query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [ids]);
  });

  it("shows each session its own score and ignores a forged org header or param", async () => {
    const expectedA = await expectedCoverage(AL);
    const expectedB = await expectedCoverage(FAL);
    assert.notEqual(expectedA, expectedB);

    const ownA = await app.inject({
      method: "GET",
      url: "/api/ecc/compliance",
      headers: { cookie: cookieA },
    });
    const ownB = await app.inject({
      method: "GET",
      url: "/api/ecc/compliance",
      headers: { cookie: cookieB },
    });
    assert.equal(ownA.statusCode, 200);
    assert.equal(ownB.statusCode, 200);
    const scoreA = nistPct(ownA.json());
    const scoreB = nistPct(ownB.json());
    assert.equal(scoreA, expectedA);
    assert.equal(scoreB, expectedB);
    assert.notEqual(scoreA, scoreB);

    const forged = await app.inject({
      method: "GET",
      url: `/api/ecc/compliance?orgId=${FAL}&org_id=${FAL}`,
      headers: {
        cookie: cookieA,
        "x-org-id": FAL,
        "x-user-id": userB,
      },
      payload: { orgId: FAL, org_id: FAL },
    });
    assert.equal(forged.statusCode, 200);
    assert.equal(nistPct(forged.json()), scoreA);

    const { rows } = await query<{ org_id: string; coverage_pct: string }>(
      `SELECT DISTINCT ON (c.org_id) c.org_id, c.coverage_pct::text
       FROM org_compliance_status c
       JOIN compliance_frameworks f ON f.framework_id = c.framework_id
       WHERE f.code = 'nist_csf_2' AND c.org_id = ANY($1::uuid[])
       ORDER BY c.org_id, c.snapshot_at DESC`,
      [[AL, FAL]],
    );
    const stored = new Map(rows.map((row) => [row.org_id, Number(row.coverage_pct)]));
    assert.equal(stored.get(AL), scoreA);
    assert.equal(stored.get(FAL), scoreB);
  });
});
