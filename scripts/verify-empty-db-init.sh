#!/usr/bin/env bash
# CI-style check: apply the docker init SQL to a brand-new database and
# assert the columns demo:seed and the AED formatter require.
#
# Requires the compose Postgres (or any server reachable as $DATABASE_URL).
# Does not touch cyber_command_center. Drops ecc_init_probe when finished.
#
#   docker compose up -d db
#   ./scripts/verify-empty-db-init.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE_DB="${PROBE_DB:-ecc_init_probe}"
ADMIN_URL="${DATABASE_URL:-postgresql://ecc:ecc_dev_password@127.0.0.1:5433/postgres}"

psql_admin() {
  if command -v psql >/dev/null 2>&1; then
    psql "$ADMIN_URL" -v ON_ERROR_STOP=1 "$@"
    return
  fi
  docker compose -f "$ROOT/docker-compose.yml" exec -T db \
    psql -U ecc -d postgres -v ON_ERROR_STOP=1 "$@"
}

psql_probe() {
  if command -v psql >/dev/null 2>&1; then
    local probe_url
    probe_url="$(printf '%s' "$ADMIN_URL" | sed -E 's#/[^/?]+(\?.*)?$#/'"$PROBE_DB"'\1#')"
    psql "$probe_url" -v ON_ERROR_STOP=1 "$@"
    return
  fi
  docker compose -f "$ROOT/docker-compose.yml" exec -T db \
    psql -U ecc -d "$PROBE_DB" -v ON_ERROR_STOP=1 "$@"
}

cleanup() {
  psql_admin -c "DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Creating empty database ${PROBE_DB}"
psql_admin -c "DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE);"
psql_admin -c "CREATE DATABASE ${PROBE_DB} OWNER ecc;"

echo "==> Applying schema.sql, migrations 001-008, 04, tenant seed"
if command -v psql >/dev/null 2>&1; then
  probe_url="$(printf '%s' "$ADMIN_URL" | sed -E 's#/[^/?]+(\?.*)?$#/'"$PROBE_DB"'\1#')"
  ECC_SQL_ROOT="$ROOT/db" \
    POSTGRES_USER="${PGUSER:-ecc}" \
    POSTGRES_DB="$PROBE_DB" \
    DATABASE_URL="$probe_url" \
    PGHOST="$(printf '%s' "$probe_url" | sed -E 's#.*@([^:/]+).*#\1#')" \
    PGPORT="$(printf '%s' "$probe_url" | sed -E 's#.*:([0-9]+)/.*#\1#')" \
    PGDATABASE="$PROBE_DB" \
    PGUSER="${PGUSER:-ecc}" \
    PGPASSWORD="${PGPASSWORD:-ecc_dev_password}" \
    /bin/sh "$ROOT/db/docker-init/apply_app_schema.sh"
else
  docker compose -f "$ROOT/docker-compose.yml" exec -T \
    -e POSTGRES_USER=ecc \
    -e POSTGRES_DB="$PROBE_DB" \
    -e ECC_SQL_ROOT=/ecc-src/db \
    -e ECC_SAMPLE_XLSX=/ecc-src/reference/CyberCommandCenter_Sample_Data.xlsx \
    -e DATABASE_URL= \
    db /bin/sh /ecc-src/db/docker-init/apply_app_schema.sh
fi

echo "==> Asserting app columns and seed"
psql_probe -c "
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_units' AND column_name = 'code'
  ) AS business_units_code,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_impact_assessments'
      AND column_name = 'financial_exposure_aed'
  ) AS bia_financial_exposure_aed,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_impact_assessments'
      AND column_name = 'downtime_cost_per_hour_aed'
  ) AS bia_downtime_aed,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scenario_business_impacts'
      AND column_name = 'financial_exposure_aed'
  ) AS scenario_financial_exposure_aed,
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'
  ) AS users_role_dropped,
  (SELECT count(*) FROM schema_migrations WHERE version LIKE '00%') AS recorded_migrations,
  (SELECT count(*) FROM organizations) AS organizations,
  (SELECT count(*) FROM users) AS users,
  (SELECT count(*) FROM executive_decisions) AS decisions,
  (SELECT count(*) FROM generated_reports) AS reports;
"

psql_probe -v ON_ERROR_STOP=1 -c "
DO \$\$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_units' AND column_name = 'code'
  ) THEN
    RAISE EXCEPTION 'business_units.code missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_impact_assessments'
      AND column_name = 'financial_exposure_aed'
  ) THEN
    RAISE EXCEPTION 'business_impact_assessments.financial_exposure_aed missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scenario_business_impacts'
      AND column_name = 'financial_exposure_aed'
  ) THEN
    RAISE EXCEPTION 'scenario_business_impacts.financial_exposure_aed missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'
  ) THEN
    RAISE EXCEPTION 'users.role still present; migration 001 did not finish';
  END IF;
  IF (SELECT count(*) FROM schema_migrations WHERE version IN (
    '001_ecc_v2_foundation',
    '002_ecc_connector_signal_framework',
    '003_ecc_correlation_risk_engine',
    '004_ecc_executive_closed_loop',
    '005_ecc_enterprise_intelligence',
    '006_ecc_sample_ingestion_proof',
    '007_ecc_command_rbac'
  )) <> 7 THEN
    RAISE EXCEPTION 'expected migrations 001-007 recorded in schema_migrations';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM risk_policies
    WHERE org_id IS NULL AND is_active
      AND (config->'priority_bands'->>'critical')::numeric = 70
      AND (config->'priority_bands'->>'high')::numeric = 55
      AND (config->'priority_bands'->>'medium')::numeric = 35
  ) THEN
    RAISE EXCEPTION 'migration 008 did not align priority bands';
  END IF;
  IF (SELECT count(*) FROM organizations) < 5 OR (SELECT count(*) FROM users) < 40 THEN
    RAISE EXCEPTION 'sample import plus tenant seed did not load organizations and users';
  END IF;
  IF (SELECT count(*) FROM executive_decisions) < 1 OR (SELECT count(*) FROM generated_reports) < 1 THEN
    RAISE EXCEPTION 'sample import did not load decisions and reports';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE user_id = 'c1500001-a090-41a0-8ecc-000000000001'
  ) THEN
    RAISE EXCEPTION 'Al Dhabi CISO persona missing';
  END IF;
  IF (SELECT count(*) FROM roles WHERE code IN ('ciso', 'admin', 'risk_lead')) <> 3 THEN
    RAISE EXCEPTION 'demo role codes missing';
  END IF;
END
\$\$;
"

echo "verify-empty-db-init: ok"
