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
cp .env.example .env

docker compose up -d db
docker compose exec -T db pg_isready -U ecc -d cyber_command_center

cd server
npm install
npm run demo:seed
# Demo passwords (pick one; do not commit real values):
cp ../logins.example.csv ../logins.csv   # then edit placeholders locally
ECC_DEMO_LOGINS_FILE=../logins.csv npm run auth:seed
# or: ECC_DEMO_PASSWORD='replace-with-a-local-password' npm run auth:seed
npm run dev                              # http://127.0.0.1:4000/health

# New terminal
cd web
npm install
npm run dev                              # http://127.0.0.1:5173
```

### Windows (PowerShell)

```powershell
git clone https://github.com/manikantakoka99/executive-cyber-risk-command-center.git
cd executive-cyber-risk-command-center
Copy-Item .env.example .env

docker compose up -d db
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
| UI | http://127.0.0.1:5173 |
| API | http://127.0.0.1:4000/health |
| Postgres | `postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center` |

On an empty volume, Compose init runs `db/docker-init/apply_app_schema.sh` (schema, migrations, sample workbook, AED formatting, tenant seed). `npm run demo:seed` adds the Al Dhabi demo scenarios (and related demo data the seed script defines). `db/dwan_schema.sql` stays in the repo for reference and is not applied by Compose.

**Reset the database:**

```bash
docker compose down -v
docker compose up -d db
cd server && npm run demo:seed && npm run auth:seed && npm run dev
```

Optional one-command helper (starts `db`, then API + Vite):

```bash
chmod +x scripts/dev-up.sh
./scripts/dev-up.sh
```

## Environment

Copy `.env.example` to `.env`. Important variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Compose default uses host port **5433**) |
| `PORT` | API port (default **4000**) |
| `CORS_ORIGIN` | Browser origin (default `http://localhost:5173`) |
| `DEMO_AUTH` | `true` only for local QA that may send `X-Org-Id` / `X-User-Id`; use `false` otherwise. A session cookie always wins over headers. |
| `ECC_DEMO_LOGINS_FILE` | Path to a gitignored `email,password` CSV for `npm run auth:seed` |
| `ECC_DEMO_PASSWORD` | Fallback: one local password for every role login when the CSV is unset |
| `TRUST_PROXY` | Hop count for login rate-limit IP (see below) |

### `TRUST_PROXY`

Used only when deriving the client IP for **failed sign-in throttling** (same idea as Express `trust proxy` = N). It does **not** turn on Fastify’s `trustProxy`.

- Unset, `0`, `false`, `off`, `no`, or any non-integer → use the TCP socket address and ignore `X-Forwarded-For`.
- A positive integer → walk that many hops from the **right** of `X-Forwarded-For` (the socket is hop 0), so a spoofed leftmost address does not change the per-IP key.

Set it when the API sits behind a reverse proxy that appends `X-Forwarded-For` and you want throttle keys to reflect the real client. Leave it unset for direct local access.

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

Never commit `logins.csv` or a filled-in `.env`. `logins.example.csv` contains placeholders only.

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
├── server/              # Fastify API (:4000)
├── db/                  # schema, migrations, docker init, seeds
├── docs/                # architecture, API, scoring, RBAC
├── reference/           # sample workbook and fixtures
├── scripts/             # local helpers (dev-up, clean-install checks)
├── docker-compose.yml   # Postgres 16 on host port 5433
├── .env.example
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
| `db/dwan_schema.sql` | Reference schema |

## Security

- Do not commit `.env`, `logins.csv`, or any real passwords.
- Keep `DEMO_AUTH=false` outside local automated tests.
- NIST CSF 2.0 in the product is mapping coverage only — not a certification claim.
