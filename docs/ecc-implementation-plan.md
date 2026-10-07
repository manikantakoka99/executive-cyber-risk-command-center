# ECC Implementation Plan

## Phase 0 — Discovery ✅

- Inspect repo, stack, demo gaps  
- Analyze HTML, PDFs, schema, XLSX  
- Produce `docs/ecc-*.md`  

**Acceptance:** Research docs present; A–R report deliverable.

## Phase 1 — Database + sample ingestion

**Changes:** `docker-compose.yml`, `db/schema.sql`, `db/import_sample_data.py`, `db/validate_import.py`, `.env.example`  

**Acceptance:**

- Postgres up via compose  
- Import idempotent  
- Validation report matches workbook counts + 0 FK errors  

**Risks:** Host without Docker privileges; UUID conflicts with schema seed inserts → importer truncates/reloads reference tables carefully.

## Phase 2 — Backend aggregation APIs

**Changes:** `server/` Fastify app, tenant middleware, overview/domains/findings/decisions/compliance/activity/reports/audit routes, services for KPI SQL  

**Acceptance:** `GET /overview` returns Al Dhabi metrics consistent with SQL; cross-org IDOR returns empty/403.

## Phase 3 — Overview dashboard (data-driven)

**Changes:** Replace `web` routes/shell/theme to match HTML mockup; fetch overview API; loading/empty/error  

**Acceptance:** No hardcoded 62/4.2M; org switcher works.

## Phase 4 — Domain + findings drill-downs

**Changes:** pages for domains/findings; charts from history  

**Acceptance:** Journeys J2–J3.

## Phase 5 — Executive decision workflow

**Changes:** decision detail + POST actions; optimistic UI; action timeline  

**Acceptance:** Journey J4; action_log + audit rows created.

## Phase 6 — Compliance + reporting + activity/audit

**Changes:** pages + generate board briefing  

**Acceptance:** Journey J6; report row persisted.

## Phase 7 — Security hardening + refresh

**Changes:** RBAC checks, polling, rate limit, RLS session var optional  

**Acceptance:** Non-cxo cannot approve; live timestamp accurate.

## Phase 8 — Tests

**Changes:** API tests (vitest/node), import validation script CI, tenant isolation cases, empty-state fixtures  

**Acceptance:** Documented test commands pass.

## Phase 9 — Polish + docs

**Changes:** README runbook, reload dataset instructions, UX polish  

---

## Per-phase detail (MVP execution order this sprint)

| Step | Work |
|------|------|
| 1 | Compose Postgres + schema |
| 2 | Python importer + validation |
| 3 | Fastify API + overview |
| 4 | Redesign web overview |
| 5 | Drill-downs + decisions |
| 6 | Compliance/reports/audit |
| 7 | Tests + README |

## Files planned to modify / add

**Add:** `docker-compose.yml`, `db/*`, `server/**`, `docs/ecc-*.md`, `reference/*`, root README update  

**Modify:** `web/src/**` (App routes, Shell, pages, CSS, remove demo hardcoding), `web/package.json` (proxy), `web/vite.config.ts`

**Preserve:** Prior `docs/PRD.md` etc. as historical demo docs; mark superseded by `ecc-*`.

## Risks / blockers

| Risk | Mitigation |
|------|------------|
| No local Postgres binary | Docker Compose |
| Sample Al Dhabi has 0 awaiting decisions | Empty state; org switcher to Falcon/Meridian |
| Mockup vs data mismatch | Document prominently; never hardcode mockup KPIs |
| Schema seed UUID ≠ workbook UUID | Importer replaces domains/frameworks from workbook |
| Demo auth weak | Document as local-only; RLS path ready |

## Test strategy (summary)

- Import row counts + FK script  
- Overview KPI SQL golden tests for Al Dhabi  
- Decision state machine transitions  
- Tenant isolation (org A token cannot read org B)  
- Empty: zero findings, zero awaiting, inactive domains  
- Frontend smoke: overview loads, decision action updates queue  
