#!/usr/bin/env bash
# One-command local run: Postgres (DWAN schema + seed) + API + Vite.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Starting Postgres (docker compose)…"
docker compose up -d db

echo "==> Waiting for Postgres…"
for i in $(seq 1 40); do
  if docker compose exec -T db pg_isready -U ecc -d cyber_command_center >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker compose exec -T db pg_isready -U ecc -d cyber_command_center

export DATABASE_URL="${DATABASE_URL:-postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center}"
export PORT="${PORT:-4000}"
export CORS_ORIGIN="${CORS_ORIGIN:-true}"
export DEMO_AUTH="${DEMO_AUTH:-true}"
export DEFAULT_ORG_ID="${DEFAULT_ORG_ID:-2accc7de-f693-4b19-8fe8-6db501be05e2}"

if [[ ! -d "$ROOT/server/node_modules" ]]; then
  echo "==> Installing server deps…"
  (cd "$ROOT/server" && npm install)
fi
if [[ ! -d "$ROOT/web/node_modules" ]]; then
  echo "==> Installing web deps…"
  (cd "$ROOT/web" && npm install)
fi

mkdir -p /tmp
echo "==> Starting API on :$PORT…"
(cd "$ROOT/server" && npx tsx src/index.ts > /tmp/ecc-server.log 2>&1 &) 
echo "==> Starting Vite on :5173…"
(cd "$ROOT/web" && npx vite --host 127.0.0.1 --port 5173 > /tmp/ecc-vite.log 2>&1 &) 

for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 \
     && curl -sf -o /dev/null "http://127.0.0.1:5173/"; then
    break
  fi
  sleep 1
done

echo
echo "Local ECC is up:"
echo "  UI:  http://127.0.0.1:5173"
echo "  API: http://127.0.0.1:${PORT}/health"
echo "  DB:  $DATABASE_URL"
echo
echo "Demo tenants: Al Dhabi Holdings + Falcon National Bank (login picker)."
echo "Logs: /tmp/ecc-server.log  /tmp/ecc-vite.log"
