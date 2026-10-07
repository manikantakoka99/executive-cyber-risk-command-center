# ECC Architecture

## 1. Current architecture (discovered)

```
executive-cyber-risk-command-center/
  docs/          # Prior PRD / ARCHITECTURE / DELIVERY (5-domain demo)
  web/           # React 19 + Vite + Recharts SPA
                 # Hardcoded demo.ts — NO backend, NO database
```

Monolithic frontend demo only. Not production multi-tenant ECC.

## 2. Recommended architecture (smallest viable)

```
┌────────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  Sample XLSX /     │────▶│  PostgreSQL 16      │◀────│  Fastify API     │
│  schema.sql seed   │     │  (Docker Compose)   │     │  /api/ecc/*      │
└────────────────────┘     │  RLS-ready schema   │     │  org context     │
                           └─────────────────────┘     └────────┬─────────┘
                                                                │
                           ┌─────────────────────┐              │
                           │  React + Vite web   │◀─────────────┘
                           │  Overview / Domains │   JSON APIs
                           │  Findings / Decis.  │
                           └─────────────────────┘
```

### Layers mapped to product flow

| Flow stage | System responsibility |
|------------|----------------------|
| Data Ingestion | Importer (MVP); future domain adapters |
| Normalization & Correlation | Persisted findings/snapshots (schema); future rules engine |
| Risk → Impact | `business_impact_assessments` + score snapshots |
| Executive Decision | `executive_decisions` + API actions |
| Closed-loop Reporting | `generated_reports`, `command_center_activity`, `audit_log` |

## 3. Stack choices

| Layer | Choice | Why |
|-------|--------|-----|
| UI | Keep React 19 + Vite + Recharts | Already in repo |
| API | Node + Fastify + `pg` | Fits ARCHITECTURE.md suggestion; lightweight |
| DB | PostgreSQL 16 via Docker Compose | Matches schema contract |
| Auth (MVP) | Demo: `X-Org-Id` + `X-User-Id` headers | Unlocks tenancy tests without IdP |
| Auth (later) | SSO + DB role `ccc_app` + `app.current_org_id` RLS | Schema already defines policies |
| Export | Server-generated Markdown/HTML stored/referenced in `generated_reports` | No new PDF stack required for MVP |
| Refresh | HTTP polling 45s + manual refresh | Simplest; WebSockets deferred |

## 4. Tenant isolation

1. API requires `X-Org-Id` (UUID of organization).  
2. All queries include `WHERE org_id = $orgId`.  
3. Decision mutations verify decision belongs to org AND actor user belongs to org.  
4. Docker init applies schema RLS; app role uses `SET LOCAL app.current_org_id` when enabled.  
5. Frontend never trusted for isolation.

## 5. Package layout

```
db/
  schema.sql                 # supplied contract (copied)
  import_sample_data.py      # idempotent XLSX → PG
  validate_import.py         # row counts + FK checks
docker-compose.yml
server/
  package.json
  src/index.ts
  src/db.ts
  src/middleware/tenant.ts
  src/routes/*.ts
  src/services/*.ts
web/                         # existing SPA, redesigned routes
reference/                   # authoritative source materials
docs/ecc-*.md                # this R&D set
```

## 6. Why not rewrite / microservices

- Existing React app is suitable; only data layer and IA need replacement.  
- Single API process is enough for demo/pilot load.  
- Kubernetes adds ops cost with zero product value at this stage.

## 7. Environment

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection |
| `PORT` | API port (default 4000) |
| `CORS_ORIGIN` | Vite origin |
| `DEMO_AUTH` | `true` enables header-based demo auth |

## 8. Security baseline (MVP)

- Parameterized SQL only  
- Input validation (zod) on decision actions  
- Audit every decision mutation  
- No secrets in frontend  
- Rate-limit decision POSTs lightly  
- Sanitize JSONB display  

## 9. Operational modes

| Mode | Description |
|------|-------------|
| Local demo | compose up + import + API + Vite |
| Workshop | Seeded sample; org switcher across 5 tenants |
| Pilot | Replace demo auth; wire 1–3 live feeds (future) |
