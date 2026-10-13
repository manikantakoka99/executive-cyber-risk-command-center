# Executive Cyber Risk Command Center (ECC)

Data-backed **YVI DWAN Cyber Command Center** — executive aggregation of 12 security domains into Risk → Impact → Decision → Action.

> Prior `docs/PRD.md` / demo SPA described a 5-domain sales prototype. Authoritative design for this build: `docs/ecc-*.md` + `reference/`.

## Quick start

### 1. Database

```bash
docker compose up -d
# waits on localhost:5433 (5432 often taken locally)
```

### 2. Import sample data

```bash
python3 -m venv .venv-ecc
.venv-ecc/bin/pip install psycopg2-binary openpyxl
.venv-ecc/bin/python db/import_sample_data.py --reset
.venv-ecc/bin/python db/validate_import.py
```

### 3. API

```bash
cp .env.example .env
cd server && npm install && npm run dev
# http://localhost:4000/health
```

### 5. Web UI

```bash
cd web && npm install && npm run dev
# Vite proxies /api → :4000
```

Open http://127.0.0.1:5173

Default tenant: **Al Dhabi Holdings** (score ≈ 42.83 from sample DB — not the static HTML mockup numbers). Use the org switcher for tenants with awaiting CXO decisions (e.g. **Falcon National Bank**).

### Tests

```bash
cd server && npm test
# or: DATABASE_URL=... npx tsx --test src/overview.test.ts
.venv-ecc/bin/python db/validate_import.py
```

## Reload sample dataset

```bash
.venv-ecc/bin/python db/import_sample_data.py --reset
.venv-ecc/bin/python db/validate_import.py
```

## Documentation

| Doc | Purpose |
|-----|---------|
| `docs/ecc-research.md` | R&D with source / inference / external / recommendation |
| `docs/ecc-product-requirements.md` | PRD |
| `docs/ecc-architecture.md` | Stack & tenancy |
| `docs/ecc-data-mapping.md` | Excel ↔ schema ↔ UI |
| `docs/ecc-api-design.md` | API contract |
| `docs/ecc-risk-scoring.md` | KPI / scoring model |
| `docs/ecc-implementation-plan.md` | Phases |
| `docs/ecc-import-validation.md` | Last validation report |

## Demo auth and roles

Open the web app and sign in as a seeded persona. There is no password. The header can switch persona without signing out. The same headers are sent on every API call:

- `X-Org-Id`
- `X-User-Id`

Access is enforced in the API, not only by hiding navigation. A role that lacks a permission receives **403** and a payload that omits restricted fields (financial exposure, feed confidence, KEV/EPSS, raw scores).

| Persona | Role | What they see |
|---|---|---|
| Omar Al Mansoori, Fatima Al Nuaimi, Khalid Al Suwaidi, Mariam Al Dhaheri | CxO (CEO, CFO, CIO, COO) | Business impact, loss exposure, decision queue (approve / accept / defer), what-if funding |
| Layla Al Hashimi | CISO | Full operational and technical command center, incidents, vulnerabilities, controls, verification |
| Hessa Al Ketbi | Board Member | Headline posture, trends, financial exposure, compliance summary, board pack. No approvals |
| Yusuf Rahman | Security Analyst | Domain evidence, trust panel, findings, verification scans. No financial approvals |
| Aisha Khan | SOC Analyst | Detection coverage, queue, verification scans |
| Rashid Al Maktoum | Risk Lead | Acceptance register, queue actions, what-if, audit context |
| Nadia Farouk | Admin | User and role administration |
| Sara Ibrahim | Compliance | Framework posture, board pack, what changed |
| James Okoye | Auditor | Read-only pack, compliance, and audit |

The command center (headline, posture, trust, queue, what-if, closure, what changed, board pack) uses the reference executive model and runs even when PostgreSQL is not up. Operational pages (domains, findings, ingestion, scenarios) need the sample database from the quick start above.

Legacy executive-decision approve/decline on the operational overview remains limited to `cxo`. Command-center queue actions follow the role matrix above (`cxo`, `ciso`, `risk_manager`).
