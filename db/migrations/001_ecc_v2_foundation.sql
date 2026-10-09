-- ============================================================================
-- ECC DATABASE v2 FOUNDATION — Additive migration (Phase 1)
-- ============================================================================
-- Purpose: Evolve MVP schema into enterprise-ready foundation for
--          Signals → Normalize → Correlate → Scenario → Risk → Decision → Action → Verify
-- Non-goals: scoring formulas, connectors adapters, fake sample scores
-- Safe: preserves organizations, users, domains, findings, impacts, decisions,
--       compliance, activity, reports, audit history
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT
);

-- Already applied? skip body via advisory guard in apply script; still idempotent DDL below.

-- ----------------------------------------------------------------------------
-- ENUM extensions (new types; keep legacy enums)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE asset_type AS ENUM (
    'application','host','network','cloud_resource','identity','ot_device','data_store','service','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE asset_criticality AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE asset_environment AS ENUM ('production','staging','development','dr','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE processing_status AS ENUM (
    'received','validated','normalized','failed','quarantined','ignored'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE connector_status AS ENUM ('active','inactive','error','pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_run_status AS ENUM ('running','succeeded','failed','partial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE control_status AS ENUM ('planned','implemented','partial','not_applicable','retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE action_status AS ENUM (
    'pending','in_progress','blocked','completed','cancelled','verified'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE verification_result AS ENUM ('pass','fail','partial','inconclusive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_scenario_status AS ENUM (
    'open','monitoring','accepted','mitigating','closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- TENANCY / RBAC
-- ============================================================================
CREATE TABLE IF NOT EXISTS roles (
  role_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(64) NOT NULL UNIQUE,
  display_name  VARCHAR(120) NOT NULL,
  description   TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
  permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(96) NOT NULL UNIQUE,
  display_name  VARCHAR(160) NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS ix_user_roles_org ON user_roles(org_id);
CREATE INDEX IF NOT EXISTS ix_user_roles_user ON user_roles(user_id);

-- Seed system + legacy demo-compatible role codes (API still uses cxo/domain_analyst/…)
INSERT INTO roles (code, display_name, description) VALUES
  ('super_admin', 'SUPER_ADMIN', 'Platform super administrator'),
  ('platform_admin', 'PLATFORM_ADMIN', 'Platform administrator'),
  ('org_admin', 'ORG_ADMIN', 'Organization administrator'),
  ('ciso', 'CISO', 'Chief Information Security Officer'),
  ('cxo', 'CXO', 'Executive decision maker (legacy-compatible code)'),
  ('risk_manager', 'RISK_MANAGER', 'Enterprise risk manager'),
  ('security_analyst', 'SECURITY_ANALYST', 'Security analyst'),
  ('compliance_manager', 'COMPLIANCE_MANAGER', 'Compliance manager'),
  ('business_owner', 'BUSINESS_OWNER', 'Business owner'),
  ('domain_analyst', 'DOMAIN_ANALYST', 'Domain analyst (legacy demo)'),
  ('program_office', 'PROGRAM_OFFICE', 'Program office (legacy demo)'),
  ('board_member', 'BOARD_MEMBER', 'Board member (legacy demo)'),
  ('auditor', 'AUDITOR', 'Auditor (legacy demo)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, display_name) VALUES
  ('ecc.overview.read', 'Read overview'),
  ('ecc.findings.read', 'Read findings'),
  ('ecc.decisions.read', 'Read decisions'),
  ('ecc.decisions.act', 'Act on executive decisions'),
  ('ecc.reports.generate', 'Generate reports'),
  ('ecc.admin.org', 'Administer organization'),
  ('ecc.admin.platform', 'Administer platform')
ON CONFLICT (code) DO NOTHING;

-- Minimal role→permission seed (foundation only; not a full authz engine)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('super_admin','platform_admin','org_admin','ciso','cxo')
   OR (r.code IN ('domain_analyst','security_analyst','program_office','risk_manager')
       AND p.code IN ('ecc.overview.read','ecc.findings.read','ecc.decisions.read'))
   OR (r.code IN ('cxo','ciso','org_admin','super_admin','platform_admin')
       AND p.code IN ('ecc.decisions.act','ecc.reports.generate'))
   OR (r.code IN ('auditor','compliance_manager','board_member')
       AND p.code IN ('ecc.overview.read','ecc.findings.read','ecc.decisions.read','ecc.reports.generate'))
ON CONFLICT DO NOTHING;

-- Backfill user_roles from users.role (column still present until dropped below)
INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
SELECT u.user_id, r.role_id, u.org_id, true
FROM users u
JOIN roles r ON r.code = u.role::text
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.user_id AND ur.role_id = r.role_id
);

-- Compatibility view for primary role code (used by API after column drop)
CREATE OR REPLACE VIEW v_user_primary_role AS
SELECT DISTINCT ON (ur.user_id)
  ur.user_id,
  ur.org_id,
  r.code AS role_code,
  r.display_name AS role_display_name
FROM user_roles ur
JOIN roles r ON r.role_id = ur.role_id
ORDER BY ur.user_id, ur.is_primary DESC, ur.assigned_at ASC;

-- Drop legacy single-role column after backfill
ALTER TABLE users DROP COLUMN IF EXISTS role;

-- ============================================================================
-- BUSINESS CONTEXT — assets first-class
-- ============================================================================
CREATE TABLE IF NOT EXISTS business_units (
  business_unit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  code             VARCHAR(64),
  name             VARCHAR(200) NOT NULL,
  parent_unit_id   UUID REFERENCES business_units(business_unit_id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, business_unit_id),
  UNIQUE (org_id, name)
);
CREATE INDEX IF NOT EXISTS ix_bu_org ON business_units(org_id);

CREATE TABLE IF NOT EXISTS business_processes (
  business_process_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  business_unit_id    UUID,
  name                VARCHAR(200) NOT NULL,
  criticality         asset_criticality NOT NULL DEFAULT 'medium',
  description         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, business_process_id),
  FOREIGN KEY (org_id, business_unit_id)
    REFERENCES business_units(org_id, business_unit_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_bp_org ON business_processes(org_id);

CREATE TABLE IF NOT EXISTS assets (
  asset_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  name                VARCHAR(250) NOT NULL,
  asset_type          asset_type NOT NULL DEFAULT 'other',
  criticality         asset_criticality NOT NULL DEFAULT 'medium',
  environment         asset_environment NOT NULL DEFAULT 'unknown',
  internet_exposed    BOOLEAN NOT NULL DEFAULT false,
  business_unit_id    UUID,
  owner_user_id       UUID REFERENCES users(user_id) ON DELETE SET NULL,
  data_classification VARCHAR(100),
  status              VARCHAR(40) NOT NULL DEFAULT 'active',
  metadata            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, asset_id),
  UNIQUE (org_id, name),
  FOREIGN KEY (org_id, business_unit_id)
    REFERENCES business_units(org_id, business_unit_id) ON DELETE SET NULL,
  CONSTRAINT chk_assets_status CHECK (status IN ('active','retired','unknown','inventory'))
);
CREATE INDEX IF NOT EXISTS ix_assets_org ON assets(org_id);
CREATE INDEX IF NOT EXISTS ix_assets_org_type ON assets(org_id, asset_type);
CREATE TRIGGER trg_assets_updated
  BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS asset_business_processes (
  asset_id            UUID NOT NULL,
  business_process_id UUID NOT NULL,
  org_id              UUID NOT NULL,
  PRIMARY KEY (asset_id, business_process_id),
  FOREIGN KEY (org_id, asset_id) REFERENCES assets(org_id, asset_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, business_process_id)
    REFERENCES business_processes(org_id, business_process_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS asset_identifiers (
  identifier_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  asset_id        UUID NOT NULL,
  id_type         VARCHAR(64) NOT NULL,  -- ip, hostname, fqdn, cloud_resource_id, …
  id_value        VARCHAR(500) NOT NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  source          VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, asset_id) REFERENCES assets(org_id, asset_id) ON DELETE CASCADE,
  UNIQUE (org_id, id_type, id_value)
);
CREATE INDEX IF NOT EXISTS ix_asset_identifiers_asset ON asset_identifiers(org_id, asset_id);

CREATE TABLE IF NOT EXISTS asset_relationships (
  relationship_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  from_asset_id   UUID NOT NULL,
  to_asset_id     UUID NOT NULL,
  relationship_type VARCHAR(64) NOT NULL, -- depends_on, connects_to, hosts, …
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, from_asset_id) REFERENCES assets(org_id, asset_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, to_asset_id) REFERENCES assets(org_id, asset_id) ON DELETE CASCADE,
  CHECK (from_asset_id <> to_asset_id),
  UNIQUE (org_id, from_asset_id, to_asset_id, relationship_type)
);

-- ============================================================================
-- CONNECTOR FOUNDATION (no vendor adapters / no secrets in cleartext)
-- ============================================================================
CREATE TABLE IF NOT EXISTS connectors (
  connector_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  risk_domain_id      UUID NOT NULL REFERENCES risk_domains(risk_domain_id) ON DELETE CASCADE,
  name                VARCHAR(160) NOT NULL,
  vendor              VARCHAR(120),
  connector_type      VARCHAR(80) NOT NULL DEFAULT 'api', -- api, webhook, file, agent
  status              connector_status NOT NULL DEFAULT 'pending',
  last_sync_at        TIMESTAMPTZ,
  -- Reference only — never store credentials in this table's migrations/seed
  secret_ref          VARCHAR(250),
  config_ref          VARCHAR(250),
  config_nonsecret    JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, connector_id),
  UNIQUE (org_id, risk_domain_id, name)
);
CREATE INDEX IF NOT EXISTS ix_connectors_org_domain ON connectors(org_id, risk_domain_id);
CREATE TRIGGER trg_connectors_updated
  BEFORE UPDATE ON connectors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS connector_sync_runs (
  sync_run_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  connector_id      UUID NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  status            sync_run_status NOT NULL DEFAULT 'running',
  records_received  INT NOT NULL DEFAULT 0,
  records_processed INT NOT NULL DEFAULT 0,
  records_failed    INT NOT NULL DEFAULT 0,
  error_summary     TEXT,
  checkpoint_cursor TEXT,
  metadata          JSONB,
  FOREIGN KEY (org_id, connector_id) REFERENCES connectors(org_id, connector_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_sync_runs_org ON connector_sync_runs(org_id, started_at DESC);

-- ============================================================================
-- INGESTION — raw_events (idempotent by org+connector+source_event_id)
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw_events (
  raw_event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  connector_id      UUID NOT NULL,
  source_event_id   VARCHAR(250) NOT NULL,
  event_type        VARCHAR(120),
  source_timestamp  TIMESTAMPTZ,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload           JSONB NOT NULL,
  payload_hash      VARCHAR(128) NOT NULL,
  processing_status processing_status NOT NULL DEFAULT 'received',
  processing_error  TEXT,
  UNIQUE (org_id, connector_id, source_event_id),
  FOREIGN KEY (org_id, connector_id) REFERENCES connectors(org_id, connector_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_raw_events_org_received ON raw_events(org_id, received_at DESC);
CREATE INDEX IF NOT EXISTS ix_raw_events_org_status ON raw_events(org_id, processing_status);

-- ============================================================================
-- CANONICAL SIGNAL
-- ============================================================================
CREATE TABLE IF NOT EXISTS security_signals (
  signal_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  raw_event_id      UUID REFERENCES raw_events(raw_event_id) ON DELETE SET NULL,
  connector_id      UUID,
  risk_domain_id    UUID NOT NULL REFERENCES risk_domains(risk_domain_id) ON DELETE CASCADE,
  event_type        VARCHAR(120) NOT NULL,
  severity          severity_level,
  asset_id          UUID,
  related_user_id   UUID REFERENCES users(user_id) ON DELETE SET NULL,
  observed_at       TIMESTAMPTZ NOT NULL,
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  title             VARCHAR(300),
  normalized_payload JSONB,
  vendor_extensions  JSONB,
  UNIQUE (org_id, signal_id),
  FOREIGN KEY (org_id, asset_id) REFERENCES assets(org_id, asset_id) ON DELETE SET NULL,
  FOREIGN KEY (org_id, connector_id) REFERENCES connectors(org_id, connector_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_signals_org_observed ON security_signals(org_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_signals_org_domain ON security_signals(org_id, risk_domain_id);
CREATE INDEX IF NOT EXISTS ix_signals_org_asset ON security_signals(org_id, asset_id);

-- ============================================================================
-- EVOLVE FINDINGS — asset_id + fingerprint (keep affected_asset text for legacy)
-- ============================================================================
ALTER TABLE risk_findings
  ADD COLUMN IF NOT EXISTS asset_id UUID,
  ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(128),
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source VARCHAR(120);

UPDATE risk_findings
SET first_seen_at = COALESCE(first_seen_at, detected_at),
    last_seen_at  = COALESCE(last_seen_at, COALESCE(resolved_at, updated_at, detected_at))
WHERE first_seen_at IS NULL OR last_seen_at IS NULL;

-- Backfill assets from affected_asset free text
INSERT INTO assets (org_id, name, asset_type, criticality, environment, internet_exposed, status)
SELECT DISTINCT f.org_id,
       f.affected_asset,
       CASE
         WHEN lower(f.affected_asset) LIKE '%gateway%'
           OR lower(f.affected_asset) LIKE '%portal%'
           OR lower(f.affected_asset) LIKE '%api%'
           OR lower(f.affected_asset) LIKE '%checkout%'
           OR lower(f.affected_asset) LIKE '%service%' THEN 'application'::asset_type
         WHEN lower(f.affected_asset) LIKE '%infrastructure%' THEN 'host'::asset_type
         ELSE 'other'::asset_type
       END,
       CASE
         WHEN lower(f.affected_asset) LIKE '%payment%'
           OR lower(f.affected_asset) LIKE '%gateway%' THEN 'critical'::asset_criticality
         ELSE 'medium'::asset_criticality
       END,
       'production'::asset_environment,
       (lower(f.affected_asset) LIKE '%public%'
         OR lower(f.affected_asset) LIKE '%customer%'
         OR lower(f.affected_asset) LIKE '%online%'
         OR lower(f.affected_asset) LIKE '%gateway%'),
       'active'
FROM risk_findings f
WHERE f.affected_asset IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM assets a WHERE a.org_id = f.org_id AND a.name = f.affected_asset
  );

UPDATE risk_findings f
SET asset_id = a.asset_id
FROM assets a
WHERE f.asset_id IS NULL
  AND f.affected_asset IS NOT NULL
  AND a.org_id = f.org_id
  AND a.name = f.affected_asset;

-- Tenant-safe FK for findings → assets
DO $$ BEGIN
  ALTER TABLE risk_findings
    ADD CONSTRAINT fk_findings_asset_tenant
    FOREIGN KEY (org_id, asset_id) REFERENCES assets(org_id, asset_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_findings_org_fingerprint
  ON risk_findings(org_id, fingerprint)
  WHERE fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_findings_org_asset ON risk_findings(org_id, asset_id);

-- ============================================================================
-- RISK SCENARIOS (central business-risk object)
-- ============================================================================
CREATE TABLE IF NOT EXISTS risk_scenarios (
  scenario_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  title           VARCHAR(300) NOT NULL,
  description     TEXT,
  status          risk_scenario_status NOT NULL DEFAULT 'open',
  primary_asset_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, scenario_id),
  FOREIGN KEY (org_id, primary_asset_id) REFERENCES assets(org_id, asset_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_scenarios_org_status ON risk_scenarios(org_id, status);
CREATE TRIGGER trg_scenarios_updated
  BEFORE UPDATE ON risk_scenarios FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS risk_scenario_domains (
  scenario_id     UUID NOT NULL,
  risk_domain_id  UUID NOT NULL REFERENCES risk_domains(risk_domain_id) ON DELETE CASCADE,
  org_id          UUID NOT NULL,
  PRIMARY KEY (scenario_id, risk_domain_id),
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS risk_scenario_findings (
  scenario_id UUID NOT NULL,
  finding_id  UUID NOT NULL,
  org_id      UUID NOT NULL,
  PRIMARY KEY (scenario_id, finding_id),
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE,
  FOREIGN KEY (finding_id) REFERENCES risk_findings(finding_id) ON DELETE CASCADE
);
-- Enforce finding belongs to same org as scenario
CREATE OR REPLACE FUNCTION enforce_scenario_finding_org() RETURNS TRIGGER AS $$
DECLARE f_org UUID; s_org UUID;
BEGIN
  SELECT org_id INTO f_org FROM risk_findings WHERE finding_id = NEW.finding_id;
  SELECT org_id INTO s_org FROM risk_scenarios WHERE scenario_id = NEW.scenario_id;
  IF f_org IS DISTINCT FROM s_org OR f_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'cross-tenant scenario_finding blocked';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scenario_finding_org ON risk_scenario_findings;
CREATE TRIGGER trg_scenario_finding_org
  BEFORE INSERT OR UPDATE ON risk_scenario_findings
  FOR EACH ROW EXECUTE FUNCTION enforce_scenario_finding_org();

CREATE TABLE IF NOT EXISTS risk_scenario_signals (
  scenario_id UUID NOT NULL,
  signal_id   UUID NOT NULL,
  org_id      UUID NOT NULL,
  PRIMARY KEY (scenario_id, signal_id),
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, signal_id) REFERENCES security_signals(org_id, signal_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS risk_scenario_assets (
  scenario_id UUID NOT NULL,
  asset_id    UUID NOT NULL,
  org_id      UUID NOT NULL,
  PRIMARY KEY (scenario_id, asset_id),
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, asset_id) REFERENCES assets(org_id, asset_id) ON DELETE CASCADE
);

-- ============================================================================
-- CONTROLS
-- ============================================================================
CREATE TABLE IF NOT EXISTS controls (
  control_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  name         VARCHAR(200) NOT NULL,
  control_type VARCHAR(80),
  owner_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  status       control_status NOT NULL DEFAULT 'planned',
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, control_id),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS scenario_controls (
  scenario_id        UUID NOT NULL,
  control_id         UUID NOT NULL,
  org_id             UUID NOT NULL,
  effectiveness_score NUMERIC(5,2),
  assessment_status  VARCHAR(40) NOT NULL DEFAULT 'unknown',
  last_tested_at     TIMESTAMPTZ,
  PRIMARY KEY (scenario_id, control_id),
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, control_id) REFERENCES controls(org_id, control_id) ON DELETE CASCADE,
  CONSTRAINT chk_ctrl_eff CHECK (
    effectiveness_score IS NULL OR (effectiveness_score >= 0 AND effectiveness_score <= 100)
  )
);

-- ============================================================================
-- RISK ASSESSMENT FOUNDATION (store results later — no formulas here)
-- ============================================================================
CREATE TABLE IF NOT EXISTS likelihood_assessments (
  likelihood_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  scenario_id     UUID NOT NULL,
  score           NUMERIC(5,2),
  method          VARCHAR(80) NOT NULL DEFAULT 'policy_rules',
  assessed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  policy_version  VARCHAR(40),
  notes           TEXT,
  UNIQUE (org_id, likelihood_id),
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE,
  CONSTRAINT chk_likelihood_score CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);

CREATE TABLE IF NOT EXISTS impact_assessments (
  impact_assessment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  scenario_id          UUID NOT NULL,
  score                NUMERIC(5,2),
  financial_aed        NUMERIC(14,2),
  method               VARCHAR(80) NOT NULL DEFAULT 'policy_rules',
  assessed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  policy_version       VARCHAR(40),
  notes                TEXT,
  UNIQUE (org_id, impact_assessment_id),
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE,
  CONSTRAINT chk_impact_score CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);

CREATE TABLE IF NOT EXISTS risk_assessments (
  risk_assessment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  scenario_id        UUID NOT NULL,
  likelihood_id      UUID,
  impact_assessment_id UUID,
  likelihood_score   NUMERIC(5,2),
  impact_score       NUMERIC(5,2),
  inherent_risk      NUMERIC(5,2),
  residual_risk      NUMERIC(5,2),
  confidence         NUMERIC(5,2),
  calculated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  policy_version     VARCHAR(40),
  UNIQUE (org_id, risk_assessment_id),
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, likelihood_id)
    REFERENCES likelihood_assessments(org_id, likelihood_id) ON DELETE SET NULL,
  FOREIGN KEY (org_id, impact_assessment_id)
    REFERENCES impact_assessments(org_id, impact_assessment_id) ON DELETE SET NULL,
  CONSTRAINT chk_ra_likelihood CHECK (likelihood_score IS NULL OR (likelihood_score >= 0 AND likelihood_score <= 100)),
  CONSTRAINT chk_ra_impact CHECK (impact_score IS NULL OR (impact_score >= 0 AND impact_score <= 100)),
  CONSTRAINT chk_ra_inherent CHECK (inherent_risk IS NULL OR (inherent_risk >= 0 AND inherent_risk <= 100)),
  CONSTRAINT chk_ra_residual CHECK (residual_risk IS NULL OR (residual_risk >= 0 AND residual_risk <= 100)),
  CONSTRAINT chk_ra_confidence CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100))
);
CREATE INDEX IF NOT EXISTS ix_risk_assessments_org_scenario
  ON risk_assessments(org_id, scenario_id, calculated_at DESC);

CREATE TABLE IF NOT EXISTS risk_assessment_factors (
  factor_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  risk_assessment_id UUID NOT NULL,
  factor_category    VARCHAR(40) NOT NULL, -- likelihood | impact
  factor_code        VARCHAR(80) NOT NULL, -- exploitability, exposure, financial, …
  factor_label       VARCHAR(160),
  raw_value          NUMERIC(12,4),
  normalized_value   NUMERIC(5,2),
  contribution_note  TEXT,
  FOREIGN KEY (org_id, risk_assessment_id)
    REFERENCES risk_assessments(org_id, risk_assessment_id) ON DELETE CASCADE,
  CONSTRAINT chk_raf_norm CHECK (
    normalized_value IS NULL OR (normalized_value >= 0 AND normalized_value <= 100)
  )
);

-- ============================================================================
-- RISK POLICY (versioned; no hardcoded weights in app)
-- ============================================================================
CREATE TABLE IF NOT EXISTS risk_policies (
  policy_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID REFERENCES organizations(org_id) ON DELETE CASCADE, -- NULL = platform default
  code           VARCHAR(80) NOT NULL,
  version        VARCHAR(40) NOT NULL,
  display_name   VARCHAR(160) NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT false,
  effective_from TIMESTAMPTZ,
  effective_to   TIMESTAMPTZ,
  config         JSONB NOT NULL DEFAULT '{}'::jsonb, -- normalization knobs (not secret)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_policies_org_code_ver
  ON risk_policies (org_id, code, version)
  WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_policies_platform_code_ver
  ON risk_policies (code, version)
  WHERE org_id IS NULL;

CREATE TABLE IF NOT EXISTS risk_policy_factors (
  policy_factor_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id        UUID NOT NULL REFERENCES risk_policies(policy_id) ON DELETE CASCADE,
  factor_category  VARCHAR(40) NOT NULL,
  factor_code      VARCHAR(80) NOT NULL,
  weight           NUMERIC(8,4), -- store weights here later; no formula in Phase 1
  enabled          BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (policy_id, factor_category, factor_code)
);

CREATE TABLE IF NOT EXISTS risk_tolerance_rules (
  tolerance_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  policy_id        UUID REFERENCES risk_policies(policy_id) ON DELETE SET NULL,
  business_unit_id UUID,
  asset_criticality asset_criticality,
  max_residual_risk NUMERIC(5,2) NOT NULL,
  escalate_if_exceeds BOOLEAN NOT NULL DEFAULT true,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, business_unit_id)
    REFERENCES business_units(org_id, business_unit_id) ON DELETE SET NULL,
  CONSTRAINT chk_tol_max CHECK (max_residual_risk >= 0 AND max_residual_risk <= 100)
);
CREATE INDEX IF NOT EXISTS ix_tolerance_org ON risk_tolerance_rules(org_id, is_active);

-- Platform default policy shell (empty weights — product to approve later)
INSERT INTO risk_policies (org_id, code, version, display_name, is_active, effective_from, config)
SELECT NULL, 'ecc_default', '1.0.0', 'ECC Default Risk Policy', true, now(),
       '{"note":"weights not yet approved — Phase 1 foundation only"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM risk_policies WHERE org_id IS NULL AND code = 'ecc_default' AND version = '1.0.0'
);

-- ============================================================================
-- EVIDENCE
-- ============================================================================
CREATE TABLE IF NOT EXISTS evidence (
  evidence_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  source           VARCHAR(120) NOT NULL,
  source_reference VARCHAR(300),
  evidence_type    VARCHAR(80) NOT NULL,
  storage_uri      TEXT,
  content_hash     VARCHAR(128),
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata         JSONB,
  UNIQUE (org_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS scenario_evidence (
  scenario_id  UUID NOT NULL,
  evidence_id  UUID NOT NULL,
  org_id       UUID NOT NULL,
  link_reason  VARCHAR(200),
  PRIMARY KEY (scenario_id, evidence_id),
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, evidence_id) REFERENCES evidence(org_id, evidence_id) ON DELETE CASCADE
);

-- ============================================================================
-- EXECUTIVE DECISIONS — scenario-centric (keep finding_id for MVP compat)
-- ============================================================================
ALTER TABLE executive_decisions
  ADD COLUMN IF NOT EXISTS scenario_id UUID;

DO $$ BEGIN
  ALTER TABLE executive_decisions
    ADD CONSTRAINT fk_decisions_scenario_tenant
    FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_decisions_org_scenario ON executive_decisions(org_id, scenario_id);

-- ============================================================================
-- ACTIONS (separate from decision_action_log audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS actions (
  action_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  decision_id     UUID,
  scenario_id     UUID,
  owner_user_id   UUID REFERENCES users(user_id) ON DELETE SET NULL,
  action_type     VARCHAR(80) NOT NULL,
  description     TEXT NOT NULL,
  status          action_status NOT NULL DEFAULT 'pending',
  priority        decision_priority NOT NULL DEFAULT 'medium',
  due_at          TIMESTAMPTZ,
  estimated_cost_aed NUMERIC(14,2),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, action_id),
  FOREIGN KEY (decision_id) REFERENCES executive_decisions(decision_id) ON DELETE SET NULL,
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_actions_org_status ON actions(org_id, status);
CREATE TRIGGER trg_actions_updated
  BEFORE UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION enforce_action_decision_org() RETURNS TRIGGER AS $$
DECLARE d_org UUID;
BEGIN
  IF NEW.decision_id IS NULL THEN RETURN NEW; END IF;
  SELECT org_id INTO d_org FROM executive_decisions WHERE decision_id = NEW.decision_id;
  IF d_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'cross-tenant action→decision blocked';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_action_decision_org ON actions;
CREATE TRIGGER trg_action_decision_org
  BEFORE INSERT OR UPDATE ON actions
  FOR EACH ROW EXECUTE FUNCTION enforce_action_decision_org();

-- ============================================================================
-- VERIFICATION
-- ============================================================================
CREATE TABLE IF NOT EXISTS risk_verifications (
  verification_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  scenario_id       UUID NOT NULL,
  action_id         UUID,
  verification_type VARCHAR(80) NOT NULL,
  source            VARCHAR(120),
  result            verification_result NOT NULL,
  verified_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_id       UUID,
  notes             TEXT,
  UNIQUE (org_id, verification_id),
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, action_id) REFERENCES actions(org_id, action_id) ON DELETE SET NULL,
  FOREIGN KEY (org_id, evidence_id) REFERENCES evidence(org_id, evidence_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_verifications_org ON risk_verifications(org_id, verified_at DESC);

-- ============================================================================
-- COMPLIANCE extensions
-- ============================================================================
CREATE TABLE IF NOT EXISTS framework_controls (
  framework_control_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id         UUID NOT NULL REFERENCES compliance_frameworks(framework_id) ON DELETE CASCADE,
  control_code         VARCHAR(64) NOT NULL,
  title                VARCHAR(250) NOT NULL,
  description          TEXT,
  UNIQUE (framework_id, control_code)
);

CREATE TABLE IF NOT EXISTS compliance_assessments (
  assessment_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  framework_id         UUID NOT NULL REFERENCES compliance_frameworks(framework_id) ON DELETE CASCADE,
  framework_control_id UUID REFERENCES framework_controls(framework_control_id) ON DELETE SET NULL,
  status               VARCHAR(40) NOT NULL DEFAULT 'unknown',
  coverage_pct         NUMERIC(5,2),
  gap_summary          TEXT,
  evidence_id          UUID,
  scenario_id          UUID,
  assessed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, assessment_id),
  FOREIGN KEY (org_id, evidence_id) REFERENCES evidence(org_id, evidence_id) ON DELETE SET NULL,
  FOREIGN KEY (org_id, scenario_id) REFERENCES risk_scenarios(org_id, scenario_id) ON DELETE SET NULL,
  CONSTRAINT chk_ca_coverage CHECK (coverage_pct IS NULL OR (coverage_pct >= 0 AND coverage_pct <= 100))
);
CREATE INDEX IF NOT EXISTS ix_compliance_assessments_org
  ON compliance_assessments(org_id, framework_id, assessed_at DESC);

-- ============================================================================
-- AUDIT enrichments
-- ============================================================================
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS ix_audit_org_time ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_correlation ON audit_log(correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Score constraints on existing snapshot tables (if missing)
DO $$ BEGIN
  ALTER TABLE domain_risk_snapshots
    ADD CONSTRAINT chk_domain_score_range CHECK (score >= 0 AND score <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE enterprise_risk_score_snapshots
    ADD CONSTRAINT chk_enterprise_score_range CHECK (score >= 0 AND score <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE org_compliance_status
    ADD CONSTRAINT chk_coverage_range CHECK (coverage_pct >= 0 AND coverage_pct <= 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- RLS for new tenant-scoped tables
-- ============================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_roles','business_units','business_processes','assets','asset_identifiers',
    'asset_relationships','connectors','connector_sync_runs','raw_events','security_signals',
    'risk_scenarios','controls','likelihood_assessments','impact_assessments','risk_assessments',
    'risk_assessment_factors','risk_tolerance_rules','evidence','actions','risk_verifications',
    'compliance_assessments'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation_%s ON %I',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_%s ON %I USING (org_id = current_setting(''app.current_org_id'', true)::UUID)',
      t, t
    );
  END LOOP;
END $$;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ccc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ccc_app;
GRANT SELECT ON v_user_primary_role TO ccc_app;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecc') THEN
    GRANT ALL ON ALL TABLES IN SCHEMA public TO ecc;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ecc;
    GRANT SELECT ON v_user_primary_role TO ecc;
  END IF;
END $$;

INSERT INTO schema_migrations (version, description)
VALUES ('001_ecc_v2_foundation', 'Phase 1: RBAC, assets, connectors, signals, scenarios, assessments, policies, actions, verification')
ON CONFLICT (version) DO NOTHING;

COMMIT;
