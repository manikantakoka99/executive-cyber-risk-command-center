-- ============================================================================
-- ECC Phase 3 — Cross-domain Correlation + Risk Scenario Engine
-- Extends Phase 1/2. No vendor adapters. No SIEM. No LLM scoring.
-- ============================================================================

-- Scenario lifecycle extensions (keep legacy values)
ALTER TYPE risk_scenario_status ADD VALUE IF NOT EXISTS 'candidate';
ALTER TYPE risk_scenario_status ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE risk_scenario_status ADD VALUE IF NOT EXISTS 'mitigated';

-- >>> ENUMS_COMMIT_POINT <<<

DO $$ BEGIN
  CREATE TYPE tolerance_state AS ENUM ('within','near','outside','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_velocity AS ENUM ('new','increasing','stable','decreasing','aging');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE priority_tier AS ENUM ('critical','high','medium','low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE control_effectiveness AS ENUM (
    'effective','partially_effective','ineffective','unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- SCENARIO attributes for executive risk object
-- ----------------------------------------------------------------------------
ALTER TABLE risk_scenarios
  ADD COLUMN IF NOT EXISTS scenario_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS priority priority_tier,
  ADD COLUMN IF NOT EXISTS priority_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS primary_domain_id UUID REFERENCES risk_domains(risk_domain_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_unit_id UUID,
  ADD COLUMN IF NOT EXISTS business_process_id UUID,
  ADD COLUMN IF NOT EXISTS tolerance_state tolerance_state NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS tolerance_reason TEXT,
  ADD COLUMN IF NOT EXISTS velocity risk_velocity NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS explanation TEXT,
  ADD COLUMN IF NOT EXISTS correlation_key VARCHAR(128),
  ADD COLUMN IF NOT EXISTS current_assessment_id UUID,
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

UPDATE risk_scenarios
SET first_seen_at = COALESCE(first_seen_at, created_at),
    last_seen_at = COALESCE(last_seen_at, updated_at, created_at)
WHERE first_seen_at IS NULL OR last_seen_at IS NULL;

DO $$ BEGIN
  ALTER TABLE risk_scenarios
    ADD CONSTRAINT fk_scenarios_bu
    FOREIGN KEY (org_id, business_unit_id)
    REFERENCES business_units(org_id, business_unit_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE risk_scenarios
    ADD CONSTRAINT fk_scenarios_bp
    FOREIGN KEY (org_id, business_process_id)
    REFERENCES business_processes(org_id, business_process_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scenarios_org_correlation_key
  ON risk_scenarios (org_id, correlation_key)
  WHERE correlation_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_scenarios_org_priority
  ON risk_scenarios (org_id, priority, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS ix_scenarios_org_tolerance
  ON risk_scenarios (org_id, tolerance_state);

-- Link current assessment (soft — history preserved in risk_assessments)
DO $$ BEGIN
  ALTER TABLE risk_scenarios
    ADD CONSTRAINT fk_scenarios_current_assessment
    FOREIGN KEY (org_id, current_assessment_id)
    REFERENCES risk_assessments(org_id, risk_assessment_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Assessment history enrichments
-- ----------------------------------------------------------------------------
ALTER TABLE risk_assessments
  ADD COLUMN IF NOT EXISTS control_adjustment NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS priority_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS priority_tier priority_tier,
  ADD COLUMN IF NOT EXISTS tolerance_state tolerance_state,
  ADD COLUMN IF NOT EXISTS tolerance_reason TEXT,
  ADD COLUMN IF NOT EXISTS velocity risk_velocity,
  ADD COLUMN IF NOT EXISTS explanation TEXT,
  ADD COLUMN IF NOT EXISTS calculation_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ix_risk_assessments_current
  ON risk_assessments (org_id, scenario_id)
  WHERE is_current = true;

ALTER TABLE scenario_controls
  ADD COLUMN IF NOT EXISTS effectiveness control_effectiveness NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS evidence_note TEXT;

-- ----------------------------------------------------------------------------
-- Correlation audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS correlation_events (
  correlation_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  scenario_id          UUID,
  signal_id            UUID,
  finding_id           UUID,
  rule_code            VARCHAR(80) NOT NULL,
  action               VARCHAR(40) NOT NULL, -- create | strengthen | skip | link_finding
  reason               TEXT NOT NULL,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- CASCADE (not SET NULL): composite FK SET NULL would also null org_id (NOT NULL)
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_correlation_events_org
  ON correlation_events (org_id, created_at DESC);

ALTER TABLE correlation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE correlation_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_correlation_events ON correlation_events;
CREATE POLICY tenant_isolation_correlation_events ON correlation_events
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

-- ----------------------------------------------------------------------------
-- Documented default development policy (weights NOT permanent product truth)
-- ----------------------------------------------------------------------------
UPDATE risk_policies
SET is_active = false
WHERE org_id IS NULL AND code = 'ecc_default' AND version = '1.0.0';

INSERT INTO risk_policies (org_id, code, version, display_name, is_active, effective_from, config)
SELECT NULL, 'ecc_default', '1.1.0', 'ECC Default Risk Policy (dev)', true, now(),
  '{
    "note": "Development defaults — product must approve production weights",
    "temporal_window_hours": 72,
    "min_signals_for_scenario": 2,
    "min_severity_for_single_signal": "critical",
    "likelihood_weights": {
      "threat_activity": 0.30,
      "exposure_reachability": 0.25,
      "exploitability": 0.20,
      "control_weakness": 0.15,
      "attack_evidence": 0.10
    },
    "impact_weights": {
      "financial": 0.30,
      "operational": 0.20,
      "business_criticality": 0.25,
      "regulatory_compliance": 0.15,
      "data_impact": 0.10
    },
    "control_reduction": {
      "effective": 0.45,
      "partially_effective": 0.20,
      "ineffective": 0.0,
      "unknown": 0.05
    },
    "tolerance": {
      "default_max_residual": 50,
      "near_band": 10
    },
    "priority_bands": {
      "critical": 80,
      "high": 60,
      "medium": 35
    }
  }'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM risk_policies WHERE org_id IS NULL AND code = 'ecc_default' AND version = '1.1.0'
);

-- Seed policy factors from config (for transparency / UI)
INSERT INTO risk_policy_factors (policy_id, factor_category, factor_code, weight, enabled)
SELECT p.policy_id, 'likelihood', f.key, (f.value)::numeric, true
FROM risk_policies p,
     LATERAL jsonb_each_text(p.config->'likelihood_weights') AS f(key, value)
WHERE p.code = 'ecc_default' AND p.version = '1.1.0'
ON CONFLICT (policy_id, factor_category, factor_code) DO UPDATE SET weight = EXCLUDED.weight;

INSERT INTO risk_policy_factors (policy_id, factor_category, factor_code, weight, enabled)
SELECT p.policy_id, 'impact', f.key, (f.value)::numeric, true
FROM risk_policies p,
     LATERAL jsonb_each_text(p.config->'impact_weights') AS f(key, value)
WHERE p.code = 'ecc_default' AND p.version = '1.1.0'
ON CONFLICT (policy_id, factor_category, factor_code) DO UPDATE SET weight = EXCLUDED.weight;

-- Default org tolerance rules (max residual 50) for each org missing one
INSERT INTO risk_tolerance_rules (org_id, policy_id, max_residual_risk, escalate_if_exceeds, is_active)
SELECT o.org_id, p.policy_id, 50, true, true
FROM organizations o
CROSS JOIN risk_policies p
WHERE p.org_id IS NULL AND p.code = 'ecc_default' AND p.version = '1.1.0' AND p.is_active
  AND NOT EXISTS (
    SELECT 1 FROM risk_tolerance_rules t WHERE t.org_id = o.org_id AND t.is_active
  );

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
  '003_ecc_correlation_risk_engine',
  'Phase 3: correlation engine, scenario lifecycle, risk assessment history, policy 1.1.0 defaults'
)
ON CONFLICT (version) DO NOTHING;
