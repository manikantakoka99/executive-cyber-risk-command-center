#!/usr/bin/env bash
# Local-dev seed reset helper for Al Dhabi demo data.
# Destructive: wipes and re-seeds manager-demo synthetic scenarios.
# Do NOT run in CI or shared environments without explicit confirmation.
#
# Usage (from server/):
#   ./scripts/seed_reset.sh           # interactive confirm
#   CONFIRM=YES ./scripts/seed_reset.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

ORG="${DEMO_ORG_ID:-${DEFAULT_ORG_ID:-2accc7de-f693-4b19-8fe8-6db501be05e2}}"

if [[ "${CONFIRM:-}" != "YES" ]]; then
  echo "About to DESTROY and re-seed demo data for org=${ORG}"
  echo "This calls npm run demo:reset then demo:seed (via demo:prepare)."
  read -r -p "Type YES to continue: " answer
  if [[ "${answer}" != "YES" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "→ demo:reset"
npm run demo:reset
echo "→ demo:seed"
npm run demo:seed
echo "→ demo:verify"
npm run demo:verify
echo "Done. Prefer 'npm run demo:prepare' for a one-shot reset+seed+verify."
