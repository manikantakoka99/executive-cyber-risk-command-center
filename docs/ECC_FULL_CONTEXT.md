# ECC Full Context Pack

Self-contained handoff for continuing the Executive Cyber Risk Command Center (YVI DWAN).  
No GitHub dependency — copy this file into Documents / Claude / Cursor as needed.

**Product name:** YVI DWAN Executive Cyber Risk Command Center (ECC)  
**Snapshot anchor (command model):** 5 Sep 2026  
**Default demo tenant:** Al Dhabi Holdings (`2accc7de-f693-4b19-8fe8-6db501be05e2`)  
**Currency for modelled loss:** AED millions per year

---

# Part A — Product intent

ECC is an **executive insight & narrative control plane**, not a replacement for scanners/SIEMs.

Flow:

```
Upstream tools / workbook
  → Ingest & normalize
  → Correlate into risk scenarios
  → Score domains + enterprise
  → Business impact
  → Decision / treatment / verification
  → Board narrative & reports
```

It aggregates **12 YVI security domains** into Risk → Impact → Decision → Action.

There are **two parallel data paths** today (critical to understand):

| Path | What powers it | Needs Postgres? |
|------|----------------|-----------------|
| **Command center** UI at `/c/:view` | In-memory reference model in `server/src/command/` | **No** |
| **Workspace / ops** pages (`/operations`, domains, findings, scenarios, …) | PostgreSQL + sample workbook import | **Yes** |

Command center can demo without DB. Ops pages show empty/errors until Postgres is seeded.

---

# Part B — Runtime architecture

```
┌────────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  Sample XLSX /     │────▶│  PostgreSQL 16      │◀────│  Fastify API     │
│  schema + migrate  │     │  Docker :5433       │     │  :4000 /api/ecc/*│
└────────────────────┘     │  (or Supabase)      │     │  org + user hdrs │
                           └─────────────────────┘     └────────┬─────────┘
                                                                │
                           ┌─────────────────────┐              │
                           │  React 19 + Vite    │◀─────────────┘
                           │  :5173 (proxy /api) │
                           │  Command + Workspace│
                           └─────────────────────┘
```

## Stack

| Layer | Choice |
|-------|--------|
| UI | React 19, Vite, React Router, Recharts, framer-motion, lucide-react |
| API | Node, Fastify, `pg`, zod |
| DB | PostgreSQL 16 (Docker Compose or Supabase) |
| Auth (MVP) | Demo headers `X-Org-Id` + `X-User-Id` (`DEMO_AUTH=true`) |
| Auth (later) | SSO + DB role + RLS `app.current_org_id` |
| Package layout | `web/`, `server/`, `db/`, `docs/`, `reference/` |

## Environment variables (`.env`)

| Variable | Default / purpose |
|----------|-------------------|
| `DATABASE_URL` | `postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center` |
| `PORT` | `4000` |
| `CORS_ORIGIN` | `http://localhost:5173` |
| `DEMO_AUTH` | `true` |
| `DEFAULT_RISK_APPETITE` | `50` |
| `DEFAULT_ORG_ID` | Al Dhabi Holdings UUID |
| `SUPABASE_DB_URL` | Optional alias for migrate script |

Supabase hosts (`*.supabase.co`) get SSL automatically in `server/src/db.ts`.

## Local bring-up (Fedora / docker-compose.yml)

```bash
cp .env.example .env
docker compose up -d db       # service `db` → localhost:5433 (schema + tenant seed on first boot)
docker compose exec -T db pg_isready -U ecc -d cyber_command_center
cd server && npm install && npm run demo:seed && npm run dev   # :4000  GET /health
cd web && npm install && npm run dev                           # :5173  proxies /api → :4000
```

Optional Excel import (not required for demo login):

```bash
python3 -m venv .venv-ecc
.venv-ecc/bin/pip install psycopg2-binary openpyxl
.venv-ecc/bin/python db/import_sample_data.py --reset
.venv-ecc/bin/python db/validate_import.py
```

Supabase cutover (when URI available):

```bash
# set DATABASE_URL to Supabase URI (?sslmode=require)
.venv-ecc/bin/python db/migrate_to_supabase.py --import-sample --reset
```

---

# Part C — Database

## How schema is applied

Docker Compose mounts, in order:

1. `db/schema.sql` — MVP core (orgs, users, domains, findings, decisions, compliance, audit)
2. `db/migrations/001_ecc_v2_foundation.sql` — RBAC tables, assets, connectors, signals, scenarios, controls, assessments, policies, actions, verifications
3. `002_ecc_connector_signal_framework.sql` — signal catalog / lifecycle
4. `003_ecc_correlation_risk_engine.sql` — correlation events, tolerance/velocity/priority types
5. `004_ecc_executive_closed_loop.sql` — treatment plans, recommendations, scenario impacts
6. `005_ecc_enterprise_intelligence.sql` — org settings, material changes, report lifecycle
7. `006_ecc_sample_ingestion_proof.sql` — sample workbook run tracking
8. `007_ecc_command_rbac.sql` — demo roles (`soc_analyst`, `org_admin`) + command permission seed rows

**Important:** Command-center **enforcement** lives in TypeScript (`server/src/command/rbac.ts`), not only in DB `role_permissions`. DB rows keep the directory consistent.

## Core MVP tables (`schema.sql`)

| Group | Tables |
|-------|--------|
| Tenancy | `organizations`, `users` |
| Domains | `risk_domains`, `org_domain_subscriptions` |
| Scores | `domain_risk_snapshots`, `enterprise_risk_score_snapshots` |
| Findings / impact | `risk_findings`, `business_impact_assessments` |
| Decisions | `executive_decisions`, `decision_action_log` |
| Compliance | `compliance_frameworks`, `org_compliance_status` |
| Activity / reports / audit | `command_center_activity`, `generated_reports`, `audit_log` |

## Domain enum (12)

```
soc_mdr, iam_pam, cspm_cnapp, ransomware_readiness, vapt_asm,
phishing_bec, compliance_engine, pci_dss, ot_ics, ai_governance,
third_party_risk, vciso
```

Display names (seed):

| code | short label |
|------|-------------|
| `vapt_asm` | Attack Surface (VAPT/ASM) |
| `soc_mdr` | SOC / MDR |
| `third_party_risk` | Third-Party Risk |
| `ransomware_readiness` | Ransomware Readiness |
| `pci_dss` | PCI DSS / Data Trust |
| `ai_governance` | AI Governance |
| `iam_pam` | IAM / PAM |
| `phishing_bec` | Phishing / BEC |
| `vciso` | vCISO / Cyber CoE |
| `cspm_cnapp` | Cloud (CSPM/CNAPP) |
| `compliance_engine` | Compliance Engine |
| `ot_ics` | OT / ICS Security |

## Compliance frameworks (seed)

`dubai_isr`, `pci_dss_v4`, `iso_27001`, `nesa_uae_ia`, `gdpr`

## V2+ tables (migrations) — major groups

| Group | Tables |
|-------|--------|
| RBAC | `roles`, `permissions`, `role_permissions`, `user_roles`, `v_user_primary_role` |
| Business context | `business_units`, `business_processes`, `assets`, `asset_identifiers`, `asset_relationships`, `asset_business_processes` |
| Connectors | `connectors`, `connector_sync_runs` |
| Ingestion | `raw_events`, `security_signals`, signal catalogs / lifecycle |
| Scenarios | `risk_scenarios`, `risk_scenario_*` M2M tables |
| Controls / assessment | `controls`, `scenario_controls`, likelihood/impact/risk assessments, policies, tolerance rules |
| Closed loop | `evidence`, `actions`, `risk_verifications`, `treatment_plans`, `risk_recommendations`, `scenario_business_impacts` |
| Intelligence | `org_settings`, `material_changes` |
| Meta | `schema_migrations`, `sample_workbook_runs` |

Rough inventory: **~61 tables** after all migrations.

## Tenancy / RLS

1. Tenant entities carry `org_id`.
2. Composite FKs block cross-tenant links where possible.
3. RLS + FORCE on many tenant tables using session `app.current_org_id`.
4. Docker role `ecc` is owner and **bypasses RLS**; API still filters `WHERE org_id = $orgId` (defense in depth).
5. Production should use a non-owner app role (`ccc_app` pattern) with RLS enforced.

## Sample workbook → tables

Source workbook: `reference/CyberCommandCenter_Sample_Data.xlsx`  
Importer: `db/import_sample_data.py`  
Validator: `db/validate_import.py`

| Excel sheet | Table |
|-------------|-------|
| organizations | `organizations` (5 UAE demo tenants) |
| users | `users` |
| risk_domains | `risk_domains` (prefer workbook UUIDs) |
| org_domain_subscriptions | 12×5 subscriptions |
| domain_risk_snapshots | ~6 months × domains × orgs |
| enterprise_risk_score_snapshots | 6 per org |
| risk_findings | findings |
| business_impact_assessments | 1:1 with findings in sample |
| executive_decisions | links finding + impact |
| decision_action_log | history |
| compliance_frameworks / org_compliance_status | frameworks |
| command_center_activity | feed |
| generated_reports | board_briefing / regulator_submission |
| audit_log | mostly app-populated |

**Import order:** orgs → users → domains → frameworks → subscriptions → domain snapshots → enterprise snapshots → findings → impacts → decisions → action log → compliance status → activity → reports.

### Sample numbers (Al Dhabi Holdings — DB path)

These are **DB-derived**, not the HTML mock numbers:

| Metric | Approx value |
|--------|--------------|
| Latest enterprise score | **42.83** (medium) |
| MoM | 45.33 → 42.83 (−2.5) |
| Open exposure | ≈ AED 5.10M |
| Avg compliance | ~80% |
| Highest domains | Attack Surface 76, SOC/MDR 72, Third-Party 65 |

Command-center **reference model** uses different illustrative scores (e.g. enterprise arithmetic ~50.x with Critical domains) — do not force them to match the DB until someone wires them together.

## Relationship graph (MVP)

```
organizations ─┬─ users
               ├─ org_domain_subscriptions ─ risk_domains
               ├─ domain_risk_snapshots ──── risk_domains
               ├─ enterprise_risk_score_snapshots
               ├─ risk_findings ─┬─ business_impact_assessments
               │                 └─ executive_decisions ─ decision_action_log
               ├─ org_compliance_status ─ compliance_frameworks
               ├─ command_center_activity
               ├─ generated_reports
               └─ audit_log
```

V2 extends with assets → signals → scenarios → assessments → treatment → verification.

---

# Part D — API surface

Health: `GET /health`

## Directory / me

- `GET /api/ecc/organizations`
- `GET /api/ecc/organizations/:orgId/users`
- `GET /api/ecc/me` — role, permissions, landing, home, capability

Auth headers on protected routes: `X-Org-Id`, `X-User-Id`.

## Command center (in-memory; no DB required)

- `GET /api/ecc/command/workspace`
- `GET /api/ecc/command/domains/:id` — evidence drawer payload
- `POST /api/ecc/command/queue/:id/approve|defer|reopen|accept`
- `POST /api/ecc/command/whatif` (+ save scenario, convert to decision)
- `POST /api/ecc/command/fixes/:id/verify`
- `POST /api/ecc/command/acceptances/:id/renew|revoke`
- `POST /api/ecc/command/pack/review`
- Admin role assign helpers under command/directory routes

## Ops / intelligence (DB)

Overview, risk-domains, findings, decisions (+ act), compliance, activity, audit, reports, connectors, raw-events, signals, scenarios (+ recalculate, correlate, impact, treatment, actions, verify), portfolio, trends, hotspots, decision-center, controls posture, business-units, demo seed/verify/hero.

---

# Part E — Command center model (reference scoring)

**Code:** `server/src/command/model.ts`, `store.ts`, `present.ts`, `rbac.ts`, `personas.ts`

## 12 domains in the reference model

| id | Name | CSF | raw (example) | coverage | weight | appetite |
|----|------|-----|---------------|----------|--------|----------|
| att | Attack Surface and VAPT | Identify, Protect | 76 | 0.7 | 1.5 | 40 |
| soc | SOC / MDR | Detect, Respond | 72 | 0.8 | 1.3 | 45 |
| tpr | Third-Party Risk | Govern, Identify | 65 | 0.6 | 1.3 | 50 |
| ran | Ransomware Readiness | Protect, Recover | 54 | 0.8 | 1.4 | 40 |
| pci | PCI DSS / Data Security | Protect | 50 | 0.9 | 1.5 | 35 |
| ai | AI Security and Governance | Govern, Protect | 47 | 0.5 | 0.8 | 55 |
| iam | IAM / PAM | Protect | 40 | 0.85 | 1.2 | 45 |
| phi | Phishing / BEC | Protect | 29 | 0.9 | 1.0 | 40 |
| gov | vCISO / Cyber CoE | Govern | 22 | 1.0 | 0.6 | 45 |
| cld | Cloud Security / CSPM | Protect | 21 | 0.75 | 1.0 | 40 |
| cmp | Continuous Compliance | Lens | 21 | 1.0 | 0.8 | 40 |
| ot | OT / ICS Security | Protect, Detect | 17 | 0.4 | 0.4 | 50 |

## Formulas (illustrative)

- **Adjusted score** blends raw with coverage and unobserved assumption (`UNOBSERVED_ASSUMPTION = 60`).
- **Band:** Critical ≥70, High ≥55, Medium ≥35, else Low.
- **Enterprise arithmetic:** weighted average of adjusted scores.
- **Floor rule:** if any domain is Critical and arithmetic band would be Medium/Low, headline is raised to **`FLOOR_BAND = "High"`** (not Critical). UI copy still explains floor application.
- **Appetite:** Outside if adjusted > limit; Approaching near limit; else Within.
- **Loss scenarios:** keyed by domain id; ALE / P90 / P95 in AED M/year; gated by permission `command.loss`.
- **What-if gaps:** `edr`, `siem`, `imm`, `dr` (ransomware category weights).

## 8 command views

| id | Route | Question | Typical landing |
|----|-------|----------|-----------------|
| headline | `/c/headline` | Are we OK? | Board |
| posture | `/c/posture` | Where are we weakest? | CISO |
| trust | `/c/trust` | Can I believe the numbers? | Analyst |
| queue | `/c/queue` | What needs my decision? | CxO / SOC |
| whatif | `/c/whatif` | What if we fund X? | CxO |
| closure | `/c/closure` | Did the fix stick? | Risk lead |
| changed | `/c/changed` | What changed since last board? | Board / auditor |
| pack | `/c/pack` | Board pack | Board / program office |

Session state (queue actions, acceptances, what-if saves) is **in-memory per org** in `store.ts` — resets on API restart.

---

# Part F — RBAC

**Source of truth for enforcement:** `server/src/command/rbac.ts`  
UI consumes `me.permissions` and `<Permit permission="…">`.

## Role codes

`ciso`, `cxo`, `board_member`, `security_analyst`, `soc_analyst`, `risk_manager`, `org_admin`, `super_admin`, `platform_admin`, `compliance_manager`, `program_office`, `domain_analyst`, `auditor`, `business_owner`

## Permission codes (examples)

Command: `command.headline`, `command.posture`, `command.posture.technical`, `command.trust`, `command.loss`, `command.queue`, `command.queue.act`, `command.whatif`, `command.whatif.save`, `command.closure`, `command.closure.verify`, `command.closure.register`, `command.changed`, `command.pack`, `command.pack.review`

Ops: `ops.overview`, `domains.read`, `domains.technical`, `findings.read`, `findings.technical`, `decisions.read`, `decisions.act`, `compliance.read`, `reports.read`, `reports.generate`, `audit.read`, `ingestion.read`, `scenarios.read`, `scenarios.act`, `admin.users`, `admin.roles`

## Notable restrictions

| Role | Can | Cannot |
|------|-----|--------|
| Board | headline, posture (non-tech), loss, changed, pack | queue act, technical evidence |
| CxO | queue act, what-if save, loss, pack review | feed-level technical trust depth |
| CISO | full technical + most command views | — (broad access) |
| Security analyst | posture technical, trust, verify | loss, queue act |
| SOC analyst | queue **view**, verify | `command.queue.act` (Approve disabled) |
| Org admin | users/roles admin | cyber decision content |

## Demo personas (Al Dhabi)

IDs: `c1500001-a090-41a0-8ecc-0000000000{suffix}`

| suf | Name | Role | Home |
|-----|------|------|------|
| 01 | Layla Al Hashimi | ciso | `/c/posture` |
| 02 | Omar Al Mansoori | cxo CEO | `/c/queue` |
| 03 | Fatima Al Nuaimi | cxo CFO | `/c/queue` |
| 04 | Khalid Al Suwaidi | cxo CIO | `/c/queue` |
| 05 | Mariam Al Dhaheri | cxo COO | `/c/queue` |
| 06 | Hessa Al Ketbi | board_member | `/c/headline` |
| 07 | Yusuf Rahman | security_analyst | `/c/trust` |
| 08 | Aisha Khan | soc_analyst | `/c/queue` |
| 09 | Nadia Farouk | org_admin | `/admin` |
| 0a | Rashid Al Maktoum | risk_manager | `/c/closure` |
| 0b | Sara Ibrahim | compliance_manager | `/c/headline` |
| 0c | James Okoye | auditor | `/c/changed` |

Directory merges DB users + personas (`server/src/command/directory.ts`).

---

# Part G — Frontend structure

```
web/src/
  App.tsx                 routes + Permit gates
  design.css              premium tokens (dark default + light)
  command.css             shell + command chrome
  index.css               older ops-page styles (still used)
  components/Shell.tsx    collapsible sidebar, ⌘K palette, theme, role chip
  components/icons.tsx
  pages/command/
    CommandCenter.tsx
    views.tsx             all 8 views
    bits.tsx              KPI, gauge, heatmap, spark, count-up
  pages/*                 ops pages (Overview, Domains, Findings, …)
  context/AppState.tsx    org/user/me + localStorage
  context/Theme.tsx       data-theme
  lib/api.ts
```

## UI design direction (already implemented)

- Dark-first Linear × Wiz style console
- Inter + Outfit + IBM Plex Mono
- Cyan/indigo accents; semantic risk colors
- Collapsible icon sidebar, command palette (Ctrl/Cmd+K), theme toggle
- KPI cards with sparklines/deltas/count-ups; risk gauge; domain heatmap; Recharts area/donut
- Role density: Board storytelling, CxO impact, CISO dense tables
- **DEMO strip under top bar was removed** — do not re-add unless product asks

Ops pages are **not fully restyled** to the new system yet.

---

# Part H — Closed-loop / intelligence concepts (DB-backed)

Implemented conceptually in migrations + API services:

1. **Signals** normalize raw connector events  
2. **Correlation** groups into `risk_scenarios`  
3. **Assessments** store likelihood / impact / inherent / residual  
4. **Tolerance** marks within / near / outside  
5. **Recommendations & treatment plans** (mitigate / transfer / avoid / accept / monitor)  
6. **Actions** (work items) vs `decision_action_log` (click audit)  
7. **Verification** closes the loop  
8. **Material changes / portfolio / hotspots** for executive intelligence  

Sample workbook ingestion proof tables track import runs.

---

# Part I — What is done vs open

## Done

- Command center 8 views + scoring + floor rule + queue/what-if/closure/pack  
- RBAC on API + UI + personas  
- Postgres schema v1 + migrations 001–007  
- Sample workbook import + validation  
- Ops APIs for overview/domains/findings/decisions/compliance/scenarios/…  
- Premium UI redesign for Shell + command views + login  
- Supabase migration script prepared  
- DEMO banner removed  

## Open / recommended next

1. Restyle remaining **Workspace** pages to the new design system  
2. **Unify** command reference model with live DB scores (single source of truth)  
3. Complete **Supabase** hosting with real `DATABASE_URL`  
4. Replace demo headers with **SSO** (keep `rbac.ts` matrix)  
5. Productize admin role editing (`setRoleOverride` exists)  
6. Bundle size / code-split command charts  
7. Accessibility pass on palette + tables  
8. Wire more live connectors beyond sample workbook  

## Do not regress

- Floor rule behavior (`FLOOR_BAND` / Critical domain lift)  
- Permission redaction (loss, technical columns, queue.act)  
- Role landings  
- Org-scoped SQL filters  
- Demo sign-in without passwords (until SSO)

---

# Part J — Key file index

| Concern | Path |
|---------|------|
| DB schema MVP | `db/schema.sql` |
| Migrations | `db/migrations/001…007_*.sql` |
| Import / validate | `db/import_sample_data.py`, `db/validate_import.py` |
| Supabase migrate | `db/migrate_to_supabase.py` |
| Docker DB | `docker-compose.yml` |
| API entry | `server/src/index.ts` |
| DB pool | `server/src/db.ts` |
| Command RBAC | `server/src/command/rbac.ts` |
| Command model | `server/src/command/model.ts` |
| Command state | `server/src/command/store.ts` |
| Command present | `server/src/command/present.ts` |
| Personas | `server/src/command/personas.ts` |
| Command routes | `server/src/command/routes.ts` |
| Shell / design | `web/src/components/Shell.tsx`, `design.css`, `command.css` |
| Command UI | `web/src/pages/command/*` |
| Reference HTML / Excel | `reference/` |
| Architecture docs | `docs/ecc-architecture.md`, `docs/ecc-database-v2.md`, `docs/ecc-data-mapping.md`, `docs/ARCHITECTURE.md` |

---

# Part K — Glossary

| Term | Meaning |
|------|---------|
| ECC | Executive Cyber Risk Command Center |
| Command center | 8-view executive surface `/c/*` (reference model) |
| Workspace | DB-backed operational pages |
| Floor rule | Critical domains lift a Medium/Low arithmetic headline to High |
| Appetite | Board score limit per domain |
| ALE | Annualised loss expectancy (modelled) |
| Persona | Seeded demo user with fixed role |
| RLS | Postgres row-level security by `org_id` |
| Closed loop | Decision → action → verification → feedback |

---

# Part L — Paste-ready prompt for the next agent

```
Continue the YVI DWAN Executive Cyber Risk Command Center.

Read docs/ECC_FULL_CONTEXT.md (or the pasted full context).

Critical facts:
- Two data paths: command center = in-memory model (server/src/command/*);
  workspace/ops = PostgreSQL. Do not assume they share scores yet.
- RBAC enforcement source of truth: server/src/command/rbac.ts
- Floor rule: FLOOR_BAND is "High" when Critical domains exist and arithmetic is Medium/Low
- DEMO strip under the top bar was removed
- UI direction: dark-first Linear×Wiz; design.css + command.css
- Default org Al Dhabi Holdings; demo auth via X-Org-Id + X-User-Id

Suggested next work: restyle ops pages OR wire command scores to DB OR finish Supabase.
Run server tests and web build after changes.
```

---

*End of context pack.*
