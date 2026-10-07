# ECC Production-Readiness Review

**Date:** 2026-10-05  
**Scope:** Hardening pass on existing ECC (no architecture rewrite)

---

## Source-material alignment

| Source intent | Status |
|---------------|--------|
| Aggregation layer above 12 domains (not a replacement) | **Aligned** — domains are scored feeds; no SOC/IR tooling |
| Risk → Impact → Decision → Action → Closed loop | **Aligned** — overview RIDA chain, mutations → action_log + activity + audit |
| Schema / ERD entities | **Aligned** — no invented relationships |
| Sample workbook as SoR for KPIs | **Aligned** — no hardcoded HTML mockup numbers |
| HTML visual language | **Preserved & improved** — dark density, severity accents; decisions elevated |

**Deviation noted (not changed):** Domain UUIDs are shared catalog across tenants. Org A can open the same `risk_domain_id` as Org B, but findings/snapshots/decisions remain org-filtered. This is schema-correct, not a data leak.

---

## A. Functional issues discovered

1. Overview decision queue was strong but lacked vertical R→I→D→A explanation and compliance-impact field.
2. Domain detail lacked linked decisions, exposure rollup, and domain activity.
3. Compliance / Reports / Audit pages did not reload on org switch (stale cross-tenant UI risk).
4. Header implied “live” without clarifying polling.
5. Role permissions existed server-side but were weakly visible in UI.
6. Board briefing omitted recent activity section.

## B. Security issues discovered

1. **P0 false alarm clarified:** cross-org domain GET returning 200 is because domains are shared reference data; findings do not leak (verified by test).
2. Finding/decision/report isolation: **OK** (404 / scoped lists).
3. Analyst approve blocked: **OK** (403).
4. Missing headers: **OK** (401). Wrong org/user pair: **OK** (403).
5. Demo auth remains header-based (documented limitation — not SSO).

## C. UX issues discovered / fixed

1. Decisions section elevated above domain grid; stronger visual emphasis.
2. Explicit RIDA chain on overview cards.
3. Inline Approve / Request More Information with busy lock + success/error feedback.
4. Role chip + non-CXO messaging.
5. Freshness copy: `Updated … · polled` / `Refreshing…` / `Data unavailable`.
6. Decision status badges on Decisions list.
7. Richer empty states (zero awaiting is valid).
8. Focus-visible styles for keyboard users.
9. Trend chart accessible summary (`aria-label` / sr-only).

## D. Data / KPI issues

| KPI | Source | Verdict |
|-----|--------|---------|
| Enterprise score | latest `enterprise_risk_score_snapshots` | OK |
| Exposure | sum open-finding impacts AED | OK |
| Compliance % | avg latest `org_compliance_status` | OK |
| Awaiting CXO | count `status=awaiting_decision` only | OK; list matches count |
| Risk by domain | latest `domain_risk_snapshots` | OK |
| Trend | enterprise snapshots ASC | OK |
| Hardcoded mockup values | none | OK |

Org switch verified: Al Dhabi (0 awaiting), Falcon (2), Burj (1).

## E. Performance issues

1. Overview remains a single aggregated endpoint (good).
2. Domain detail now issues a few extra queries (decisions/activity) — acceptable at sample scale; no N+1 loops.
3. Polling every 45s — adequate; no WebSockets added.
4. No Redis/Kafka introduced.

## F. Changes implemented

- `server/src/services/overview.ts` — compliance scope on pending decisions
- `server/src/services/catalog.ts` — domain decisions/activity/exposure; report activity section
- `server/src/security.test.ts` — isolation + workflow + audit tests
- `web` Overview / Shell / Domain detail / Decisions / Compliance / Reports / Audit
- CSS: RIDA chain, focus, role chip, decision emphasis, success banner
- Docs: this review

## G. Tests executed

| Suite | Result |
|-------|--------|
| `tsx --test src/overview.test.ts src/security.test.ts` | **6/6 pass** |
| `db/e2e_must_have_flow.py` | **PASS** |
| `db/validate_import.py` (after reset) | **PASS** |
| `web` `tsc -b` | **PASS** |
| `web` `npm run build` | **PASS** |

## H. Remaining limitations

- Demo auth via `X-Org-Id` / `X-User-Id` (not production IdP)
- Postgres RLS policies exist but app connects as DB owner (bypasses RLS); API filters are the active control
- Sample `compliance_scope_impact` often null — UI shows when present
- Al Dhabi has zero awaiting decisions by design of sample data
- Historical imported reports have no local markdown body files
- Decline/Close remain on decision detail (intentionally not on overview primary actions)
- No dedicated `/activity` page (overview panel only)

## I. Recommended next phase

1. Wire real SSO + set `app.current_org_id` + connect as `ccc_app` (enforce RLS)
2. Live feed adapters for 1–3 domains (ingestion only; keep aggregation layer)
3. Risk appetite config table (replace env default 50)
4. Decision SLA / aging views for board packs
5. PDF board briefing export
6. Playwright UI smoke across org switch + approve
