-- ============================================================================
-- ECC Phase 4 — Business Impact + Executive Decision Intelligence
-- Extends Phase 1–3. No connector/correlation rebuild. No invented AED.
-- ============================================================================

-- Decision outcomes (keep legacy)
ALTER TYPE decision_status ADD VALUE IF NOT EXISTS 'acknowledged';
ALTER TYPE decision_status ADD VALUE IF NOT EXISTS 'accepted_risk';
ALTER TYPE decision_status ADD VALUE IF NOT EXISTS 'monitoring';

-- Action status: API "open" maps to pending; add open for clarity
ALTER TYPE action_status ADD VALUE IF NOT EXISTS 'open';

-- >>> ENUMS_COMMIT_POINT <<<

DO $$ BEGIN
  CREATE TYPE risk_treatment_type AS ENUM ('mitigate','transfer','avoid','accept','monitor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE treatment_plan_status AS ENUM (
    'proposed','approved','in_progress','blocked','completed','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM (
    'pending','verified','failed','inconclusive'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Scenario-level business impact (separate from finding-level BIAs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scenario_business_impacts (
  scenario_impact_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  scenario_id               UUID NOT NULL,
  financial_exposure_aed    NUMERIC(14,2),          -- NULL = unknown (never invent)
  financial_known           BOOLEAN NOT NULL DEFAULT false,
  downtime_cost_per_hour_aed NUMERIC(14,2),
  expected_downtime_hours   NUMERIC(10,2),
  affected_business_unit_id UUID,
  affected_business_process_id UUID,
  affected_business_unit    VARCHAR(200),
  affected_business_process VARCHAR(200),
  business_criticality      VARCHAR(40),
  regulatory_impact         TEXT,
  data_impact               TEXT,
  operational_impact        TEXT,
  reputational_impact       TEXT,
  confidence                NUMERIC(5,2),
  explanation               TEXT NOT NULL,
  evidence_refs             JSONB NOT NULL DEFAULT '[]'::jsonb,
  derivation_meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_current                BOOLEAN NOT NULL DEFAULT true,
  calculated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, scenario_impact_id),
  FOREIGN KEY (org_id, scenario_id)
    REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE,
  CONSTRAINT chk_sbi_confidence CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 100)
  )
);
CREATE INDEX IF NOT EXISTS ix_sbi_org_scenario
  ON scenario_business_impacts (org_id, scenario_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS ix_sbi_current
  ON scenario_business_impacts (org_id, scenario_id) WHERE is_current = true;

ALTER TABLE scenario_business_impacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_business_impacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_sbi ON scenario_business_impacts;
CREATE POLICY tenant_isolation_sbi ON scenario_business_impacts
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

-- ----------------------------------------------------------------------------
-- Recommendations (deterministic engine output)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_recommendations (
  recommendation_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  scenario_id            UUID NOT NULL,
  recommended_treatment  risk_treatment_type NOT NULL,
  recommended_priority   priority_tier,
  recommended_action     TEXT NOT NULL,
  reason_codes           TEXT[] NOT NULL DEFAULT '{}',
  rationale              TEXT NOT NULL,
  economics_summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_current             BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, recommendation_id),
  FOREIGN KEY (org_id, scenario_id)
    REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_rec_org_scenario
  ON risk_recommendations (org_id, scenario_id, created_at DESC);

ALTER TABLE risk_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_recommendations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_rec ON risk_recommendations;
CREATE POLICY tenant_isolation_rec ON risk_recommendations
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

-- ----------------------------------------------------------------------------
-- Treatment plans
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS treatment_plans (
  treatment_plan_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  scenario_id                 UUID NOT NULL,
  treatment_type              risk_treatment_type NOT NULL,
  rationale                   TEXT NOT NULL,
  target_residual_risk        NUMERIC(5,2),
  target_date                 DATE,
  owner_user_id               UUID REFERENCES users(user_id) ON DELETE SET NULL,
  estimated_cost_aed          NUMERIC(14,2),       -- NULL = unknown
  estimated_remaining_exposure_aed NUMERIC(14,2),
  estimated_risk_reduction    NUMERIC(5,2),
  estimated_exposure_reduction_aed NUMERIC(14,2),
  estimated_roi               NUMERIC(10,4),       -- NULL = unknown / N/A
  economics_known             BOOLEAN NOT NULL DEFAULT false,
  economics_note              TEXT,
  status                      treatment_plan_status NOT NULL DEFAULT 'proposed',
  recommendation_id           UUID,
  is_current                  BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, treatment_plan_id),
  FOREIGN KEY (org_id, scenario_id)
    REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, recommendation_id)
    REFERENCES risk_recommendations(org_id, recommendation_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_tp_org_scenario
  ON treatment_plans (org_id, scenario_id, updated_at DESC);

CREATE TRIGGER trg_treatment_plans_updated
  BEFORE UPDATE ON treatment_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tp ON treatment_plans;
CREATE POLICY tenant_isolation_tp ON treatment_plans
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

-- ----------------------------------------------------------------------------
-- Executive decisions — treatment + scenario decision fields
-- ----------------------------------------------------------------------------
ALTER TABLE executive_decisions
  ADD COLUMN IF NOT EXISTS treatment_type risk_treatment_type,
  ADD COLUMN IF NOT EXISTS rationale TEXT,
  ADD COLUMN IF NOT EXISTS recommendation_id UUID,
  ADD COLUMN IF NOT EXISTS treatment_plan_id UUID,
  ADD COLUMN IF NOT EXISTS decision_owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE executive_decisions
    ADD CONSTRAINT fk_decisions_recommendation
    FOREIGN KEY (org_id, recommendation_id)
    REFERENCES risk_recommendations(org_id, recommendation_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE executive_decisions
    ADD CONSTRAINT fk_decisions_treatment_plan
    FOREIGN KEY (org_id, treatment_plan_id)
    REFERENCES treatment_plans(org_id, treatment_plan_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Composite SET NULL nulls org_id — use CASCADE for scenario-linked decisions
DO $$ BEGIN
  ALTER TABLE executive_decisions DROP CONSTRAINT IF EXISTS fk_decisions_scenario_tenant;
  ALTER TABLE executive_decisions
    ADD CONSTRAINT fk_decisions_scenario_tenant
    FOREIGN KEY (org_id, scenario_id)
    REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Actions — title, blocker, verification gate
-- ----------------------------------------------------------------------------
ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS title VARCHAR(300),
  ADD COLUMN IF NOT EXISTS blocker TEXT,
  ADD COLUMN IF NOT EXISTS verification_required BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS treatment_plan_id UUID;

DO $$ BEGIN
  ALTER TABLE actions
    ADD CONSTRAINT fk_actions_treatment_plan
    FOREIGN KEY (org_id, treatment_plan_id)
    REFERENCES treatment_plans(org_id, treatment_plan_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE actions SET title = COALESCE(title, left(description, 300))
WHERE title IS NULL;

-- ----------------------------------------------------------------------------
-- Verifications — closed-loop residual before/after
-- ----------------------------------------------------------------------------
ALTER TABLE risk_verifications
  ADD COLUMN IF NOT EXISTS verification_status verification_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_residual_risk NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS verified_residual_risk NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS previous_assessment_id UUID,
  ADD COLUMN IF NOT EXISTS new_assessment_id UUID,
  ADD COLUMN IF NOT EXISTS gates_risk_reduction BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE risk_verifications
    ADD CONSTRAINT fk_verif_prev_assessment
    FOREIGN KEY (org_id, previous_assessment_id)
    REFERENCES risk_assessments(org_id, risk_assessment_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE risk_verifications
    ADD CONSTRAINT fk_verif_new_assessment
    FOREIGN KEY (org_id, new_assessment_id)
    REFERENCES risk_assessments(org_id, risk_assessment_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sync result ↔ status for existing rows
UPDATE risk_verifications
SET verification_status = CASE result
  WHEN 'pass' THEN 'verified'::verification_status
  WHEN 'fail' THEN 'failed'::verification_status
  WHEN 'inconclusive' THEN 'inconclusive'::verification_status
  ELSE 'inconclusive'::verification_status
END
WHERE verification_status = 'pending' AND result IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Scenario pointers for current treatment / recommendation / impact
-- ----------------------------------------------------------------------------
ALTER TABLE risk_scenarios
  ADD COLUMN IF NOT EXISTS current_impact_id UUID,
  ADD COLUMN IF NOT EXISTS current_recommendation_id UUID,
  ADD COLUMN IF NOT EXISTS current_treatment_plan_id UUID,
  ADD COLUMN IF NOT EXISTS decision_required BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE risk_scenarios
    ADD CONSTRAINT fk_scenarios_current_impact
    FOREIGN KEY (org_id, current_impact_id)
    REFERENCES scenario_business_impacts(org_id, scenario_impact_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE risk_scenarios
    ADD CONSTRAINT fk_scenarios_current_rec
    FOREIGN KEY (org_id, current_recommendation_id)
    REFERENCES risk_recommendations(org_id, recommendation_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE risk_scenarios
    ADD CONSTRAINT fk_scenarios_current_tp
    FOREIGN KEY (org_id, current_treatment_plan_id)
    REFERENCES treatment_plans(org_id, treatment_plan_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
  '004_ecc_executive_closed_loop',
  'Phase 4: scenario business impact, treatment plans, recommendations, closed-loop verification'
)
ON CONFLICT (version) DO NOTHING;
