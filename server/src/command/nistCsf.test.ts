import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasPermission, ROLE_PERMISSIONS, type RoleCode } from "./rbac.js";
import { DOMAINS } from "./model.js";
import {
  NIST_CATEGORIES,
  NIST_CATEGORY_TOTAL,
  categoryCovered,
  modelDomainEvidence,
  scoreNist,
  type DomainEvidence,
} from "./nistCsf.js";

describe("NIST CSF 2.0 coverage", () => {
  it("scores the mapping count from fixed fixture evidence", () => {
    const fresh: DomainEvidence = { fresh: 1, total: 1 };
    const evidence: Record<string, DomainEvidence> = {};
    for (const category of NIST_CATEGORIES) {
      for (const code of category.domains) evidence[code] = fresh;
    }
    const score = scoreNist(evidence);
    const expected = NIST_CATEGORIES.filter((category) => categoryCovered(category, evidence)).length;
    assert.equal(NIST_CATEGORY_TOTAL, 22);
    assert.equal(expected, 20);
    assert.equal(score.evidenced, expected);
    assert.equal(score.total, 22);
    assert.equal(score.coveragePct, 90.91);
    assert.equal(score.label, "NIST CSF 2.0");
    assert.equal(score.note.includes("certif"), true);
    assert.equal(score.note.toLowerCase().includes("certified"), false);
    const respond = score.functions.find((fn) => fn.name === "Respond")!;
    const recover = score.functions.find((fn) => fn.name === "Recover")!;
    assert.deepEqual(respond.gaps, ["RS.CO"]);
    assert.deepEqual(recover.gaps, ["RC.CO"]);
    assert.equal(respond.covered, 3);
    assert.equal(respond.total, 4);
    assert.equal(recover.covered, 1);
    assert.equal(recover.total, 2);
  });

  it("drops a category when its only domain has no current evidence", () => {
    const fresh: DomainEvidence = { fresh: 1, total: 1 };
    const stale: DomainEvidence = { fresh: 1, total: 4 };
    const evidence: Record<string, DomainEvidence> = {};
    for (const category of NIST_CATEGORIES) {
      for (const code of category.domains) evidence[code] = code === "soc_mdr" ? stale : fresh;
    }
    const score = scoreNist(evidence);
    assert.equal(score.evidenced, NIST_CATEGORIES.filter((c) => categoryCovered(c, evidence)).length);
    assert.equal(score.functions.find((fn) => fn.name === "Detect")!.covered, 1);
    assert.ok(score.evidenced < 20);
  });

  it("matches the command-model feed fixture at 20 of 22", () => {
    const score = scoreNist(modelDomainEvidence());
    assert.equal(DOMAINS.length, 12);
    assert.equal(score.evidenced, 20);
    assert.equal(score.coveragePct, 90.91);
  });

  it("shows the NIST card for roles with compliance.read and hides it otherwise", () => {
    const roles = Object.keys(ROLE_PERMISSIONS) as RoleCode[];
    assert.equal(hasPermission("ciso", "compliance.read"), true);
    assert.equal(hasPermission("domain_analyst", "compliance.read"), false);
    assert.equal(hasPermission("admin", "compliance.read"), false);
    for (const role of roles) {
      assert.equal(hasPermission(role, "compliance.read"), ROLE_PERMISSIONS[role].includes("compliance.read"));
    }
  });
});
