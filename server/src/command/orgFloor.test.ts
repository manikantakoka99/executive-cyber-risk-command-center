import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { app } from "../index.js";
import { query } from "../db.js";
import { ensureAuthSchema } from "../auth/schema.js";
import { hashPassword } from "../auth/passwords.js";
import { format1, round1 } from "./model.js";
import { floorHoldLine } from "./present.js";
import { initialState } from "./store.js";
import { presentWorkspace } from "./present.js";
import { getOverview } from "../services/overview.js";
import { scorecardFromCodeScores } from "./orgFloor.js";

const ORGS = [
  { id: "2accc7de-f693-4b19-8fe8-6db501be05e2", name: "Al Dhabi Holdings" },
  { id: "e5082391-0ae2-4ed1-93d6-c11650b39dbb", name: "Falcon National Bank" },
  { id: "0e8b2590-db5b-43e7-89e6-1db5c89cd4e2", name: "Meridian Health Group" },
] as const;

async function rawScores(orgId: string) {
  const { rows } = await query<{ code: string; score: string }>(
    `SELECT DISTINCT ON (d.code) d.code, s.score::text
     FROM domain_risk_snapshots s
     JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     JOIN org_domain_subscriptions sub
       ON sub.org_id = s.org_id AND sub.risk_domain_id = s.risk_domain_id AND sub.is_active
     WHERE s.org_id = $1
     ORDER BY d.code, s.snapshot_at DESC`,
    [orgId],
  );
  const raw: Record<string, number> = {};
  for (const row of rows) raw[row.code] = Number(row.score);
  return raw;
}

const SESSION_EMAILS = [
  "floor-rule-al@ecc.test",
  "floor-rule-falcon@ecc.test",
  "floor-rule-meridian@ecc.test",
] as const;
const SESSION_PASSWORD = "floor-rule-session-password";

function cookieFrom(raw: string | string[] | undefined): string {
  const line = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(line, "session cookie");
  return line.split(";")[0];
}

async function headlineUser(orgId: string) {
  const { rows } = await query<{ user_id: string; role: string }>(
    `SELECT u.user_id, r.code AS role
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.user_id AND ur.is_primary
     JOIN roles r ON r.role_id = ur.role_id
     WHERE u.org_id = $1 AND r.code IN ('ciso', 'cxo', 'board_member')
     ORDER BY CASE r.code WHEN 'ciso' THEN 0 WHEN 'cxo' THEN 1 ELSE 2 END
     LIMIT 1`,
    [orgId],
  );
  assert.ok(rows[0], `headline user for ${orgId}`);
  return rows[0]!;
}

async function sessionFor(orgId: string, email: string, passwordHash: string): Promise<string> {
  const user = await headlineUser(orgId);
  const account = await query<{ account_id: string }>(
    `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
     VALUES ($1, $2, 'Floor', 'Rule')
     RETURNING account_id`,
    [email, passwordHash],
  );
  await query(
    `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [account.rows[0]!.account_id, orgId, user.user_id, user.role],
  );
  const login = await app.inject({
    method: "POST",
    url: "/api/ecc/auth/login",
    payload: { email, password: SESSION_PASSWORD },
  });
  assert.equal(login.statusCode, 200, email);
  return cookieFrom(login.headers["set-cookie"]);
}

describe("floor rule uses each org's own domain scores", () => {
  const cookies: string[] = [];

  before(async () => {
    await ensureAuthSchema();
    await query(`DELETE FROM auth_accounts WHERE lower(email) = ANY($1::text[])`, [SESSION_EMAILS]);
    const passwordHash = await hashPassword(SESSION_PASSWORD);
    for (let i = 0; i < ORGS.length; i++) {
      cookies.push(await sessionFor(ORGS[i]!.id, SESSION_EMAILS[i]!, passwordHash));
    }
  });

  after(async () => {
    await query(`DELETE FROM auth_accounts WHERE lower(email) = ANY($1::text[])`, [SESSION_EMAILS]);
  });

  it("Al Dhabi, Falcon and Meridian each floor from their snapshots", async () => {
    const al = scorecardFromCodeScores(await rawScores(ORGS[0].id));
    const falcon = scorecardFromCodeScores(await rawScores(ORGS[1].id));
    const meridian = scorecardFromCodeScores(await rawScores(ORGS[2].id));
    assert.ok(al && falcon && meridian);

    assert.equal(format1(al.arithmetic), "50.8");
    assert.equal(al.headline, "Critical");
    assert.equal(al.floored, true);
    assert.equal(al.floorDomain?.domain.name, "Attack Surface and VAPT");
    assert.equal(floorHoldLine(al.headline, al.floorDomain!.domain.name), "Held at Critical by Attack Surface & VAPT");

    assert.equal(falcon.rows.some((row) => row.band === "Critical"), false);
    assert.equal(falcon.rows.find((row) => row.domain.id === "att")?.raw, 68);
    assert.equal(falcon.rows.find((row) => row.domain.id === "att")?.band, "High");
    assert.equal(falcon.headline, "High");
    if (falcon.floored) {
      assert.equal(falcon.floorDomain?.domain.id, "att");
      assert.equal(floorHoldLine(falcon.headline, falcon.floorDomain!.domain.name), "Held at High by Attack Surface & VAPT");
    }

    assert.equal(meridian.rows.find((row) => row.domain.id === "soc")?.raw, 77);
    assert.equal(meridian.rows.find((row) => row.domain.id === "soc")?.band, "Critical");
    assert.equal(meridian.headline, "Critical");
    assert.equal(meridian.floored, true);
    assert.equal(meridian.floorDomain?.domain.name, "SOC / MDR");
    assert.equal(floorHoldLine(meridian.headline, meridian.floorDomain!.domain.name), "Held at Critical by SOC / MDR");

    for (const [org, card] of [
      [ORGS[0], al],
      [ORGS[1], falcon],
      [ORGS[2], meridian],
    ] as const) {
      const overview = await getOverview(org.id);
      assert.equal(overview?.org.name, org.name);
      assert.equal(overview?.enterpriseRisk?.score, round1(card.arithmetic));
      assert.equal(overview?.enterpriseRisk?.severity, card.headline.toLowerCase());
      const workspace = presentWorkspace("ciso", initialState(), org.name, org.id, card);
      assert.equal(workspace.headline?.arithmetic, round1(card.arithmetic));
      assert.equal(workspace.headline?.band, card.headline);
      assert.equal(workspace.headline?.floorNote, card.floored && card.floorDomain
        ? floorHoldLine(card.headline, card.floorDomain.domain.name)
        : null);
      assert.equal(overview?.enterpriseRisk?.score, workspace.headline?.arithmetic);
      assert.equal(overview?.enterpriseRisk?.severity, workspace.headline?.band.toLowerCase());
    }
  });

  it("the workspace API follows the session org and ignores a forged org header", async () => {
    const al = await app.inject({
      method: "GET",
      url: "/api/ecc/command/workspace",
      headers: { cookie: cookies[0] },
    });
    const falcon = await app.inject({
      method: "GET",
      url: "/api/ecc/command/workspace",
      headers: { cookie: cookies[1] },
    });
    const meridian = await app.inject({
      method: "GET",
      url: "/api/ecc/command/workspace",
      headers: { cookie: cookies[2] },
    });
    assert.equal(al.statusCode, 200);
    assert.equal(falcon.statusCode, 200);
    assert.equal(meridian.statusCode, 200);
    const alBody = al.json() as { headline: { arithmetic: number; band: string; floorNote: string | null } };
    const falconBody = falcon.json() as { headline: { arithmetic: number; band: string; floorNote: string | null } };
    const meridianBody = meridian.json() as { headline: { arithmetic: number; band: string; floorDomainName: string | null } };
    assert.equal(alBody.headline.arithmetic, 50.8);
    assert.equal(alBody.headline.band, "Critical");
    assert.equal(alBody.headline.floorNote, "Held at Critical by Attack Surface & VAPT");
    assert.equal(falconBody.headline.band, "High");
    assert.notEqual(falconBody.headline.arithmetic, 50.8);
    assert.equal(meridianBody.headline.band, "Critical");
    assert.match(meridianBody.headline.floorDomainName ?? "", /SOC/);
    assert.notEqual(meridianBody.headline.floorDomainName, "Attack Surface and VAPT");

    const forged = await app.inject({
      method: "GET",
      url: `/api/ecc/command/workspace?orgId=${ORGS[1].id}`,
      headers: {
        cookie: cookies[0],
        "x-org-id": ORGS[1].id,
        "x-user-id": "00000000-0000-4000-8000-000000000099",
      },
    });
    assert.equal(forged.statusCode, 200);
    const forgedBody = forged.json() as { headline: { arithmetic: number; band: string; floorNote: string | null } };
    assert.equal(forgedBody.headline.arithmetic, alBody.headline.arithmetic);
    assert.equal(forgedBody.headline.band, alBody.headline.band);
    assert.equal(forgedBody.headline.floorNote, alBody.headline.floorNote);

    const falconOverview = await app.inject({
      method: "GET",
      url: "/api/ecc/overview",
      headers: { cookie: cookies[1], "x-org-id": ORGS[0].id },
    });
    assert.equal(falconOverview.statusCode, 200);
    const overview = falconOverview.json() as { enterpriseRisk: { score: number; severity: string } };
    assert.equal(overview.enterpriseRisk.score, falconBody.headline.arithmetic);
    assert.equal(overview.enterpriseRisk.severity, falconBody.headline.band.toLowerCase());
  });
});
