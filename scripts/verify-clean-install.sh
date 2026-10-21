#!/usr/bin/env bash
# Required clean-install check. Exits non-zero on any failure.
#
#   docker compose down -v
#   docker compose up -d --wait     # empty volume; --wait returns after init
#   npm run demo:seed
#   start the API
#   CISO headline is 50.8, open decisions are 4,
#   activeScenarios equals the /portfolio and /scenarios list lengths
#
#   ./scripts/verify-clean-install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgresql://ecc:ecc_dev_password@127.0.0.1:5433/cyber_command_center}"
export PORT="${PORT:-4000}"
# Clean-install still calls the API with demo headers. The UI uses session cookies.
export DEMO_AUTH="${DEMO_AUTH:-true}"
ORG_ID="${ORG_ID:-2accc7de-f693-4b19-8fe8-6db501be05e2}"
CISO_ID="${CISO_ID:-c1500001-a090-41a0-8ecc-000000000001}"
API_LOG="${API_LOG:-/tmp/ecc-clean-install-api.log}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-180}"

compose() {
  if docker info >/dev/null 2>&1; then
    docker compose -f "$ROOT/docker-compose.yml" "$@"
  else
    sudo docker compose -f "$ROOT/docker-compose.yml" "$@"
  fi
}

API_PID=""
cleanup() {
  if [[ -n "${API_PID}" ]]; then
    kill -- "-${API_PID}" >/dev/null 2>&1 || kill "${API_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "==> docker compose down -v"
compose down -v

echo "==> docker compose up -d --wait (empty volume, init must finish)"
compose up -d --wait --wait-timeout "$WAIT_TIMEOUT"

if ! compose logs db | grep -q "apply_app_schema: done"; then
  echo "clean-install: init did not finish (missing apply_app_schema: done)" >&2
  compose logs db >&2 || true
  exit 1
fi
echo "==> init finished"

echo "==> npm install && npm run demo:seed"
cd "$ROOT/server"
npm install
npm run demo:seed

echo "==> start API on :${PORT}"
: >"$API_LOG"
# setsid so the trap can stop npm and the tsx child together.
setsid npm run start >"$API_LOG" 2>&1 &
API_PID=$!

health_ok=0
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    health_ok=1
    break
  fi
  if ! kill -0 "$API_PID" >/dev/null 2>&1; then
    echo "clean-install: API exited before /health" >&2
    cat "$API_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done
if [[ "$health_ok" -ne 1 ]]; then
  echo "clean-install: API did not become healthy on :${PORT}" >&2
  cat "$API_LOG" >&2 || true
  exit 1
fi

hdr=(-H "X-Org-Id: ${ORG_ID}" -H "X-User-Id: ${CISO_ID}")
portfolio_file="$(mktemp)"
scenarios_file="$(mktemp)"
curl -sf "${hdr[@]}" "http://127.0.0.1:${PORT}/api/ecc/portfolio" -o "$portfolio_file"
curl -sf "${hdr[@]}" "http://127.0.0.1:${PORT}/api/ecc/scenarios" -o "$scenarios_file"

node --input-type=commonjs - "$portfolio_file" "$scenarios_file" <<'JS'
const fs = require("fs");
const portfolio = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const scenariosBody = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const totals = portfolio.totals || {};
const topRisks = Array.isArray(portfolio.topRisks) ? portfolio.topRisks : [];
const scenarios = Array.isArray(scenariosBody.scenarios) ? scenariosBody.scenarios : [];
const score = Number(totals.enterpriseScore);
const openDecisions = Number(totals.openDecisions);
const active = Number(totals.activeScenarios);

console.log("enterpriseScore", totals.enterpriseScore);
console.log("openDecisions", totals.openDecisions);
console.log("activeScenarios", totals.activeScenarios);
console.log("topRisks", topRisks.length);
console.log("scenarios", scenarios.length);

const failures = [];
if (!Number.isFinite(score) || Math.abs(score - 50.8) > 1e-9) {
  failures.push(`enterpriseScore ${totals.enterpriseScore} !== 50.8`);
}
if (openDecisions !== 4) {
  failures.push(`openDecisions ${totals.openDecisions} !== 4`);
}
if (!Number.isFinite(active) || active < 1) {
  failures.push(`activeScenarios ${totals.activeScenarios} is not a positive count`);
}
if (active !== topRisks.length || active !== scenarios.length) {
  failures.push(
    `activeScenarios ${active} !== topRisks ${topRisks.length} !== scenarios ${scenarios.length}`,
  );
}
if (failures.length) {
  console.error("clean-install: FAIL");
  for (const line of failures) console.error("  " + line);
  process.exit(1);
}
console.log("clean-install: ok");
JS

rm -f "$portfolio_file" "$scenarios_file"
echo "clean-install: passed"
