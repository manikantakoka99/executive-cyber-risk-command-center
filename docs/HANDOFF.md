# ECC Command Center — Teammate Handoff

**Purpose:** Give another engineer (or Claude / Cursor / any agent) enough context to continue from this branch without rediscovering the product, RBAC model, UI redesign, or open work.

**Last updated:** 2026-10-13  
**Branch:** `cursor/ecc-command-rbac-a090`  
**Base:** `master`  
**PR:** https://github.com/manikantakoka99/executive-cyber-risk-command-center/pull/1  
**Repo:** `manikantakoka99/executive-cyber-risk-command-center`

---

## 1. What this product is

**YVI DWAN Executive Cyber Risk Command Center (ECC)** — a data-backed executive console that aggregates **12 security domains** into Risk → Impact → Decision → Action.

There are two related surfaces:

| Surface | Source of truth | Needs Postgres? |
|--------|------------------|-----------------|
| **Command center** (`/c/:view`) | In-memory reference model in `server/src/command/` (sample snapshot **5 Sep 2026**, Al Dhabi Holdings) | **No** — works without DB |
| **Workspace / ops pages** (`/operations`, domains, findings, scenarios, etc.) | PostgreSQL + sample workbook import | **Yes** |

Demo auth is header-based: `X-Org-Id` + `X-User-Id` (no passwords). Production intent is SSO.

Authoritative product docs live under `docs/ecc-*.md` and `reference/`. Older `docs/PRD.md` described a 5-domain sales prototype — do not treat it as current.

---

## 2. Current branch status (what shipped)

Latest commits on this PR branch (newest first):

1. `8ac0064` — Drop unused demo-strip styles  
2. `77d1bc2` — Remove DEMO sample-snapshot banner from shell/command views  
3. `a8df2a5` — Premium Linear×Wiz UI redesign  
4. `442489b` — Auto SSL for Supabase `DATABASE_URL` hosts  
5. `af5f079` — Supabase migration path  
6. `7af21df` — Record migration `007_ecc_command_rbac`  
7. `a1a447e` — Executive command center + RBAC  

### Delivered capabilities

- Reference HTML command center replicated into the TypeScript app (8 views)
- Coverage-adjusted scoring + **Critical-domain floor rule**
- Decision queue, what-if, closure/acceptances, board pack
- **RBAC on API + UI** (permissions, view filtering, payload redaction)
- Demo personas for Al Dhabi Holdings
- Premium dark/light UI redesign (design system, Shell, KPIs, charts, motion)
- DEMO strip banner **removed** (do not reintroduce unless product asks)
- Supabase migration helper prepared (needs real credentials to run)

---

## 3. How to run locally

```bash
# DB (Docker default → localhost:5433)
docker compose up -d

# Sample data
python3 -m venv .venv-ecc
.venv-ecc/bin/pip install psycopg2-binary openpyxl
.venv-ecc/bin/python db/import_sample_data.py --reset
.venv-ecc/bin/python db/validate_import.py

# Env
cp .env.example .env   # DATABASE_URL points at :5433 by default

# API
cd server && npm install && npm run dev   # :4000

# Web (proxies /api → :4000)
cd web && npm install && npm run dev      # :5173
```

Open http://127.0.0.1:5173 and pick a persona (no password).

**Tests:**

```bash
cd server && npm test
cd web && npm run build
```

**Supabase (optional):** set `DATABASE_URL` to Supabase Postgres URI, then:

```bash
.venv-ecc/bin/python db/migrate_to_supabase.py --import-sample --reset
```

SSL for `*.supabase.co` is automatic in `server/src/db.ts`. Migration was **prepared but not completed** in the agent environment (waiting on project credentials / egress).

---

## 4. Architecture map

```
web/                         Vite + React 19 + React Router
  src/
    App.tsx                  Routes + permission gates
    design.css               Premium design tokens (dark/light)
    command.css              Shell + command-center chrome
    index.css                Legacy ops-page styles (still used)
    components/
      Shell.tsx              Collapsible sidebar, topbar, ⌘K palette, theme/role
      icons.tsx              Lucide nav icon map
    pages/command/
      CommandCenter.tsx      Loads workspace, tabs, actions
      views.tsx              Headline / Posture / Trust / Queue / What-if / …
      bits.tsx               KPI, gauge, heatmap, spark, count-up, chips
    context/AppState.tsx     Org/user/me, demo auth headers
    context/Theme.tsx        data-theme dark|light
    lib/api.ts               Fetch wrappers

server/
  src/
    index.ts                 Fastify app, ops APIs, tenant middleware
    db.ts                    Postgres pool (+ Supabase SSL)
    command/
      rbac.ts                Roles, permissions, landings, capability copy
      personas.ts            Seeded demo users + DEMO_ORG_ID
      model.ts               Scoring, floor rule, loss model
      store.ts               In-memory session state per org
      present.ts             Role-aware DTO shaping / redaction
      routes.ts              /api/ecc/command/*
      directory.ts           Org/user directory merge (DB + personas)
      access.test.ts         RBAC tests
      model.test.ts          Scoring tests

db/
  migrations/001…007_*.sql   Schema evolution (007 = command RBAC)
  import_sample_data.py
  migrate_to_supabase.py
  validate_import.py

reference/                   Original HTML mock + Excel + ERD assets
```

### Auth / tenancy

- Client stores `ecc.orgId` / `ecc.userId` in `localStorage`
- Every API call sends `X-Org-Id` + `X-User-Id`
- Server resolves role from persona override or DB user row
- `requirePermission` / role checks on routes; UI also filters nav + wraps routes in `<Permit permission="…">`

Default org: `2accc7de-f693-4b19-8fe8-6db501be05e2` (**Al Dhabi Holdings**).

---

## 5. Command views (8)

| View id | Route | Question framing | Typical landing roles |
|--------|-------|------------------|------------------------|
| `headline` | `/c/headline` | Are we OK? | Board, compliance, admins |
| `posture` | `/c/posture` | Where are we weakest? | CISO, domain analyst |
| `trust` | `/c/trust` | Can I believe the numbers? | Analyst, SOC |
| `queue` | `/c/queue` | What needs my decision? | CxO, SOC |
| `whatif` | `/c/whatif` | What if we fund X? | CxO, risk, business owner |
| `closure` | `/c/closure` | Did the fix stick? | Risk lead, analysts |
| `changed` | `/c/changed` | What changed since last board? | Board, auditor |
| `pack` | `/c/pack` | Board pack export | Board, program office |

Permission map: `VIEW_PERMISSION` in `server/src/command/rbac.ts`.  
Landing map: `LANDING` in the same file.

### Floor rule (important product invariant)

If any domain is **Critical**, the enterprise headline band cannot read better than Critical even if the arithmetic average would be Medium. Presentation and tests cover this — do not “fix” it away in the UI.

---

## 6. Demo personas (Al Dhabi Holdings)

Defined in `server/src/command/personas.ts`. User IDs follow:

`c1500001-a090-41a0-8ecc-0000000000{suffix}`

| Suffix | Name | Role | Typical home |
|--------|------|------|--------------|
| `01` | Layla Al Hashimi | `ciso` | `/c/posture` |
| `02` | Omar Al Mansoori | `cxo` (CEO) | `/c/queue` |
| `03` | Fatima Al Nuaimi | `cxo` (CFO) | `/c/queue` |
| `04` | Khalid Al Suwaidi | `cxo` (CIO) | `/c/queue` |
| `05` | Mariam Al Dhaheri | `cxo` (COO) | `/c/queue` |
| `06` | Hessa Al Ketbi | `board_member` | `/c/headline` |
| `07` | Yusuf Rahman | `security_analyst` | `/c/trust` |
| `08` | Aisha Khan | `soc_analyst` | `/c/queue` (Approve **disabled**) |
| `09` | Nadia Farouk | `org_admin` | `/admin` |
| `0a` | Rashid Al Maktoum | `risk_manager` | `/c/closure` |
| `0b` | Sara Ibrahim | `compliance_manager` | `/c/headline` |
| `0c` | James Okoye | `auditor` | `/c/changed` |

**RBAC smoke checks that should stay green:**

- Board / analyst: annualised loss may be omitted without `command.loss`
- SOC: queue visible but Approve/Accept/Defer disabled without `command.queue.act`
- Forbidden command routes → API 403; UI redirects / “Outside this role”

---

## 7. UI / design system (redesign)

**Direction:** Linear × Wiz / Falcon-style dark-first security console.

| Token area | Choice |
|-----------|--------|
| Default theme | Dark (`data-theme="dark"`) |
| Type | Inter (body) + Outfit (display) + IBM Plex Mono |
| Accents | Cyan `#22d3ee` + indigo `#818cf8` |
| Risk colors | crit / high / med / low semantic tokens |
| Motion | `framer-motion` |
| Icons | `lucide-react` |
| Charts | `recharts` (area, pie/donut) + custom SVG gauge/spark/heatmap |

Key UI files: `web/src/design.css`, `web/src/command.css`, `Shell.tsx`, `bits.tsx`, `views.tsx`, `LoginPage.tsx`.

**Role-tailored feel (CSS + content density):**

- Board (`role-board`): wider headlines, storytelling KPIs, pack
- CxO (`role-cxo`): queue + what-if impact framing
- CISO (`role-ciso`): denser tables, heatmap, technical columns when permitted

**Explicitly removed:** the global DEMO / “Sample snapshot …” strip under the top bar. Do not bring it back unless product requests it.

Ops pages (`OverviewPage`, `DomainsFindings`, etc.) still use older `index.css` patterns — they are functional but not fully restyled to the new system. Natural follow-on work.

---

## 8. Important API surfaces

Command (no DB required):

- `GET /api/ecc/command/workspace`
- `GET /api/ecc/command/domains/:id`
- `POST /api/ecc/command/queue/:id/{approve,defer,reopen,accept}`
- `POST /api/ecc/command/whatif` (+ save / convert-to-decision)
- `POST /api/ecc/command/fixes/:id/verify`
- `POST /api/ecc/command/acceptances/:id/{renew,revoke}`
- `POST /api/ecc/command/pack/review`

Directory / me:

- `GET /api/ecc/organizations`
- `GET /api/ecc/organizations/:orgId/users`
- `GET /api/ecc/me`

Ops (DB required): overview, domains, findings, decisions, compliance, reports, audit, scenarios, ingestion, admin users/roles.

---

## 9. Scoring / model notes

Implementation: `server/src/command/model.ts` + presentation in `present.ts`.

Concepts teammates hit constantly:

- **Raw vs coverage-adjusted** domain scores
- **Appetite limit** per domain (Outside / Approaching / Within)
- **Weighted enterprise arithmetic** score
- **Floor rule** from Critical domains
- **Modelled ALE / P90 / P95** loss (permission-gated via `command.loss`)
- What-if control gaps: keys `edr`, `siem`, `imm`, `dr`

Reference snapshot date shown in copy historically: **5 Sep 2026**.

---

## 10. Artifacts (visual QA)

Captured under `/opt/cursor/artifacts/` in the cloud agent environment (also linked from the PR):

- `before_role_*.png` — pre-redesign
- `after_role_*.png` / `role_*.png` — post-redesign per persona
- `after_login_demo_roles.png`
- `after_role_board_command_palette.png`
- `ecc_premium_redesign_walkthrough.mp4`

Local screenshot helper used previously: `/tmp/ecc-shots-redesign.mjs` (Puppeteer against `:5173`).

---

## 11. Known gaps / good next work

Priority-ordered suggestions for whoever continues:

1. **Restyle remaining ops pages** to the new design system (`OverviewPage`, Domains, Findings, Decisions, Admin, Intelligence, Scenarios) so Workspace matches Command.
2. **Wire command model to live DB** (today command center is the reference snapshot; ops pages are the live DB). Decide sync strategy and when floor-rule scoring moves server-side onto imported findings.
3. **Finish Supabase host cutover** once `DATABASE_URL` is available; run `db/migrate_to_supabase.py --import-sample --reset` and verify ops pages.
4. **Real auth** (SSO / session cookies) replacing demo headers — keep permission matrix in `rbac.ts` as source of truth.
5. **Admin role editing UX** — overrides exist (`setRoleOverride` in personas); productize carefully.
6. **Accessibility pass** — contrast is generally good; audit focus order in palette + tables.
7. **Performance** — web bundle warns >500kB (framer-motion + recharts); code-split command views if needed.
8. **README refresh** — still accurate for runbook; add pointer to this handoff and the redesign.

Do **not** regress:

- Floor rule behavior
- Permission redaction (loss, technical columns, queue act)
- Role landings
- Demo sign-in flow without passwords (until SSO lands)

---

## 12. Conventions for agents / Claude

- Stay on branch `cursor/ecc-command-rbac-a090` unless opening a new feature branch `cursor/<name>-a090`.
- PR base is `master`; update PR #1 rather than opening duplicates for the same workstream.
- Prefer editing `rbac.ts` for access changes; UI should consume `me.permissions`, not hardcode role names except for presentation tones.
- After UI changes: `cd web && npm run build`, then visually check at least Board / CxO / CISO.
- After RBAC/model changes: `cd server && npm test`.
- Avoid re-adding the DEMO strip.
- Frontend design: keep the dark-first Linear×Wiz direction already in `design.css` (do not drift into purple-on-white / cream-serif clichés).

---

## 13. Quick “continue here” checklist

```bash
git fetch origin
git checkout cursor/ecc-command-rbac-a090
git pull origin cursor/ecc-command-rbac-a090

# Read these first
# - docs/HANDOFF.md          (this file)
# - README.md                (runbook)
# - server/src/command/rbac.ts
# - web/src/components/Shell.tsx
# - web/src/pages/command/views.tsx

cd server && npm install && npm test
cd ../web && npm install && npm run build
```

Then pick a next item from §11.

---

## 14. Glossary

| Term | Meaning |
|------|---------|
| ECC | Executive Cyber Risk Command Center |
| Command center | The 8-view executive surface at `/c/*` |
| Workspace | DB-backed ops pages |
| Floor rule | Critical domain forces Critical headline band |
| Appetite | Board limit per domain score |
| Persona | Seeded demo user with fixed role |
| ALE | Annualised loss expectancy (modelled, AED millions) |

---

*This handoff is meant to be pasted into another chat or kept in-repo. If context is truncated, prioritize §2–§7 and `server/src/command/rbac.ts`.*
