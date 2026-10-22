import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { app } from "../index.js";
import { query } from "../db.js";
import { ensureAuthSchema } from "../auth/schema.js";
import { hashPassword } from "../auth/passwords.js";
import { CANONICAL } from "./canonical.js";
import { resetState } from "./store.js";

const ORGS = [
  { id: "2accc7de-f693-4b19-8fe8-6db501be05e2", name: "Al Dhabi Holdings", email: "headline-iso-al@ecc.test" },
  { id: "e5082391-0ae2-4ed1-93d6-c11650b39dbb", name: "Falcon National Bank", email: "headline-iso-falcon@ecc.test" },
  { id: "0e8b2590-db5b-43e7-89e6-1db5c89cd4e2", name: "Meridian Health Group", email: "headline-iso-meridian@ecc.test" },
] as const;
const PASSWORD = "headline-isolation-password";

function cookieFrom(raw: string | string[] | undefined): string {
  const line = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(line, "session cookie");
  return line.split(";")[0];
}

describe("headline loss, confidence and decisions are scoped to the session org", () => {
  const cookies: string[] = [];

  before(async () => {
    await ensureAuthSchema();
    const emails = ORGS.map((org) => org.email);
    await query(`DELETE FROM auth_accounts WHERE lower(email) = ANY($1::text[])`, [emails]);
    const passwordHash = await hashPassword(PASSWORD);

    for (const org of ORGS) {
      resetState(org.id);
      const user = await query<{ user_id: string; role: string }>(
        `SELECT u.user_id, r.code AS role
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.user_id AND ur.is_primary
         JOIN roles r ON r.role_id = ur.role_id
         WHERE u.org_id = $1 AND r.code IN ('ciso', 'cxo', 'board_member')
         ORDER BY CASE r.code WHEN 'ciso' THEN 0 WHEN 'cxo' THEN 1 ELSE 2 END
         LIMIT 1`,
        [org.id],
      );
      assert.ok(user.rows[0], org.name);
      const account = await query<{ account_id: string }>(
        `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
         VALUES ($1, $2, 'Headline', 'Iso') RETURNING account_id`,
        [org.email, passwordHash],
      );
      await query(
        `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [account.rows[0]!.account_id, org.id, user.rows[0]!.user_id, user.rows[0]!.role],
      );
      const login = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        payload: { email: org.email, password: PASSWORD },
      });
      assert.equal(login.statusCode, 200, org.email);
      cookies.push(cookieFrom(login.headers["set-cookie"]));
    }
  });

  after(async () => {
    await query(`DELETE FROM auth_accounts WHERE lower(email) = ANY($1::text[])`, [
      ORGS.map((org) => org.email),
    ]);
  });

  it("Falcon and Meridian do not inherit Al Dhabi loss, confidence or open decisions", async () => {
    const [al, falcon, meridian] = await Promise.all(
      cookies.map((cookie) =>
        app.inject({ method: "GET", url: "/api/ecc/command/workspace", headers: { cookie } }),
      ),
    );
    assert.equal(al!.statusCode, 200);
    assert.equal(falcon!.statusCode, 200);
    assert.equal(meridian!.statusCode, 200);

    type Body = {
      openDecisions: number | null;
      headline: {
        arithmetic: number;
        band: string;
        confidencePct: number | null;
        acceptanceCount: number | null;
        loss: { ale: number } | null;
      };
    };
    const alBody = al!.json() as Body;
    const falconBody = falcon!.json() as Body;
    const meridianBody = meridian!.json() as Body;

    assert.equal(alBody.headline.arithmetic, Number(CANONICAL.headlineScore));
    assert.equal(alBody.headline.confidencePct, CANONICAL.confidencePct);
    assert.equal(alBody.openDecisions, CANONICAL.openDecisions);
    assert.equal(alBody.headline.acceptanceCount, CANONICAL.openDecisions);
    assert.ok(alBody.headline.loss);
    assert.equal(Number(alBody.headline.loss!.ale.toFixed(2)), CANONICAL.ale);

    for (const [name, body] of [
      ["Falcon", falconBody],
      ["Meridian", meridianBody],
    ] as const) {
      assert.notEqual(body.headline.arithmetic, alBody.headline.arithmetic, name);
      assert.equal(body.headline.loss, null, `${name} loss`);
      assert.equal(body.headline.confidencePct, null, `${name} confidence`);
      assert.equal(body.openDecisions, null, `${name} openDecisions`);
      assert.equal(body.headline.acceptanceCount, null, `${name} acceptanceCount`);
      assert.notEqual(body.headline.confidencePct, CANONICAL.confidencePct, name);
      assert.notEqual(body.openDecisions, CANONICAL.openDecisions, name);
    }
  });
});
