import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { isAccessDenied } from "./command/rbac.js";
import { registerCommandRoutes } from "./command/routes.js";
import { runWithRequestTenant } from "./db.js";
import { installRequestValidation } from "./middleware/requestValidation.js";
import { tenantMiddleware } from "./middleware/tenant.js";

/**
 * Authenticated /api/ecc/command/* calls must finish.
 * A reported stall covered GET and POST, including unknown paths such as
 * GET /api/ecc/command/state. These hit a server built the same way as the
 * app (validation installed before routes, then auth hooks, then the command
 * router) over a real socket and fail if the body is not complete within
 * RESPONSE_BUDGET_MS.
 */

const ORG = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const CISO = "c1500001-a090-41a0-8ecc-000000000001";
const CXO = "c1500001-a090-41a0-8ecc-000000000002";
const RISK = "c1500001-a090-41a0-8ecc-00000000000a";

const RESPONSE_BUDGET_MS = 2_000;

type Call = {
  name: string;
  method: "GET" | "POST" | "PATCH";
  url: string;
  userId: string | null;
  body?: unknown;
  status?: number;
};

const COMMAND_CALLS: Call[] = [
  { name: "unknown state", method: "GET", url: "/api/ecc/command/state", userId: CISO, status: 404 },
  { name: "unknown queue collection", method: "GET", url: "/api/ecc/command/queue", userId: CISO, status: 404 },
  { name: "unknown nested", method: "POST", url: "/api/ecc/command/does-not-exist", userId: CISO, status: 404 },
  { name: "unauthenticated unknown", method: "GET", url: "/api/ecc/command/state", userId: null, status: 401 },
  { name: "workspace", method: "GET", url: "/api/ecc/command/workspace", userId: CISO, status: 200 },
  { name: "domain evidence", method: "GET", url: "/api/ecc/command/domains/identity", userId: CISO },
  { name: "what-if", method: "PATCH", url: "/api/ecc/command/whatif", userId: CISO, body: { edr: 1 } },
  { name: "save what-if scenario", method: "POST", url: "/api/ecc/command/whatif/scenarios", userId: CISO, body: {} },
  {
    name: "what-if decision",
    method: "POST",
    url: "/api/ecc/command/whatif/scenarios/0/decision",
    userId: CISO,
    body: {},
  },
  { name: "queue approve", method: "POST", url: "/api/ecc/command/queue/q1/approve", userId: CXO, body: {} },
  { name: "queue defer", method: "POST", url: "/api/ecc/command/queue/q1/defer", userId: CISO, body: {} },
  { name: "queue reopen", method: "POST", url: "/api/ecc/command/queue/q1/reopen", userId: CISO, body: {} },
  {
    name: "queue accept",
    method: "POST",
    url: "/api/ecc/command/queue/q2/accept",
    userId: RISK,
    body: { reason: "Vendor migration pending", approver: "Risk Lead", days: 90 },
  },
  {
    name: "accept unknown token",
    method: "POST",
    url: "/api/ecc/command/queue/x/accept",
    userId: RISK,
    body: { reason: "Vendor migration pending", approver: "Risk Lead", days: 90 },
  },
  { name: "verify fix", method: "POST", url: "/api/ecc/command/fixes/f1/verify", userId: CISO, body: {} },
  { name: "renew acceptance", method: "POST", url: "/api/ecc/command/acceptances/a1/renew", userId: CXO, body: {} },
  { name: "revoke acceptance", method: "POST", url: "/api/ecc/command/acceptances/a1/revoke", userId: CXO, body: {} },
  { name: "pack review", method: "POST", url: "/api/ecc/command/pack/review", userId: CISO, body: {} },
  { name: "non-command unknown", method: "GET", url: "/api/ecc/does-not-exist", userId: CISO, status: 404 },
];

let server: FastifyInstance;
let baseUrl = "";

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  installRequestValidation(app);
  app.addHook("onRequest", (_req, _reply, done) => {
    runWithRequestTenant(() => done());
  });
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/ecc")) return;
    await tenantMiddleware(req, reply);
  });
  app.addHook("preHandler", async (req, reply) => {
    if (reply.sent || !req.url.startsWith("/api/ecc") || !req.tenant) return;
    if (!isAccessDenied(req.tenant.role, req.method, req.url)) return;
    return reply.code(403).send({
      error: {
        code: "forbidden",
        message: `Role ${req.tenant.role} cannot access this resource.`,
      },
    });
  });
  await registerCommandRoutes(app);
  return app;
}

async function call(spec: Call): Promise<{ status: number; body: string; elapsedMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESPONSE_BUDGET_MS);
  const started = Date.now();
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (spec.userId) {
      headers["x-org-id"] = ORG;
      headers["x-user-id"] = spec.userId;
    }
    let body: string | undefined;
    if (spec.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(spec.body);
    }
    const res = await fetch(`${baseUrl}${spec.url}`, {
      method: spec.method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, body: text, elapsedMs: Date.now() - started };
  } catch (err) {
    const elapsed = Date.now() - started;
    const name = err instanceof Error ? err.name : "Error";
    assert.fail(
      `${spec.method} ${spec.url} (${spec.name}) produced no response within ${RESPONSE_BUDGET_MS}ms (${name} after ${elapsed}ms)`,
    );
  } finally {
    clearTimeout(timer);
  }
}

describe("command routes respond for logged-in users", () => {
  before(async () => {
    server = await buildServer();
    await server.listen({ port: 0, host: "127.0.0.1" });
    const bound = server.server.address();
    if (!bound || typeof bound === "string") {
      throw new Error("command timeout tests failed to bind a port");
    }
    baseUrl = `http://127.0.0.1:${(bound as AddressInfo).port}`;
  });

  after(async () => {
    await server.close();
  });

  for (const spec of COMMAND_CALLS) {
    it(`${spec.method} ${spec.url} (${spec.name}) responds within ${RESPONSE_BUDGET_MS}ms`, async () => {
      const res = await call(spec);
      assert.ok(res.elapsedMs < RESPONSE_BUDGET_MS, `elapsed ${res.elapsedMs}ms`);
      assert.ok(res.status >= 200 && res.status < 600, `status ${res.status}`);
      if (spec.status !== undefined) {
        assert.equal(res.status, spec.status, res.body.slice(0, 240));
      }
      assert.ok(res.body.length > 0 || res.status === 204);
    });
  }
});
