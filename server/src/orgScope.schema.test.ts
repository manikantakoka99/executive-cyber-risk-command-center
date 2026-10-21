import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function tableBody(sql: string, name: string): string {
  const match = sql.match(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${name} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(match, `${name} is defined`);
  return match[1];
}

describe("org_id scoping", () => {
  it("keeps compliance and score tables on org_id in both schemas", () => {
    const app = readFileSync(path.join(root, "db/schema.sql"), "utf8");
    const dwan = readFileSync(path.join(root, "db/dwan_schema.sql"), "utf8");
    const foundation = readFileSync(path.join(root, "db/migrations/001_ecc_v2_foundation.sql"), "utf8");
    const appTables = [
      "org_compliance_status",
      "domain_risk_snapshots",
      "enterprise_risk_score_snapshots",
      "decision_action_log",
      "auth_sessions",
      "org_memberships",
      "org_invites",
    ];
    const dwanTables = [
      "org_compliance_status",
      "domain_scores",
      "domain_score_components",
      "enterprise_scores",
      "control_assessments",
      "auth_sessions",
      "org_memberships",
      "org_invites",
    ];
    for (const name of appTables) {
      assert.match(tableBody(app, name), /\borg_id\b/, name);
      assert.doesNotMatch(tableBody(app, name), /\btenant_id\b/, name);
    }
    for (const name of dwanTables) {
      assert.match(tableBody(dwan, name), /\borg_id\b/, name);
      assert.doesNotMatch(tableBody(dwan, name), /\btenant_id\b/, name);
    }
    assert.match(tableBody(foundation, "compliance_assessments"), /\borg_id\b/);
    assert.match(app, /CREATE TABLE organizations \(/);
    assert.match(dwan, /CREATE TABLE organizations \(/);
  });
});
