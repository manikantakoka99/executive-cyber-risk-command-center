import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { permissionsFor } from "../server/src/command/rbac.ts";
import { forbiddenReason, roleLabel } from "./src/lib/format.ts";
import { navForRole } from "./src/lib/nav.ts";

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

  it("gates the Intelligence nav item on intelligence.read", () => {
    const cxo = navForRole("cxo", permissionsFor("cxo"));
    assert.equal(
      cxo.some((item) => item.to === "/intelligence"),
      false,
    );
    const ciso = navForRole("ciso", permissionsFor("ciso"));
    const intelligence = ciso.find((item) => item.to === "/intelligence");
    assert.equal(intelligence?.perm, "intelligence.read");
    assert.equal(permissionsFor("cxo").includes("intelligence.read"), false);
  });
});
