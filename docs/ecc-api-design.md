# ECC API Design

Base path: `/api/ecc`  
Auth (MVP demo): headers `X-Org-Id`, `X-User-Id`  
All tenant resources filter by `X-Org-Id`.

## Conventions

- JSON only  
- Errors: `{ "error": { "code": "...", "message": "..." } }`  
- Timestamps ISO-8601 UTC  
- Money fields: number (AED) + optional `currency: "AED"`  
- Lists support `?status=&severity=&limit=&offset=`

## Endpoints

### Tenancy

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/ecc/organizations` | List demo orgs (id, name, industry) |
| GET | `/api/ecc/me` | Current user in org context |

### Overview (aggregated)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/ecc/overview` | Single payload for command home |

`overview` response (conceptual):

```json
{
  "org": { "orgId": "...", "name": "Al Dhabi Holdings" },
  "asOf": "2026-09-05T11:51:03.516Z",
  "enterpriseRisk": {
    "score": 42.83,
    "severity": "medium",
    "driverSummary": "...",
    "deltaVsPrior": -2.5,
    "priorScore": 45.33
  },
  "businessImpactExposureAed": 5097989.63,
  "compliancePosturePct": 80.0,
  "decisionsAwaitingCxo": 0,
  "criticalFindingsOpen": 2,
  "domainsMonitored": 12,
  "domains": [ { "riskDomainId": "...", "shortLabel": "...", "score": 76, "severity": "critical", "headlineDetail": "..." } ],
  "pendingDecisions": [ /* awaiting_decision (+ optional info_requested) */ ],
  "compliance": [ { "framework": "Dubai ISR", "coveragePct": 83, ... } ],
  "riskTrend": [ { "snapshotAt": "...", "score": 41.17, "severity": "medium" } ],
  "activity": [ { "summary": "...", "occurredAt": "...", "activityType": "..." } ]
}
```

### Domains

| Method | Path |
|--------|------|
| GET | `/api/ecc/risk-domains` |
| GET | `/api/ecc/risk-domains/:id` |

Detail includes score history, open findings, linked impacts.

### Findings

| Method | Path |
|--------|------|
| GET | `/api/ecc/findings` |
| GET | `/api/ecc/findings/:id` |

### Decisions

| Method | Path |
|--------|------|
| GET | `/api/ecc/decisions` |
| GET | `/api/ecc/decisions/:id` |
| POST | `/api/ecc/decisions/:id/approve` |
| POST | `/api/ecc/decisions/:id/request-info` |
| POST | `/api/ecc/decisions/:id/decline` |
| POST | `/api/ecc/decisions/:id/close` |

Body: `{ "notes": "optional string" }`  
Effects: update `executive_decisions.status`, set `decided_by`/`decided_at` when terminal, insert `decision_action_log`, insert `audit_log`, insert `command_center_activity`.

RBAC: only `cxo` (MVP also allow `program_office` for request-info) may mutate; others 403.

### Compliance / Activity / Reports / Audit

| Method | Path |
|--------|------|
| GET | `/api/ecc/compliance` |
| GET | `/api/ecc/activity` |
| GET | `/api/ecc/reports` |
| POST | `/api/ecc/reports/generate` |
| GET | `/api/ecc/reports/:id` |
| GET | `/api/ecc/audit` |

`POST /reports/generate` body: `{ "reportType": "board_briefing" | "regulator_submission" }`  
Server builds narrative from current overview aggregates, stores row + `file_url` (local path or `/api/ecc/reports/:id/content`).

## Why aggregated overview

Prevents N+1 chatty UI and keeps KPI logic server-side (single source of truth with tests).

## Versioning

Unversioned `/api/ecc` for MVP; add `/v1` when external consumers appear.
