import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forbiddenReason, roleLabel } from "./src/lib/format.ts";

describe("role display name in a 403", () => {
  it("renders CxO and every other role as a display name, never the raw id", () => {
    const roles: Record<string, string> = {
      cxo: "CxO",
      ciso: "CISO",
      board_member: "Board Member",
      risk_lead: "Risk Lead",
      admin: "Admin",
      program_office: "Program Office",
      domain_analyst: "Domain Analyst",
      auditor: "Auditor",
    };
    for (const [id, label] of Object.entries(roles)) {
      assert.equal(roleLabel(id), label);
      const reason = forbiddenReason(id);
      assert.equal(reason, `${label} cannot open this workspace.`);
      assert.equal(reason.includes(id), false);
    }
    assert.match(forbiddenReason("cxo"), /CxO/);
    assert.doesNotMatch(forbiddenReason("cxo"), /\bcxo\b/);
  });
});
