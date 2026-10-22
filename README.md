# Executive Cyber Risk Command Center (ECC)

Data-backed **YVI DWAN Cyber Command Center** — an executive view that rolls twelve security domains into Risk → Impact → Decision → Action.

Authoritative design lives under `docs/` (architecture, API, scoring, RBAC) and in `db/dwan_schema.sql`.

## Features

- Multi-tenant organizations with role-based access (board, CxO, CISO, risk lead, analyst, program office, auditor, admin)
- Command Center headline with per-org domain scores and a floor at the worst High/Critical domain
- Decisions, scenarios, connectors, ingestion proof, and compliance posture
- NIST CSF 2.0 shown as **aligned / mapped** coverage from that org’s evidence (never “certified”)
- Session cookie auth with invites (no public signup)

## Tech stack

| Layer | Stack |
| --- | --- |
| Web | React, Vite (dev server proxies `/api` to the API) |
| API | Node.js, Fastify, TypeScript |
| Database | PostgreSQL 16 via Docker Compose |

## Prerequisites

- **Node.js** and **npm** (current LTS is fine)
- **Docker** with **Docker Compose** v2
- Git

Postgres is provided by Compose; you do not need a system-wide Postgres install for the default path.

## Quick start

Default ports: **UI `5173`**, **API `4000`**, **Postgres `5433`** (host) → `5432` (container).

### macOS / Linux

```bash
git clone https://github.com/manikantakoka99/executive-cyber-risk-command-center.git
cd executive-cyber-risk-command-center
cp .env.example server/.env

docker compose up -d db
# Wait until Postgres accepts connections AND first-boot init finished
# (pg_isready alone is true mid-init; seeding then gets ECONNRESET).
for i in $(seq 1 90); do
  if docker compose exec -T db pg_isready -U ecc -d cyber_command_center >/dev/null 2>&1 \
    && docker compose exec -T db psql -U ecc -d cyber_command_center -tAc \
      "SELECT 1 FROM schema_migrations WHERE version = '013_nist_csf_2'" 2>/dev/null | grep -q 1; then
    break
  fi
  sleep 1
done
docker compose exec -T db pg_isready -U ecc -d cyber_command_center

cd server
npm install
npm run demo:seed
# Demo passwords (pick one; do not commit real values):
cp ../logins.example.csv ../logins.csv   # then edit placeholders locally
ECC_DEMO_LOGINS_FILE=../logins.csv npm run auth:seed
# or: ECC_DEMO_PASSWORD='replace-with-a-local-password' npm run auth:seed
npm run dev                              # http://localhost:4000/health

# New terminal
cd web
npm install
npm run dev                              # http://localhost:5173
```

### Windows (PowerShell)

```powershell
git clone https://github.com/manikantakoka99/executive-cyber-risk-command-center.git
cd executive-cyber-risk-command-center
Copy-Item .env.example server/.env

docker compose up -d db
# Wait until Postgres accepts connections AND first-boot init finished
# (pg_isready alone is true mid-init; seeding then gets ECONNRESET).
for ($i = 1; $i -le 90; $i++) {
  docker compose exec -T db pg_isready -U ecc -d cyber_command_center 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $mig = docker compose exec -T db psql -U ecc -d cyber_command_center -tAc "SELECT 1 FROM schema_migrations WHERE version = '013_nist_csf_2'" 2>$null
    if ($mig -match '1') { break }
  }
  Start-Sleep -Seconds 1
}
docker compose exec -T db pg_isready -U ecc -d cyber_command_center

cd server
npm install
npm run demo:seed
Copy-Item ..\logins.example.csv ..\logins.csv   # then edit placeholders locally
$env:ECC_DEMO_LOGINS_FILE="..\logins.csv"; npm run auth:seed
# or: $env:ECC_DEMO_PASSWORD="replace-with-a-local-password"; npm run auth:seed
npm run dev

# New terminal
cd web
npm install
npm run dev
```

| Service | URL / connection |
| --- | --- |
| UI | http://localhost:5173 |
| API | http://localhost:4000/health |
| Postgres | `postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center` |

On an empty volume, Compose init runs `db/docker-init/apply_app_schema.sh` (schema, migrations **001–013** including `013_nist_csf_2.sql` for the NIST CSF 2.0 framework catalog row, sample workbook, AED formatting, tenant seed). `npm run demo:seed` adds the Al Dhabi demo scenarios and runs sample workbook ingestion so per-domain NIST evidence is recorded (aligned/mapped coverage, never a certification claim). `db/dwan_schema.sql` stays in the repo for reference and is not applied by Compose.

**Reset the database:**

```bash
docker compose down -v
docker compose up -d db
# Same wait as Quick start: ready + migration 013 (init finished).
for i in $(seq 1 90); do
  if docker compose exec -T db pg_isready -U ecc -d cyber_command_center >/dev/null 2>&1 \
    && docker compose exec -T db psql -U ecc -d cyber_command_center -tAc \
      "SELECT 1 FROM schema_migrations WHERE version = '013_nist_csf_2'" 2>/dev/null | grep -q 1; then
    break
  fi
  sleep 1
done
docker compose exec -T db pg_isready -U ecc -d cyber_command_center
cd server && npm run demo:seed && ECC_DEMO_LOGINS_FILE=../logins.csv npm run auth:seed && npm run dev
```

PowerShell reset (same wait):

```powershell
docker compose down -v
docker compose up -d db
for ($i = 1; $i -le 90; $i++) {
  docker compose exec -T db pg_isready -U ecc -d cyber_command_center 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $mig = docker compose exec -T db psql -U ecc -d cyber_command_center -tAc "SELECT 1 FROM schema_migrations WHERE version = '013_nist_csf_2'" 2>$null
    if ($mig -match '1') { break }
  }
  Start-Sleep -Seconds 1
}
docker compose exec -T db pg_isready -U ecc -d cyber_command_center
cd server; npm run demo:seed; $env:ECC_DEMO_LOGINS_FILE="..\logins.csv"; npm run auth:seed; npm run dev
```

Optional one-command helper (starts `db`, then API + Vite):

```bash
chmod +x scripts/dev-up.sh
./scripts/dev-up.sh
```

## Environment

The API and `npm run auth:seed` / `demo:seed` run from `server/` and load **`server/.env`** (`dotenv/config` in `server/src/index.ts` and `server/src/db.ts`; `server/scripts/ecc_demo.ts` loads the same path). Copy the example there:

```bash
cp .env.example server/.env
```

A root `.env` is not read. Every variable below is loaded from `server/.env` by the listed file (see also commented optionals in `.env.example`).

| Variable | Read by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `server/src/db.ts` (via `server/.env`) | Postgres connection string (Compose default uses host port **5433**) |
| `SUPABASE_DB_URL` | `server/src/db.ts` (via `server/.env`) | Optional alias if you point the API at Supabase |
| `PORT` | `server/src/index.ts` (via `server/.env`) | API port (default **4000**) |
| `HOST` | `server/src/index.ts` (via `server/.env`) | API bind address (default `0.0.0.0`) |
| `CORS_ORIGIN` | `server/src/index.ts` (via `server/.env`) | Browser origin allowlist, comma-separated. Default when unset: `http://localhost:5173` only (fail closed — never `*` / any-origin). Set `CORS_ORIGIN=http://localhost:5173` in `server/.env` for local Vite. |
| `DEMO_AUTH` | `server/src/middleware/tenant.ts` (via `server/.env`) | `true` only for local QA that may send `X-Org-Id` / `X-User-Id`; use `false` otherwise. A session cookie always wins over headers. |
| `NODE_ENV` | `server/src/auth/service.ts` (via `server/.env` / process env) | When `production`, the session cookie is marked `Secure`. Leave unset for local HTTP. |
| `ECC_DEMO_LOGINS_FILE` | `server/scripts/seed_auth.ts` (process env when seeding) | Path to a gitignored `email,password` CSV for `npm run auth:seed` |
| `ECC_DEMO_PASSWORD` | `server/scripts/seed_auth.ts` (process env / `server/.env`) | Fallback: one local password for every role login when the CSV is unset |
| `LOGIN_THROTTLE_EMAIL` | `server/src/auth/loginThrottle.ts` (via `server/.env`) | Max failed sign-ins per email in the window (default 8) |
| `LOGIN_THROTTLE_IP` | `server/src/auth/loginThrottle.ts` (via `server/.env`) | Max failed sign-ins per IP in the window (default 30) |
| `TRUST_PROXY` | `server/src/auth/loginThrottle.ts` (via `server/.env`) | Exact reverse-proxy hop count for login throttle IP (see below) |
| `DEFAULT_RISK_APPETITE` | `server/src/services/overview.ts` (via `server/.env`) | Default appetite percent when none is stored (default 50) |
| `DEFAULT_ORG_ID` | `server/scripts/ecc_demo.ts` (via `server/.env`) | Org for `npm run demo:seed` / demo CLI |
| `DEMO_ORG_ID` | `server/scripts/ecc_demo.ts` (via `server/.env`) | Optional alias; wins over `DEFAULT_ORG_ID` when set |
| `ECC_ENABLE_SAMPLE_INGESTION` | `server/src/index.ts`, `server/src/services/sampleWorkbookIngestion.ts` (via `server/.env`) | Set to `false` to disable sample workbook ingestion |
| `PG_POOL_MAX` | `server/src/db.ts` (via `server/.env`) | Postgres pool size (default 20) |
| `ACCEPT_RISK_ROLES` | `server/src/command/rbac.ts` (via `server/.env`) | Optional comma-separated role codes allowed to accept risk |

### `TRUST_PROXY`

Used only when deriving the client IP for **failed sign-in throttling**. It does **not** enable Fastify’s `trustProxy`.

Set it to the **exact number of reverse proxies** in front of the API (for example `1` behind a single load balancer). Leave it **unset or `0`** when clients reach the API directly.

The code accepts only a positive integer hop count (`1`, `2`, …). Never set it to `true`: non-integers (including `true`) trust **zero** hops in this codebase, but treating “true” as “trust the whole chain” in other stacks is what lets a client spoof `X-Forwarded-For` and bypass the login rate limit — so do not use that pattern here either.

## Auth and demo logins

The UI signs in with email and password (bcrypt hashes in `auth_accounts`). There is no public signup: an org Admin invites someone; the invite link lets them set a password.

```bash
cd server
# Preferred
cp ../logins.example.csv ../logins.csv    # edit locally; gitignored
ECC_DEMO_LOGINS_FILE=../logins.csv npm run auth:seed
# Fallback
ECC_DEMO_PASSWORD='replace-with-a-local-password' npm run auth:seed
```

Never commit `logins.csv` or a filled-in `server/.env`. `logins.example.csv` contains placeholders only.

| Login | Role | Org | Home |
| --- | --- | --- | --- |
| `layla@ciso.com` | CISO | Al Dhabi (also Falcon) | `/c/posture` |
| `mariam@cxo.com` | CxO | Al Dhabi | `/c/headline` |
| `hessa@board.com` | Board | Al Dhabi | `/c/headline` |
| `rashid@risklead.com` | Risk Lead | Al Dhabi | `/c/closure` |
| `yusuf@domainanalyst.com` | Domain Analyst | Al Dhabi | `/c/trust` |
| `james@auditor.com` | Auditor | Al Dhabi | `/c/changed` |
| `sara@programoffice.com` | Program Office | Al Dhabi | `/c/pack` |
| `nadia@admin.com` | Admin | Al Dhabi | `/admin` |

Role domains above are public DNS names used only as demo addresses. The app has no mail transport; invites stay log-only.

Failed sign-ins are throttled per IP (30) and per email (8) for 15 minutes, in memory on that API process. A successful sign-in clears that email’s failures. Session cookie: `HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`.

**Tenant isolation** is enforced in the API and in Postgres (`app.current_org_id` / RLS). Cross-tenant spoofing returns **403**.

## Project structure

```
.
├── web/                 # React + Vite UI (:5173)
├── server/              # Fastify API (:4000); loads server/.env
├── db/                  # schema, migrations, docker init, seeds
├── docs/                # architecture, API, scoring, RBAC
├── reference/           # sample workbook and fixtures
├── scripts/             # local helpers (dev-up, clean-install checks)
├── docker-compose.yml   # Postgres 16 on host port 5433
├── .env.example         # copy to server/.env
└── logins.example.csv
```

## Tests

```bash
./scripts/verify-clean-install.sh   # required clean Docker install check
cd server && npm test
cd web && npm run build
# Schema-only probe against a running Postgres:
./scripts/verify-empty-db-init.sh
```

GitHub Actions runs the clean-install check on pull requests (`.github/workflows/clean-install.yml`).

## Documentation

| Doc | Purpose |
| --- | --- |
| `docs/PEP_RBAC_TEST_MATRIX.md` | Role × capability matrix |
| `docs/ecc-architecture.md` | Stack and tenancy |
| `docs/ecc-api-design.md` | API contract |
| `docs/ecc-risk-scoring.md` | KPI / scoring model |
| `docs/canonical_values.md` | Demo headline canonical numbers |
| `db/dwan_schema.sql` | Reference schema |

## Security

- Do not commit `server/.env`, `logins.csv`, or any real passwords.
- Keep `DEMO_AUTH=false` outside local automated tests.
- NIST CSF 2.0 in the product is mapping coverage only — not a certification claim.
