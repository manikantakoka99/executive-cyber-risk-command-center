#!/bin/sh
# Apply the app schema to an empty database.
# Order: schema.sql, migrations 001–010, clear the bootstrap catalog,
# import the sample workbook, format AED impact summaries, then seed tenants.
# npm run demo:seed then creates the Al Dhabi scenarios.
#
# Docker compose mounts this as /docker-entrypoint-initdb.d/10_apply_app_schema.sh
# and the repo at /ecc-src. A host or CI run can point ECC_SQL_ROOT at db/.
set -eu

ROOT="${ECC_SQL_ROOT:-/ecc-db}"
if [ ! -f "$ROOT/schema.sql" ]; then
  echo "apply_app_schema: schema.sql not found under $ROOT" >&2
  exit 1
fi

USER="${POSTGRES_USER:-${PGUSER:-ecc}}"
DB="${POSTGRES_DB:-${PGDATABASE:-cyber_command_center}}"

# Official Postgres init connects over the local socket. A copied PGHOST
# would send psql at a host that is not listening yet.
if [ -d /docker-entrypoint-initdb.d ]; then
  unset PGHOST PGHOSTADDR || true
fi

run_file() {
  echo "apply_app_schema: $1"
  psql -v ON_ERROR_STOP=1 --username "$USER" --dbname "$DB" --no-password --no-psqlrc -f "$1"
}

# Enum ADD VALUE cannot be used until its transaction commits. psql autocommit
# does that per statement; splitting at the marker matches db/apply_migrations.py
# so a later statement in the same file can use the new value.
run_sql() {
  file="$1"
  marker="-- >>> ENUMS_COMMIT_POINT <<<"
  # -e so a marker that starts with "--" is not parsed as a grep flag (BusyBox).
  if grep -F -q -e "$marker" "$file"; then
    tmp=$(mktemp -d)
    awk -v m="$marker" -v dir="$tmp" '
      $0 == m { part = 2; next }
      { print >> (dir "/part" (part ? part : 1) ".sql") }
    ' "$file"
    if [ -f "$tmp/part1.sql" ]; then
      run_file "$tmp/part1.sql"
    fi
    if [ -f "$tmp/part2.sql" ]; then
      run_file "$tmp/part2.sql"
    fi
    rm -rf "$tmp"
  else
    run_file "$file"
  fi
}

run_sql "$ROOT/schema.sql"

for name in \
  001_ecc_v2_foundation.sql \
  002_ecc_connector_signal_framework.sql \
  003_ecc_correlation_risk_engine.sql \
  004_ecc_executive_closed_loop.sql \
  005_ecc_enterprise_intelligence.sql \
  006_ecc_sample_ingestion_proof.sql \
  007_ecc_command_rbac.sql \
  008_align_priority_bands.sql \
  009_ecc_auth.sql \
  010_decision_log_org.sql
do
  run_sql "$ROOT/migrations/$name"
done

# Workbook rows (findings, AED impacts, decisions, reports) are what the
# API tests read. Import after migrations so financial_exposure_aed exists,
# and before 04 so that script can format the stored impact text.
sample_xlsx="${ECC_SAMPLE_XLSX:-$(CDPATH= cd -- "$ROOT/.." && pwd)/reference/CyberCommandCenter_Sample_Data.xlsx}"
if [ ! -f "$sample_xlsx" ]; then
  echo "apply_app_schema: sample workbook missing ($sample_xlsx)" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "apply_app_schema: python3 is required to import the sample workbook" >&2
  exit 1
fi
run_sql "$ROOT/docker-init/03a_clear_bootstrap_catalog.sql"
sample_url="${DATABASE_URL:-postgresql://${USER}@/${DB}?host=/var/run/postgresql}"
echo "apply_app_schema: sample workbook $sample_xlsx"
DATABASE_URL="$sample_url" python3 "$ROOT/import_sample_data.py" \
  --xlsx "$sample_xlsx" \
  --database-url "$sample_url"

run_sql "$ROOT/docker-init/04_format_aed_impact_summaries.sql"
run_sql "$ROOT/docker-init/03_seed_tenants.sql"

echo "apply_app_schema: done ($DB)"
