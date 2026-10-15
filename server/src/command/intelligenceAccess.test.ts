import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { app } from "../index.js";
import { hasPermission, isAccessDenied, requiredPermission } from "./rbac.js";

const ORG = "2accc7de-f693-4b19-8fe8-6db501be05e2";

const USERS = {
  ciso: "c1500001-a090-41a0-8ecc-000000000001",
  cxo: "c1500001-a090-41a0-8ecc-000000000002",
  board_member: "c1500001-a090-41a0-8ecc-000000000006",
  domain_analyst: "c1500001-a090-41a0-8ecc-000000000007",
  admin: "c1500001-a090-41a0-8ecc-000000000009",
  risk_lead: "c1500001-a090-41a0-8ecc-00000000000a",
  program_office: "c1500001-a090-41a0-8ecc-00000000000b",
  auditor: "c1500001-a090-41a0-8ecc-00000000000c",
} as const;

type RoleName = keyof typeof USERS;

/** Who could read each Intelligence feed before this change, minus CxO. */
const INTELLIGENCE = [
  {
    name: "scenarios",
    url: "/api/ecc/scenarios",
    allow: ["ciso", "risk_lead", "domain_analyst", "auditor"] as RoleName[],
  },
  {
    name: "portfolio",
    url: "/api/ecc/portfolio",
    allow: ["ciso", "risk_lead", "domain_analyst", "auditor"] as RoleName[],
  },
  {
    name: "hotspots",
    url: "/api/ecc/hotspots",
    allow: ["board_member", "ciso", "risk_lead", "domain_analyst", "program_office", "auditor"] as RoleName[],
  },
  {
    name: "trends",
    url: "/api/ecc/trends",
    allow: ["board_member", "ciso", "risk_lead", "domain_analyst", "program_office", "auditor"] as RoleName[],
  },
  {
    name: "appetite",
    url: "/api/ecc/appetite",
    allow: ["board_member", "ciso", "risk_lead", "program_office", "auditor"] as RoleName[],
  },
];

function get(url: string, userId: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { "x-org-id": ORG, "x-user-id": userId },
  });
}

describe("intelligence permission", () => {
  it("withholds intelligence.read from CxO without taking scenarios.read", () => {
    assert.equal(hasPermission("cxo", "scenarios.read"), true);
    assert.equal(hasPermission("cxo", "scenarios.act"), true);
    assert.equal(hasPermission("cxo", "intelligence.read"), false);
    assert.equal(hasPermission("cxo", "command.headline"), true);
    assert.equal(hasPermission("cxo", "decisions.read"), true);
    assert.equal(hasPermission("ciso", "intelligence.read"), true);
    assert.equal(hasPermission("risk_lead", "intelligence.read"), true);
    assert.equal(hasPermission("domain_analyst", "intelligence.read"), true);
    assert.equal(hasPermission("auditor", "intelligence.read"), true);
    assert.equal(hasPermission("board_member", "intelligence.read"), false);
    assert.equal(hasPermission("program_office", "intelligence.read"), false);
    assert.equal(requiredPermission("GET", "/api/ecc/scenarios"), "intelligence.read");
    assert.equal(requiredPermission("GET", "/api/ecc/portfolio"), "intelligence.read");
    assert.equal(requiredPermission("POST", "/api/ecc/scenarios/correlate"), "scenarios.act");
    assert.equal(requiredPermission("GET", "/api/ecc/hotspots"), "ops.overview");
    assert.equal(requiredPermission("GET", "/api/ecc/trends"), "ops.overview");
    assert.equal(requiredPermission("GET", "/api/ecc/appetite"), "policy.read");
    assert.equal(requiredPermission("POST", "/api/ecc/appetite/ap1/approve"), "policy.approve");
    assert.equal(isAccessDenied("cxo", "GET", "/api/ecc/scenarios"), true);
    assert.equal(isAccessDenied("cxo", "GET", "/api/ecc/portfolio"), true);
    assert.equal(isAccessDenied("cxo", "GET", "/api/ecc/hotspots"), true);
    assert.equal(isAccessDenied("cxo", "GET", "/api/ecc/trends"), true);
    assert.equal(isAccessDenied("cxo", "GET", "/api/ecc/appetite"), true);
    assert.equal(isAccessDenied("cxo", "GET", "/api/ecc/command/workspace"), false);
    assert.equal(isAccessDenied("cxo", "GET", "/api/ecc/decisions"), false);
    assert.equal(isAccessDenied("cxo", "GET", "/api/ecc/overview"), false);
    assert.equal(isAccessDenied("cxo", "GET", "/api/ecc/policy"), false);
    assert.equal(isAccessDenied("cxo", "POST", "/api/ecc/appetite/ap1/approve"), false);
    assert.equal(isAccessDenied("ciso", "GET", "/api/ecc/scenarios"), false);
    assert.equal(isAccessDenied("ciso", "GET", "/api/ecc/appetite"), false);
    assert.equal(isAccessDenied("board_member", "GET", "/api/ecc/hotspots"), false);
    assert.equal(isAccessDenied("board_member", "GET", "/api/ecc/trends"), false);
    assert.equal(isAccessDenied("board_member", "GET", "/api/ecc/appetite"), false);
    assert.equal(isAccessDenied("board_member", "GET", "/api/ecc/scenarios"), true);
    assert.equal(isAccessDenied("board_member", "GET", "/api/ecc/portfolio"), true);
    assert.equal(isAccessDenied("program_office", "GET", "/api/ecc/trends"), false);
    assert.equal(isAccessDenied("program_office", "GET", "/api/ecc/appetite"), false);
    assert.equal(isAccessDenied("program_office", "GET", "/api/ecc/scenarios"), true);
    assert.equal(isAccessDenied("domain_analyst", "GET", "/api/ecc/appetite"), true);
    assert.equal(isAccessDenied("domain_analyst", "GET", "/api/ecc/portfolio"), false);
    assert.equal(isAccessDenied("admin", "GET", "/api/ecc/hotspots"), true);
  });
});

describe("intelligence endpoint role matrix", () => {
  for (const endpoint of INTELLIGENCE) {
    it(`${endpoint.name} is 403 for CxO and unchanged for every other role`, async () => {
      for (const role of Object.keys(USERS) as RoleName[]) {
        const res = await get(endpoint.url, USERS[role]);
        const expected = endpoint.allow.includes(role) ? 200 : 403;
        assert.equal(res.statusCode, expected, `${role} GET ${endpoint.url}`);
        if (expected === 403) assert.equal(res.json().error?.code, "forbidden", role);
      }
    });
  }

  it("CxO Headline and Decisions still return 200", async () => {
    const headline = await get("/api/ecc/command/workspace", USERS.cxo);
    const decisions = await get("/api/ecc/decisions", USERS.cxo);
    assert.equal(headline.statusCode, 200);
    assert.equal(decisions.statusCode, 200);
    const me = await get("/api/ecc/me", USERS.cxo);
    assert.equal(me.statusCode, 200);
    const permissions = me.json().user.permissions as string[];
    assert.equal(permissions.includes("scenarios.read"), true);
    assert.equal(permissions.includes("intelligence.read"), false);
    assert.equal(permissions.includes("command.headline"), true);
    assert.equal(permissions.includes("command.queue"), true);
    assert.equal(permissions.includes("decisions.read"), true);
  });
});
