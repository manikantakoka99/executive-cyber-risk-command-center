import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteOptions,
} from "fastify";

/**
 * Shared request validation for ECC API routes.
 *
 * Installed as the last route-level preHandler so it runs only after
 * application auth and the permission hook, and after any route `requireRoles`
 * preHandler. A forbidden role therefore still receives 403 when the id or
 * query string is garbage (no existence / validity oracle).
 *
 * Identifier format is per route. Postgres UUID columns use UUID. In-memory
 * policy and appetite ids are prefixed (`pol_…`, `app_…`) and must not be
 * checked as UUIDs. Command-queue tokens (`q1`, `f…`) are left to those
 * handlers, which authorize before they look the token up.
 */

/** Hyphenated UUID text that Postgres accepts for the uuid type. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prefixed ids minted by the in-memory policy store (`pol_`, `app_`). */
export const PREFIXED_ID_RE = {
  policy: /^pol_[a-z0-9]+$/i,
  appetite: /^app_[a-z0-9]+$/i,
} as const;

const TREND_WINDOWS = ["7d", "30d", "90d", "quarter", "year"] as const;

const PRIORITY_TIERS = ["critical", "high", "medium", "low"] as const;

const TOLERANCE_STATES = ["within", "near", "outside", "unknown"] as const;

const ASSET_CRITICALITY = ["low", "medium", "high", "critical"] as const;

/** risk_scenario_status plus the legacy DWAN `treating` label (text filters). */
const SCENARIO_STATUSES = [
  "candidate",
  "active",
  "open",
  "monitoring",
  "mitigating",
  "mitigated",
  "accepted",
  "closed",
  "treating",
] as const;

/** decision_status including Phase 4 extensions. */
const DECISION_STATUSES = [
  "awaiting_decision",
  "info_requested",
  "approved",
  "declined",
  "deferred",
  "closed",
  "acknowledged",
  "accepted_risk",
  "monitoring",
] as const;

const SIGNAL_LIFECYCLES = [
  "received",
  "parsed",
  "validated",
  "normalized",
  "resolved",
  "deduplicated",
  "ready_for_correlation",
  "rejected",
  "error",
] as const;

type IdRule = { params: Record<string, RegExp> };

const UUID_PARAMS = (names: string[]): IdRule => ({
  params: Object.fromEntries(names.map((name) => [name, UUID_RE])),
});

/** Path params that are Postgres UUIDs. Static siblings (health, catalog, demo) are absent. */
const ID_RULES: Record<string, IdRule> = {
  "/api/ecc/findings/:id": UUID_PARAMS(["id"]),
  "/api/ecc/risk-domains/:id": UUID_PARAMS(["id"]),
  "/api/ecc/decisions/:id": UUID_PARAMS(["id"]),
  "/api/ecc/decisions/:id/approve": UUID_PARAMS(["id"]),
  "/api/ecc/decisions/:id/request-info": UUID_PARAMS(["id"]),
  "/api/ecc/decisions/:id/decline": UUID_PARAMS(["id"]),
  "/api/ecc/decisions/:id/close": UUID_PARAMS(["id"]),
  "/api/ecc/reports/:id": UUID_PARAMS(["id"]),
  "/api/ecc/reports/:id/content": UUID_PARAMS(["id"]),
  "/api/ecc/connectors/:id": UUID_PARAMS(["id"]),
  "/api/ecc/connectors/:id/test": UUID_PARAMS(["id"]),
  "/api/ecc/connectors/:id/sync": UUID_PARAMS(["id"]),
  "/api/ecc/connectors/:id/runs": UUID_PARAMS(["id"]),
  "/api/ecc/signals/:id": UUID_PARAMS(["id"]),
  "/api/ecc/scenarios/:id": UUID_PARAMS(["id"]),
  "/api/ecc/scenarios/:id/recalculate": UUID_PARAMS(["id"]),
  "/api/ecc/scenarios/:id/assessments": UUID_PARAMS(["id"]),
  "/api/ecc/scenarios/:id/evidence": UUID_PARAMS(["id"]),
  "/api/ecc/scenarios/:id/relationships": UUID_PARAMS(["id"]),
  "/api/ecc/scenarios/:id/impact": UUID_PARAMS(["id"]),
  "/api/ecc/scenarios/:id/treatment": UUID_PARAMS(["id"]),
  "/api/ecc/scenarios/:id/decisions": UUID_PARAMS(["id"]),
  "/api/ecc/scenarios/:id/decision": UUID_PARAMS(["id"]),
  "/api/ecc/scenarios/:id/actions": UUID_PARAMS(["id"]),
  "/api/ecc/business-units/:id": UUID_PARAMS(["id"]),
  "/api/ecc/business-processes/:id": UUID_PARAMS(["id"]),
  "/api/ecc/actions/:id": UUID_PARAMS(["id"]),
  "/api/ecc/actions/:id/verification": UUID_PARAMS(["id"]),
  "/api/ecc/ingestion/sample-workbook/trace/:signalId": UUID_PARAMS(["signalId"]),
  "/api/ecc/policy/:id": { params: { id: PREFIXED_ID_RE.policy } },
  "/api/ecc/policy/:id/approve": { params: { id: PREFIXED_ID_RE.policy } },
  "/api/ecc/appetite/:id/approve": { params: { id: PREFIXED_ID_RE.appetite } },
};

type QueryRule =
  | { name: string; kind: "enum"; values: readonly string[] }
  | { name: string; kind: "int"; min: number; max: number };

const QUERY_RULES: Record<string, QueryRule[]> = {
  "/api/ecc/trends": [{ name: "window", kind: "enum", values: TREND_WINDOWS }],
  "/api/ecc/portfolio": [
    { name: "period_days", kind: "int", min: 1, max: 3650 },
    { name: "priority", kind: "enum", values: PRIORITY_TIERS },
    { name: "tolerance", kind: "enum", values: TOLERANCE_STATES },
    { name: "status", kind: "enum", values: SCENARIO_STATUSES },
    { name: "asset_criticality", kind: "enum", values: ASSET_CRITICALITY },
  ],
  "/api/ecc/decisions": [{ name: "status", kind: "enum", values: DECISION_STATUSES }],
  "/api/ecc/signals": [
    { name: "lifecycle", kind: "enum", values: SIGNAL_LIFECYCLES },
    { name: "limit", kind: "int", min: 1, max: 10_000 },
  ],
  "/api/ecc/scenarios": [
    { name: "status", kind: "enum", values: SCENARIO_STATUSES },
    { name: "priority", kind: "enum", values: PRIORITY_TIERS },
    { name: "tolerance_state", kind: "enum", values: TOLERANCE_STATES },
    { name: "limit", kind: "int", min: 1, max: 10_000 },
  ],
};

const GENERIC_NOT_FOUND = {
  error: { code: "not_found", message: "Resource not found." },
};

/** Malformed resource ids are 404: they cannot exist, and the body has no database text. */
export const MALFORMED_ID_STATUS = 404;

const POSTGRES_LEAK =
  /invalid input syntax|SQLSTATE|syntax error at or near|duplicate key value violates|violates (?:check|foreign key|unique) constraint|relation "[^"]+" does not exist|column "[^"]+" (?:of relation|does not exist)|operator does not exist/i;

export function isDatabaseError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { code?: unknown; severity?: unknown; routine?: unknown; cause?: unknown };
  if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) return true;
  if (typeof candidate.severity === "string" && typeof candidate.routine === "string") return true;
  if (candidate.cause && candidate.cause !== err && isDatabaseError(candidate.cause)) return true;
  const message = err instanceof Error ? err.message : "";
  return POSTGRES_LEAK.test(message);
}

function sendJson(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function queryProblem(query: Record<string, unknown>, rules: QueryRule[]): string | null {
  for (const rule of rules) {
    if (!Object.prototype.hasOwnProperty.call(query, rule.name)) continue;
    const raw = query[rule.name];
    if (typeof raw !== "string") {
      return `Invalid query parameter "${rule.name}". Expected a single value.`;
    }
    const value = raw.trim();
    if (rule.kind === "enum") {
      if (!rule.values.includes(value)) {
        return `Invalid query parameter "${rule.name}". Expected one of: ${rule.values.join(", ")}.`;
      }
      continue;
    }
    if (!/^[0-9]+$/.test(value)) {
      return `Invalid query parameter "${rule.name}". Expected an integer between ${rule.min} and ${rule.max}.`;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < rule.min || parsed > rule.max) {
      return `Invalid query parameter "${rule.name}". Expected an integer between ${rule.min} and ${rule.max}.`;
    }
  }
  return null;
}

/**
 * Route-level preHandler. No-op for routes without id or query rules.
 * Callers must register it after auth, permission, and requireRoles.
 */
export async function validateInboundRequest(req: FastifyRequest, reply: FastifyReply) {
  if (reply.sent) return;
  const routeUrl = req.routeOptions?.url;
  if (!routeUrl) return;

  const idRule = ID_RULES[routeUrl];
  if (idRule) {
    const params = req.params as Record<string, unknown>;
    for (const [name, pattern] of Object.entries(idRule.params)) {
      const value = params[name];
      if (typeof value !== "string" || !pattern.test(value)) {
        return reply.code(MALFORMED_ID_STATUS).send(GENERIC_NOT_FOUND);
      }
    }
  }

  const queryRules = QUERY_RULES[routeUrl];
  if (queryRules) {
    const message = queryProblem(req.query as Record<string, unknown>, queryRules);
    if (message) {
      return sendJson(reply, 400, "invalid_query", message);
    }
  }
}

export function databaseSafeErrorHandler(
  err: FastifyError,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  if (reply.sent) return;
  if (isDatabaseError(err)) {
    req.log.error({ err }, "database error hidden from client");
    return sendJson(reply, 500, "internal_error", "An unexpected error occurred.");
  }
  const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (statusCode >= 500) {
    req.log.error({ err }, "request failed");
  }
  return reply.code(statusCode).send(err);
}

function appendValidation(routeOptions: RouteOptions) {
  const current = routeOptions.preHandler;
  const list = current == null ? [] : Array.isArray(current) ? [...current] : [current];
  routeOptions.preHandler = [...list, validateInboundRequest];
}

/**
 * Attach per-route validation and the database-safe error handler.
 * Must be called before routes are registered so `onRoute` can append the
 * validator after each route's own preHandlers.
 */
export function installRequestValidation(app: FastifyInstance) {
  app.addHook("onRoute", (routeOptions) => {
    appendValidation(routeOptions);
  });
  app.setErrorHandler(databaseSafeErrorHandler);
}
