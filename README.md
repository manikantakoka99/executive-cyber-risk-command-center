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

## Demo auth

Headers (set automatically by the UI):

- `X-Org-Id`
- `X-User-Id`

Only `cxo` may approve/decline decisions.
