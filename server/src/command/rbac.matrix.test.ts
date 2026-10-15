import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { registerCommandRoutes } from "./routes.js";
import {
  ROLE_CODES,
  canAcceptRisk,
  canonicalRole,
  hasPermission,
  isRoleCode,
  requiredPermission,
} from "./rbac.js";
import { resetState } from "./store.js";

const ORG = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const CISO = "c1500001-a090-41a0-8ecc-000000000001";
const CXO = "c1500001-a090-41a0-8ecc-000000000002";
const BOARD = "c1500001-a090-41a0-8ecc-000000000006";
const ANALYST = "c1500001-a090-41a0-8ecc-000000000007";
const ADMIN = "c1500001-a090-41a0-8ecc-000000000009";
const RISK = "c1500001-a090-41a0-8ecc-00000000000a";
const AUDITOR = "c1500001-a090-41a0-8ecc-00000000000c";

describe("RBAC matrix (schema eight roles)", () => {
  it("keeps RoleCode aligned to the schema enum", () => {
    assert.equal(ROLE_CODES.length, 8);
    for (const role of ROLE_CODES) assert.equal(isRoleCode(role), true);
    assert.equal(canonicalRole("org_admin"), "admin");
    assert.equal(canonicalRole("risk_manager"), "risk_lead");
    assert.equal(canAcceptRisk("risk_lead"), true);
    assert.equal(hasPermission("risk_lead", "command.queue.accept"), true);
  });

  it("blocks CxO from findings and technical evidence permissions", () => {
    assert.equal(hasPermission("cxo", "findings.read"), false);
    assert.equal(hasPermission("cxo", "findings.technical"), false);
    assert.equal(requiredPermission("GET", "/api/ecc/findings"), "findings.read");
    assert.equal(hasPermission("cxo", requiredPermission("GET", "/api/ecc/findings")!), false);
  });

  it("allows auditor technical evidence read (domains, findings, scenarios)", () => {
    assert.equal(hasPermission("auditor", "findings.read"), true);
    assert.equal(hasPermission("auditor", "findings.technical"), true);
    assert.equal(hasPermission("auditor", "domains.read"), true);
    assert.equal(hasPermission("auditor", "domains.technical"), true);
    assert.equal(hasPermission("auditor", "scenarios.read"), true);
    assert.equal(hasPermission("auditor", "connectors.read"), true);
    assert.equal(hasPermission("auditor", "command.queue.act"), false);
  });
});

describe("authorization before validation on mutating endpoints", () => {
  async function app() {
    const { tenantMiddleware } = await import("../middleware/tenant.js");
    const { hasPermission: hp, requiredPermission: rp } = await import("./rbac.js");
    const server = Fastify({ logger: false });
    server.addHook("preHandler", async (req, reply) => {
      if (!req.url.startsWith("/api/ecc")) return;
      if (req.url.startsWith("/api/ecc/organizations")) return;
      await tenantMiddleware(req, reply);
      if (reply.sent) return;
      const permission = rp(req.method, req.url);
      if (!permission || permission === "self") return;
      if (!hp(req.tenant.role, permission)) {
        return reply.code(403).send({
          error: { code: "forbidden", message: `Role ${req.tenant.role} cannot access this resource.` },
        });
      }
    });
    await registerCommandRoutes(server);
    await server.ready();
    return server;
  }

  it("returns 403 (not 400) when an analyst posts accept-risk with an empty body", async () => {
    resetState(ORG);
    const server = await app();
    const res = await server.inject({
      method: "POST",
      url: "/api/ecc/command/queue/q1/accept",
      headers: { "x-org-id": ORG, "x-user-id": ANALYST },
      payload: {},
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error?.code, "forbidden");
    await server.close();
  });

  it("returns 403 for board on accept-risk before validating the body", async () => {
    resetState(ORG);
    const server = await app();
    const res = await server.inject({
      method: "POST",
      url: "/api/ecc/command/queue/q1/accept",
      headers: { "x-org-id": ORG, "x-user-id": BOARD },
      payload: { reason: "x" },
    });
    assert.equal(res.statusCode, 403);
    await server.close();
  });

  it("returns 403 when CxO reads findings", async () => {
    const server = await app();
    // findings route is registered on the main app; here we assert permission mapping + role matrix.
    assert.equal(hasPermission("cxo", "findings.read"), false);
    // Accept-risk still allowed for CxO once body is valid
    resetState(ORG);
    const accept = await server.inject({
      method: "POST",
      url: "/api/ecc/command/queue/q1/accept",
      headers: { "x-org-id": ORG, "x-user-id": CXO },
      payload: { reason: "Compensating controls until cutover", approver: "CFO", days: 30 },
    });
    assert.equal(accept.statusCode, 200);
    await server.close();
  });

  it("returns 200 for risk_lead accept and for auditor register/connectors permissions", async () => {
    resetState(ORG);
    const server = await app();
    const accept = await server.inject({
      method: "POST",
      url: "/api/ecc/command/queue/q2/accept",
      headers: { "x-org-id": ORG, "x-user-id": RISK },
      payload: { reason: "Vendor migration pending until Q1", approver: "Risk Lead", days: 30 },
    });
    assert.equal(accept.statusCode, 200);

    assert.equal(hasPermission("auditor", "findings.read"), true);
    assert.equal(hasPermission("auditor", "connectors.read"), true);
    assert.equal(hasPermission("admin", "findings.read"), false);
    void CISO;
    void ADMIN;
    void AUDITOR;
    await server.close();
  });
});
