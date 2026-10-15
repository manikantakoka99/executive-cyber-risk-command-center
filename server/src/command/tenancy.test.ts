import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEMO_ORG_ID,
  PERSONAS,
  TENANT_B_ORG_ID,
  TENANT_B_ORG_NAME,
  findPersona,
  orgNameFor,
  personasForOrg,
} from "./personas.js";

describe("multi-tenant personas", () => {
  it("keeps Al Dhabi and Falcon personas in separate orgs", () => {
    const a = personasForOrg(DEMO_ORG_ID);
    const b = personasForOrg(TENANT_B_ORG_ID);
    assert.ok(a.length >= 8);
    assert.ok(b.some((p) => p.role === "ciso"));
    assert.ok(b.some((p) => p.role === "board_member"));
    assert.equal(orgNameFor(TENANT_B_ORG_ID), TENANT_B_ORG_NAME);
    for (const persona of b) {
      assert.equal(persona.orgId, TENANT_B_ORG_ID);
      assert.notEqual(persona.orgId, DEMO_ORG_ID);
    }
    const falconCiso = findPersona("c1500001-a090-41a0-8ecc-0000000000b1");
    assert.ok(falconCiso);
    assert.equal(falconCiso?.orgId, TENANT_B_ORG_ID);
    assert.equal(
      PERSONAS.filter((p) => p.userId === falconCiso!.userId).length,
      1,
    );
  });
});
