# Executive Cyber Risk Command Center (ECC)

Data-backed **YVI DWAN Cyber Command Center** — executive aggregation of 12 security domains into Risk → Impact → Decision → Action.

> Authoritative design: `docs/ecc-*.md`, `docs/PEP_RBAC_TEST_MATRIX.md`, and `db/dwan_schema.sql`.

## Fedora local run (docker-compose.yml)

Exact path on a fresh Fedora host (Podman works if you alias `docker` → `podman`):

```bash
# 0) Host packages (once)
sudo dnf install -y git nodejs npm docker docker-compose-plugin
# or: sudo dnf install -y git nodejs npm podman podman-compose
sudo systemctl enable --now docker   # skip if using rootless podman

# 1) Clone the PR branch (until it is merged)
git clone https://github.com/manikantakoka99/executive-cyber-risk-command-center.git
cd executive-cyber-risk-command-center
git checkout cursor/hide-seeded-feeds-94b5
cp .env.example .env

# 2) Postgres only (service name is `db` in docker-compose.yml)
#    An empty volume applies schema.sql, migrations 001–008, the sample workbook,
#    AED formatting, then the tenant seed. The first boot builds ecc-postgres:16.
docker compose down -v
docker compose up -d db
docker compose exec -T db pg_isready -U ecc -d cyber_command_center

# 3) API (:4000) — install, demo seed, then watch mode
cd server
npm install
npm run demo:seed          # four Al Dhabi demo scenarios
npm run dev                # http://127.0.0.1:4000/health

# 4) Web (:5173) — new terminal; Vite proxies /api → :4000
cd ../web
npm install
npm run dev                # http://127.0.0.1:5173
```

| Service | URL / connection |
|--------|-------------------|
| UI | http://127.0.0.1:5173 |
| API | http://127.0.0.1:4000/health |
| Postgres | `postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center` |

Docker init on an empty volume runs `db/docker-init/apply_app_schema.sh`:

1. `db/schema.sql` — MVP tables, including `business_impact_assessments.financial_exposure_aed`
2. `db/migrations/001`–`008` — `business_units.code` (001) and scenario AED columns (004)
3. `reference/CyberCommandCenter_Sample_Data.xlsx` — findings, impacts, decisions, reports
4. `db/docker-init/04_format_aed_impact_summaries.sql` — compact AED chip text
5. `db/docker-init/03_seed_tenants.sql` — Al Dhabi + Falcon personas in `user_roles`

`npm run demo:seed` then creates the four Al Dhabi demo scenarios. `db/dwan_schema.sql` stays in the repo and is not applied by compose.

**Fresh DB only:** Postgres init scripts run when the volume is empty. To re-seed from scratch:

```bash
docker compose down -v
docker compose up -d db
cd server && npm run demo:seed && npm run dev
```

### One-command helper

```bash
chmod +x scripts/dev-up.sh
./scripts/dev-up.sh          # starts `db`, then API + Vite (logs in /tmp)
```

Optional Excel → scores seed (Python):

```bash
python3 -m venv .venv-ecc
.venv-ecc/bin/pip install psycopg2-binary openpyxl
DATABASE_URL=postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center \
  .venv-ecc/bin/python db/seed_dwan_aldhabi.py
```

SQL regression suite:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/dwan_tests.sql
```

### Supabase (optional)

1. Project Settings → Database → Connection string → URI  
2. Set `DATABASE_URL` in `.env` (`?sslmode=require` if needed)  
3. Apply `db/dwan_schema.sql` (or legacy `db/migrate_to_supabase.py` for the older migration chain)

## Demo auth and tenants

> **Must-fix before production:** demo auth trusts `X-Org-Id` / `X-User-Id` headers with no signature, session, or IdP. Anyone who can call the API can impersonate any seeded persona. Replace with real authentication (OIDC/SAML + short-lived tokens) and never ship header-trusted identity to production.

Sign-in is passwordless for local/demo use. Pick an organization, then a persona. Every API call sends:

- `X-Org-Id`
- `X-User-Id`

App roles match the schema’s eight `user_role_name` values exactly: `board_member`, `cxo`, `ciso`, `risk_lead`, `domain_analyst`, `program_office`, `auditor`, `admin`.

**Tenant isolation** is enforced in the API (user must belong to the org) and in Postgres (`SET app.current_org_id` / RLS on DWAN tables). Cross-tenant header spoofing returns **403**. Authorization is checked before input validation on mutating endpoints (unauthorized → **403**, not **400**).

### Tenant A — Al Dhabi Holdings

| Persona | Role | Notes |
|---|---|---|
| Omar Al Mansoori, Fatima Al Nuaimi, Khalid Al Suwaidi, Mariam Al Dhaheri | `cxo` | Decision queue, accept risk, financials; **no** findings/technical evidence |
| Layla Al Hashimi | `ciso` | Propose scoring policy / appetite; full ops |
| Hessa Al Ketbi | `board_member` | Approve & lock policy; no queue approve |
| Yusuf Rahman, Aisha Khan | `domain_analyst` | Domain evidence / SOC; no financials |
| Rashid Al Maktoum | `risk_lead` | Accept risk, register |
| Nadia Farouk | `admin` | Users / roles |
| Sara Ibrahim | `program_office` | Framework posture / pack prep |
| James Okoye | `auditor` | Read-only pack, audit, **findings**, **connectors** |

### Tenant B — Falcon National Bank (isolation tests)

| Persona | Role |
|---|---|
| Nora Al Falasi | CISO |
| Tariq Hassan | Board Member |
| Samira Qureshi | CxO (CEO) |

## Policy / appetite

- **CISO** proposes scoring policy and risk appetite  
- **Board** approves and locks the version (`proposed_by ≠ approved_by`)  
- Approval makes that version immutable (DB triggers + API)

Risk acceptance is allowed for **CxO** and **Risk Lead** (`role_capabilities.accept_risk` + API).

## Documentation

| Doc | Purpose |
|-----|---------|
| `docs/PEP_RBAC_TEST_MATRIX.md` | Role × capability matrix |
| `docs/ecc-architecture.md` | Stack & tenancy |
| `docs/ecc-api-design.md` | API contract |
| `docs/ecc-risk-scoring.md` | KPI / scoring model |
| `db/dwan_schema.sql` | Authoritative schema |

## Tests

```bash
cd server && npm test
# Empty-database init (db must already be up):
./scripts/verify-empty-db-init.sh
```
