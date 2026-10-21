import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createInvite } from "../auth/service.js";
import { ensureAuthSchema } from "../auth/schema.js";
import { query } from "../db.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FAL = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";

type PolicyRow = { policy_id: string; version: string; is_active: boolean };

async function defaults(orgId: string): Promise<PolicyRow[]> {
  const { rows } = await query<PolicyRow>(
    `SELECT policy_id, version, is_active
     FROM risk_policies
     WHERE org_id = $1 AND code = 'ecc_default'
     ORDER BY version`,
    [orgId],
  );
  return rows;
}

function assertDefaults(rows: PolicyRow[]) {
  assert.deepEqual(
    rows.map((row) => [row.version, row.is_active]),
    [
      ["1.0.0", false],
      ["1.1.0", true],
    ],
  );
}

describe("default risk policies", () => {
  const created: string[] = [];

  after(async () => {
    if (!created.length) return;
    await query(`DELETE FROM org_invites WHERE org_id = ANY($1::uuid[])`, [created]);
    await query(`DELETE FROM organizations WHERE org_id = ANY($1::uuid[])`, [created]);
  });

  it("lists ecc_default 1.0.0 and 1.1.0 for Al Dhabi and Falcon", async () => {
    await ensureAuthSchema();
    const alDhabi = await defaults(AL);
    const falcon = await defaults(FAL);
    assertDefaults(alDhabi);
    assertDefaults(falcon);
    const ids = [...alDhabi, ...falcon].map((row) => row.policy_id);
    assert.equal(new Set(ids).size, ids.length);
    const { rows } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM risk_policies WHERE org_id IS NULL`,
    );
    assert.equal(rows[0].n, 0);
  });

  it("seeds both default policies when an organization is created", async () => {
    await ensureAuthSchema();
    const { rows } = await query<{ org_id: string }>(
      `INSERT INTO organizations (name, industry, hq_country)
       VALUES ('Policy seed org', 'Test', 'UAE')
       RETURNING org_id`,
    );
    created.push(rows[0].org_id);
    assertDefaults(await defaults(rows[0].org_id));
  });

  it("seeds both default policies when an invite is created for an org that has none", async () => {
    await ensureAuthSchema();
    const { rows } = await query<{ org_id: string }>(
      `INSERT INTO organizations (name) VALUES ('Invite seed org') RETURNING org_id`,
    );
    const orgId = rows[0].org_id;
    created.push(orgId);
    await query(`DELETE FROM risk_policies WHERE org_id = $1`, [orgId]);
    assert.equal((await defaults(orgId)).length, 0);
    const inviter = await query<{ user_id: string }>(`SELECT user_id FROM users LIMIT 1`);
    assert.ok(inviter.rows[0], "a user to invite from");
    await createInvite({
      orgId,
      email: `seed-invite-${orgId.slice(0, 8)}@ecc.test`,
      role: "auditor",
      invitedBy: inviter.rows[0].user_id,
    });
    assertDefaults(await defaults(orgId));
  });
});
