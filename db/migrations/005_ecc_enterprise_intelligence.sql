-- ============================================================================
-- ECC Phase 5 — Enterprise Command Center Intelligence + Governance
-- Extends Phases 1–4. No rebuild of connectors/correlation/risk engines.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE material_change_severity AS ENUM ('critical','high','medium','low','info');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_lifecycle AS ENUM ('draft','published','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- >>> ENUMS_COMMIT_POINT <<<

-- ----------------------------------------------------------------------------
-- Organization configuration (no hardcoded client hierarchy)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_settings (
  org_id                    UUID PRIMARY KEY REFERENCES organizations(org_id) ON DELETE CASCADE,
  default_risk_appetite     NUMERIC(5,2) NOT NULL DEFAULT 50,
  active_risk_policy_id     UUID REFERENCES risk_policies(policy_id) ON DELETE SET NULL,
  reporting_default_window  VARCHAR(20) NOT NULL DEFAULT '30d',
  executive_thresholds      JSONB NOT NULL DEFAULT '{
    "outside_tolerance_alert": true,
    "stale_connector_hours": 72,
    "material_residual_delta": 10
  }'::jsonb,
  display_labels            JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled_framework_codes   TEXT[] NOT NULL DEFAULT '{}',
  terminology               JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_org_appetite CHECK (
    default_risk_appetite >= 0 AND default_risk_appetite <= 100
  )
);

INSERT INTO org_settings (org_id, default_risk_appetite)
SELECT o.org_id, 50 FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM org_settings s WHERE s.org_id = o.org_id);

ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_org_settings ON org_settings;
CREATE POLICY tenant_isolation_org_settings ON org_settings
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

-- ----------------------------------------------------------------------------
-- Material change detection events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_changes (
  material_change_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  reason_code        VARCHAR(80) NOT NULL,
  severity           material_change_severity NOT NULL DEFAULT 'medium',
  entity_type        VARCHAR(80) NOT NULL,
  entity_id          UUID,
  summary            TEXT NOT NULL,
  details            JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at    TIMESTAMPTZ,
  acknowledged_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
  UNIQUE (org_id, material_change_id)
);
CREATE INDEX IF NOT EXISTS ix_material_changes_org_time
  ON material_changes (org_id, detected_at DESC);

ALTER TABLE material_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_material_changes ON material_changes;
CREATE POLICY tenant_isolation_material_changes ON material_changes
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

-- ----------------------------------------------------------------------------
-- Immutable report snapshots (extend generated_reports)
-- ----------------------------------------------------------------------------
ALTER TABLE generated_reports
  ADD COLUMN IF NOT EXISTS report_type_code VARCHAR(80),
  ADD COLUMN IF NOT EXISTS reporting_period VARCHAR(40),
  ADD COLUMN IF NOT EXISTS data_as_of TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status report_lifecycle NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS generation_version VARCHAR(40) NOT NULL DEFAULT 'ecc-report-v1',
  ADD COLUMN IF NOT EXISTS content_hash VARCHAR(128),
  ADD COLUMN IF NOT EXISTS snapshot_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS content_markdown TEXT,
  ADD COLUMN IF NOT EXISTS title VARCHAR(300);

UPDATE generated_reports
SET report_type_code = COALESCE(report_type_code, report_type::text),
    data_as_of = COALESCE(data_as_of, generated_at),
    reporting_period = COALESCE(
      reporting_period,
      CASE
        WHEN period_start IS NOT NULL AND period_end IS NOT NULL
          THEN to_char(period_start, 'YYYY-MM-DD') || '/' || to_char(period_end, 'YYYY-MM-DD')
        ELSE 'point_in_time'
      END
    ),
    title = COALESCE(title, initcap(replace(report_type::text, '_', ' ')))
WHERE title IS NULL OR report_type_code IS NULL;

CREATE INDEX IF NOT EXISTS ix_generated_reports_org_time
  ON generated_reports (org_id, generated_at DESC);

-- ----------------------------------------------------------------------------
-- Portfolio cache optional — not required; analytics compute live from scenarios
-- ----------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ccc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ccc_app;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecc') THEN
    GRANT ALL ON ALL TABLES IN SCHEMA public TO ecc;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ecc;
  END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES (
  '005_ecc_enterprise_intelligence',
  'Phase 5: org_settings, material_changes, immutable report snapshots'
)
ON CONFLICT (version) DO NOTHING;
