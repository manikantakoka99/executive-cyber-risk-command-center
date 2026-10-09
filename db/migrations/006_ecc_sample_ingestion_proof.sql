-- ============================================================================
-- ECC Phase 6 — Sample workbook ingestion proof of feasibility
-- Extends canonical signals for event vs posture without changing risk engine.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE signal_kind AS ENUM (
    'event',
    'posture_metric',
    'assessment',
    'compliance_observation'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- >>> ENUMS_COMMIT_POINT <<<

ALTER TABLE security_signals
  ADD COLUMN IF NOT EXISTS signal_kind signal_kind NOT NULL DEFAULT 'event',
  ADD COLUMN IF NOT EXISTS metric_id VARCHAR(40),
  ADD COLUMN IF NOT EXISTS numerator NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS denominator NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS quality_flag VARCHAR(80),
  ADD COLUMN IF NOT EXISTS tool_category VARCHAR(160),
  ADD COLUMN IF NOT EXISTS missing_timestamp BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unmapped_domain BOOLEAN NOT NULL DEFAULT false;

-- Allow posture / missing-time records without inventing event time or severity
ALTER TABLE security_signals ALTER COLUMN observed_at DROP NOT NULL;
ALTER TABLE security_signals ALTER COLUMN severity DROP NOT NULL;

CREATE INDEX IF NOT EXISTS ix_signals_org_kind
  ON security_signals (org_id, signal_kind);
CREATE INDEX IF NOT EXISTS ix_signals_org_metric
  ON security_signals (org_id, metric_id)
  WHERE metric_id IS NOT NULL;

-- Sync-run quality extensions for workbook proof
ALTER TABLE connector_sync_runs
  ADD COLUMN IF NOT EXISTS canonical_records INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posture_metrics INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS event_signals INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assessment_signals INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS compliance_observations INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unmapped_domains INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ready_for_correlation INTEGER NOT NULL DEFAULT 0;

-- Taxonomy: posture / workbook observation event types
INSERT INTO signal_event_types (code, display_name, domain_code) VALUES
  ('posture_observation', 'Posture Observation', NULL),
  ('compliance_observation', 'Compliance Observation', 'compliance_engine'),
  ('assessment_observation', 'Assessment Observation', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO signal_source_types (code, display_name, domain_code) VALUES
  ('workbook_sample', 'ECC Sample Workbook Fixture', 'unmapped')
ON CONFLICT (code) DO NOTHING;

-- Track last sample-workbook run per org (demo/dev)
CREATE TABLE IF NOT EXISTS sample_workbook_runs (
  run_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  connector_id   UUID REFERENCES connectors(connector_id) ON DELETE SET NULL,
  sync_run_id    UUID REFERENCES connector_sync_runs(sync_run_id) ON DELETE SET NULL,
  status         VARCHAR(40) NOT NULL DEFAULT 'running',
  source_path    TEXT NOT NULL,
  records_received INTEGER NOT NULL DEFAULT 0,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  UNIQUE (org_id, run_id)
);
CREATE INDEX IF NOT EXISTS ix_sample_wb_runs_org_time
  ON sample_workbook_runs (org_id, started_at DESC);

ALTER TABLE sample_workbook_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sample_workbook_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_sample_wb_runs ON sample_workbook_runs;
CREATE POLICY tenant_isolation_sample_wb_runs ON sample_workbook_runs
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

INSERT INTO schema_migrations (version) VALUES ('006_ecc_sample_ingestion_proof')
ON CONFLICT DO NOTHING;
