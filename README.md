# Executive Cyber Risk Command Center (ECC)

Data-backed **YVI DWAN Cyber Command Center** — executive aggregation of 12 security domains into Risk → Impact → Decision → Action.

> Authoritative design: `docs/ecc-*.md`, `docs/PEP_RBAC_TEST_MATRIX.md`, and `db/dwan_schema.sql`.

## One-command local run

```bash
# Postgres 16 + DWAN schema + two demo tenants (Al Dhabi + Falcon)
docker compose up -d

# API + Vite (installs deps on first run)
chmod +x scripts/dev-up.sh
./scripts/dev-up.sh
```

Then open http://127.0.0.1:5173

| Service | URL / connection |
|--------|-------------------|
| UI | http://127.0.0.1:5173 |
| API | http://127.0.0.1:4000/health |
| Postgres | `postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center` |

Docker init mounts:

1. `db/dwan_schema.sql` — consolidated DWAN schema + RLS  
2. `db/docker-init/02_app_compat.sql` — API compatibility views (`v_user_primary_role`, roles)  
3. `db/docker-init/03_seed_tenants.sql` — Al Dhabi + Falcon personas  

**Fresh DB only:** Postgres init scripts run when the volume is empty. To re-seed from scratch:

```bash
docker compose down -v
docker compose up -d
./scripts/dev-up.sh
```

Optional rich Al Dhabi seed (Excel signals → scores) into a DWAN database:

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

### Manual start (without `dev-up.sh`)

```bash
cp .env.example .env
docker compose up -d
cd server && npm install && npm run dev   # :4000
cd web && npm install && npm run dev      # :5173, proxies /api → :4000
```

### Supabase (optional)

1. Project Settings → Database → Connection string → URI  
2. Set `DATABASE_URL` in `.env` (`?sslmode=require` if needed)  
3. Apply `db/dwan_schema.sql` (or legacy `db/migrate_to_supabase.py` for the older migration chain)

## Demo auth and tenants

Sign-in is passwordless. Pick an organization, then a persona. Every API call sends:

- `X-Org-Id`
- `X-User-Id`

**Tenant isolation** is enforced in the API (user must belong to the org) and in Postgres (`SET app.current_org_id` / RLS on DWAN tables). Cross-tenant header spoofing returns **403**.

### Tenant A — Al Dhabi Holdings

| Persona | Role | Notes |
|---|---|---|
| Omar Al Mansoori, Fatima Al Nuaimi, Khalid Al Suwaidi, Mariam Al Dhaheri | CxO | Decision queue, accept risk, financials |
| Layla Al Hashimi | CISO | Propose scoring policy / appetite; full ops |
| Hessa Al Ketbi | Board Member | Approve & lock policy; no queue approve |
| Yusuf Rahman | Security Analyst | Domain evidence; no financials |
| Aisha Khan | SOC Analyst | Detection / verification |
| Rashid Al Maktoum | Risk Lead | Accept risk, register |
| Nadia Farouk | Admin | Users / roles |
| Sara Ibrahim | Compliance | Framework posture |
| James Okoye | Auditor | Read-only pack / audit |

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
```
