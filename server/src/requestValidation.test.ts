import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { InjectPayload, Response as LightResponse } from "light-my-request";
import { query } from "./db.js";
import { app } from "./index.js";

const ORG = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const CISO = "c1500001-a090-41a0-8ecc-000000000001";
const CXO = "c1500001-a090-41a0-8ecc-000000000002";
const BOARD = "c1500001-a090-41a0-8ecc-000000000006";
const ANALYST = "c1500001-a090-41a0-8ecc-000000000007";
const ADMIN = "c1500001-a090-41a0-8ecc-000000000009";
const AUDITOR = "c1500001-a090-41a0-8ecc-00000000000c";

const DB_LEAK = /22P02|invalid input syntax|SQLSTATE|syntax error at or near|duplicate key value/i;

const BAD_ID = "not-a-uuid";
const WELL_FORMED_ID = "11111111-1111-4111-8111-111111111111";

app.get("/api/ecc/__validation_probe/db-error", async () => {
  const err = new Error('invalid input syntax for type uuid: "not-a-uuid"');
  (err as Error & { code: string }).code = "22P02";
  throw err;
});

function headers(userId: string) {
  return { "x-org-id": ORG, "x-user-id": userId };
}

function hit(
  method: "GET" | "POST" | "PATCH",
  url: string,
  userId: string,
  payload?: InjectPayload,
): Promise<LightResponse> {
  return app.inject({
    method,
    url,
    headers: headers(userId),
    payload,
  }) as Promise<LightResponse>;
}

function assertNoDbLeak(body: string) {
  assert.doesNotMatch(body, DB_LEAK);
}

after(async () => {
  await app.close();
});

describe("malformed resource ids", () => {
  const cases: Array<{ name: string; method?: "GET" | "POST" | "PATCH"; url: string; userId: string }> = [
    { name: "findings", url: `/api/ecc/findings/${BAD_ID}`, userId: CISO },
    { name: "scenarios", url: `/api/ecc/scenarios/${BAD_ID}`, userId: CISO },
    { name: "scenarios nested", url: `/api/ecc/scenarios/${BAD_ID}/impact`, userId: CISO },
    { name: "decisions", url: `/api/ecc/decisions/${BAD_ID}`, userId: CISO },
    { name: "risk-domains", url: `/api/ecc/risk-domains/${BAD_ID}`, userId: CISO },
    { name: "signals", url: `/api/ecc/signals/${BAD_ID}`, userId: CISO },
    { name: "reports", url: `/api/ecc/reports/${BAD_ID}`, userId: CISO },
    { name: "reports content", url: `/api/ecc/reports/${BAD_ID}/content`, userId: CISO },
    { name: "business-units", url: `/api/ecc/business-units/${BAD_ID}`, userId: CISO },
    { name: "connectors", url: `/api/ecc/connectors/${BAD_ID}`, userId: CISO },
    { name: "connectors nested", method: "POST", url: `/api/ecc/connectors/${BAD_ID}/test`, userId: CISO },
  ];

  for (const testCase of cases) {
    it(`returns 404 without database details for ${testCase.name}`, async () => {
      const res = await hit(testCase.method ?? "GET", testCase.url, testCase.userId);
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error?.code, "not_found");
      assert.equal(res.json().error?.message, "Resource not found.");
      assertNoDbLeak(res.body);
      assert.equal(res.body.includes(BAD_ID), false);
    });
  }

  it("lets a well-formed missing finding id reach the handler as 404", async () => {
    const res = await hit("GET", `/api/ecc/findings/${WELL_FORMED_ID}`, CISO);
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error?.code, "not_found");
    assert.equal(res.json().error?.message, "Finding not found");
    assertNoDbLeak(res.body);
  });
});

describe("query parameters", () => {
  it("rejects trends window=abc with 400", async () => {
    const res = await hit("GET", "/api/ecc/trends?window=abc", CISO);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error?.code, "invalid_query");
    assert.match(res.json().error?.message ?? "", /window/);
    assert.match(res.json().error?.message ?? "", /7d, 30d, 90d, quarter, year/);
    assertNoDbLeak(res.body);
  });

  it("rejects portfolio period_days=abc with 400", async () => {
    const res = await hit("GET", "/api/ecc/portfolio?period_days=abc", CISO);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error?.code, "invalid_query");
    assert.match(res.json().error?.message ?? "", /period_days/);
    assert.match(res.json().error?.message ?? "", /integer/i);
    assertNoDbLeak(res.body);
  });

  it("rejects other invalid numeric and enum query params", async () => {
    const bad = [
      "/api/ecc/portfolio?period_days=-5",
      "/api/ecc/portfolio?period_days=1.5",
      "/api/ecc/portfolio?priority=nope",
      "/api/ecc/portfolio?tolerance=nope",
      "/api/ecc/portfolio?asset_criticality=nope",
      "/api/ecc/decisions?status=nope",
      "/api/ecc/signals?lifecycle=nope",
      "/api/ecc/signals?limit=abc",
      "/api/ecc/scenarios?status=nope",
      "/api/ecc/scenarios?priority=nope",
      "/api/ecc/scenarios?tolerance_state=nope",
      "/api/ecc/scenarios?limit=0",
    ];
    for (const url of bad) {
      const res = await hit("GET", url, CISO);
      assert.equal(res.statusCode, 400, url);
      assert.equal(res.json().error?.code, "invalid_query", url);
      assertNoDbLeak(res.body);
    }
  });

  it("accepts valid query params with 200", async () => {
    const good = [
      "/api/ecc/trends",
      "/api/ecc/trends?window=30d",
      "/api/ecc/trends?window=7d",
      "/api/ecc/trends?window=quarter",
      "/api/ecc/portfolio",
      "/api/ecc/portfolio?period_days=30",
      "/api/ecc/portfolio?priority=high&tolerance=outside&asset_criticality=critical",
      "/api/ecc/decisions?status=awaiting_decision",
      "/api/ecc/signals?lifecycle=ready_for_correlation&limit=10",
      "/api/ecc/scenarios?status=open&priority=high&tolerance_state=outside&limit=5",
    ];
    for (const url of good) {
      const res = await hit("GET", url, CISO);
      assert.equal(res.statusCode, 200, `${url} -> ${res.statusCode} ${res.body.slice(0, 240)}`);
      assertNoDbLeak(res.body);
    }
  });
});

describe("valid ids still succeed", () => {
  it("returns 200 for an existing finding, scenario, decision, domain, report, and business unit when present", async () => {
    const finding = await query<{ finding_id: string }>(
      `SELECT finding_id FROM risk_findings WHERE org_id=$1 LIMIT 1`,
      [ORG],
    );
    assert.ok(finding.rows[0], "sample finding");
    const findingRes = await hit("GET", `/api/ecc/findings/${finding.rows[0].finding_id}`, CISO);
    assert.equal(findingRes.statusCode, 200);
    assertNoDbLeak(findingRes.body);

    const domain = await query<{ risk_domain_id: string }>(
      `SELECT s.risk_domain_id
       FROM org_domain_subscriptions s
       WHERE s.org_id=$1
       LIMIT 1`,
      [ORG],
    );
    const domainRes = await hit("GET", `/api/ecc/risk-domains/${domain.rows[0].risk_domain_id}`, CISO);
    assert.equal(domainRes.statusCode, 200);

    const decision = await query<{ decision_id: string }>(
      `SELECT decision_id FROM executive_decisions WHERE org_id=$1 LIMIT 1`,
      [ORG],
    );
    assert.ok(decision.rows[0]);
    const decisionRes = await hit("GET", `/api/ecc/decisions/${decision.rows[0].decision_id}`, CISO);
    assert.equal(decisionRes.statusCode, 200);

    const report = await query<{ report_id: string }>(
      `SELECT report_id FROM generated_reports WHERE org_id=$1 LIMIT 1`,
      [ORG],
    );
    assert.ok(report.rows[0]);
    const reportRes = await hit("GET", `/api/ecc/reports/${report.rows[0].report_id}`, CISO);
    assert.equal(reportRes.statusCode, 200);

    const lists = [
      "/api/ecc/findings",
      "/api/ecc/scenarios",
      "/api/ecc/decisions",
      "/api/ecc/risk-domains",
      "/api/ecc/signals",
      "/api/ecc/reports",
      "/api/ecc/connectors",
      "/api/ecc/connectors/health",
      "/api/ecc/connectors/catalog",
      "/api/ecc/reports/snapshots",
    ];
    for (const url of lists) {
      const res = await hit("GET", url, CISO);
      assert.equal(res.statusCode, 200, url);
    }
  });
});

describe("authorization before validation", () => {
  const forbidden: Array<{ name: string; url: string; userId: string; method?: "GET" | "POST" | "PATCH" }> = [
    { name: "cxo findings", url: `/api/ecc/findings/${BAD_ID}`, userId: CXO },
    { name: "admin scenarios", url: `/api/ecc/scenarios/${BAD_ID}`, userId: ADMIN },
    { name: "auditor signals", url: `/api/ecc/signals/${BAD_ID}`, userId: AUDITOR },
    { name: "analyst reports", url: `/api/ecc/reports/${BAD_ID}`, userId: ANALYST },
    { name: "board connectors", url: `/api/ecc/connectors/${BAD_ID}`, userId: BOARD },
    { name: "admin decisions", url: `/api/ecc/decisions/${BAD_ID}`, userId: ADMIN },
    { name: "board risk-domains", url: `/api/ecc/risk-domains/${BAD_ID}`, userId: BOARD },
    { name: "admin business-units", url: `/api/ecc/business-units/${BAD_ID}`, userId: ADMIN },
    { name: "admin trends window", url: "/api/ecc/trends?window=abc", userId: ADMIN },
    { name: "admin portfolio period", url: "/api/ecc/portfolio?period_days=abc", userId: ADMIN },
  ];

  for (const testCase of forbidden) {
    it(`returns 403 for ${testCase.name} even when the input is invalid`, async () => {
      const res = await hit(testCase.method ?? "GET", testCase.url, testCase.userId);
      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error?.code, "forbidden");
      assertNoDbLeak(res.body);
    });
  }

  it("returns 403 from requireRoles before rejecting a bad decision id", async () => {
    const res = await hit("POST", `/api/ecc/decisions/${BAD_ID}/approve`, CISO, {});
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error?.code, "forbidden");
    assertNoDbLeak(res.body);
  });

  it("returns 401 when auth headers are missing, before id validation", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/ecc/findings/${BAD_ID}`,
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error?.code, "unauthorized");
  });

  it("does not UUID-check command queue tokens before the handler's role check", async () => {
    const denied = await hit("POST", `/api/ecc/command/queue/${BAD_ID}/approve`, ANALYST, {});
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error?.code, "forbidden");

    const allowed = await hit("POST", "/api/ecc/command/queue/q1/approve", CXO, {});
    assert.equal(allowed.statusCode, 200);
  });

  it("validates pol_ and app_ ids only after the policy permission check", async () => {
    const denied = await hit("PATCH", `/api/ecc/policy/${BAD_ID}`, AUDITOR, {});
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error?.code, "forbidden");

    const malformed = await hit("PATCH", `/api/ecc/policy/${BAD_ID}`, CISO, {});
    assert.equal(malformed.statusCode, 404);
    assert.equal(malformed.json().error?.message, "Resource not found.");

    const prefixed = await hit("PATCH", "/api/ecc/policy/pol_missing99", CISO, {});
    assert.equal(prefixed.statusCode, 404);
    assert.equal(prefixed.json().error?.message, "Policy version not found.");
  });
});

describe("uncaught database errors", () => {
  it("logs server-side and returns a generic 500 with no Postgres text", async () => {
    const res = await hit("GET", "/api/ecc/__validation_probe/db-error", CISO);
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().error?.code, "internal_error");
    assert.equal(res.json().error?.message, "An unexpected error occurred.");
    assertNoDbLeak(res.body);
    assert.equal(res.body.includes("not-a-uuid"), false);
    assert.equal(res.body.includes("22P02"), false);
  });

  it("still returns Fastify's 404 for an unknown route", async () => {
    const res = await hit("GET", "/api/ecc/does-not-exist", CISO);
    assert.equal(res.statusCode, 404);
    assertNoDbLeak(res.body);
  });
});
