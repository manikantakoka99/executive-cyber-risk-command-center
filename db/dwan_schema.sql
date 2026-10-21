-- ============================================================================
-- DWAN EXECUTIVE CYBER RISK COMMAND CENTER — CONSOLIDATED DATABASE DESIGN
-- PostgreSQL 15+ (tested on 16).  Fresh-install script; replaces 001 + 002.
-- ----------------------------------------------------------------------------
-- The chain the schema serves:  Risk -> Impact -> Decision -> Action -> Closed loop
--
--   1 Ingestion          org_connectors, ingestion_runs, control_signals,
--                        asset_inventory, asset_coverage   (raw evidence kept)
--   2 Normalise/correlate tool_categories + signal_domain_map (one owner per signal),
--                        risk_findings (deduplicated), risk_scenarios
--   3 Risk -> Impact     scoring_policy (versioned), domain_scores (+components),
--                        enterprise_scores (floor rule), risk_appetite,
--                        business_impact_assessments, loss_models
--   4 Decision           executive_decisions, decision_action_log,
--                        risk_acceptances (expiry), whatif_scenarios
--   5 Action / loop      treatment_plans, remediation_actions,
--                        finding_verifications (only a pass closes),
--                        board_packs, report_exports, audit_log (hash chain)
--
-- Product invariants enforced in the database, not only in the app:
--   * Floor rule: any Critical domain => headline at least policy.floor_band.
--   * Closed loop: finishing a remediation action only moves a finding to
--     fix_reported; only a passing verification closes it.
--   * Accepted risk needs reason + approver + expiry; on expiry it reopens
--     and a renewal decision is put back on the agenda.  It still counts in
--     the score (scores come from control signals, not from finding status).
--   * No double counting: a tool category carries weight in exactly one domain.
--   * No silent scoring: a domain without signals is refused, unseen assets
--     are assumed at least as weak as the policy default.
--   * No invented money: amounts are nullable; any amount must state its basis.
--   * RBAC: capabilities per role, checked by triggers; financial tables are
--     invisible (RLS) to roles without view_financials.
--   * Tenant isolation: RLS on every tenant table, forced, fail-closed.
--   * Multi-currency: each organisation has a reporting currency (default AED).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Application roles (no login; grant them to real login roles per environment).
--   ccc_app    : the web/API tier, acts on behalf of a signed-in user
--   ccc_engine : ingestion, scoring and simulation jobs (sees money for computation)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ccc_app')    THEN CREATE ROLE ccc_app NOLOGIN;    END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ccc_engine') THEN CREATE ROLE ccc_engine NOLOGIN; END IF;
END $$;
-- Installer (and tests using SET ROLE) must be able to assume the app/engine roles.
GRANT ccc_app, ccc_engine TO CURRENT_USER;

-- ============================================================================
-- 0. TYPES AND HELPERS
-- ============================================================================
CREATE TYPE domain_code AS ENUM (
  'soc_mdr','iam_pam','cspm_cnapp','ransomware_readiness','vapt_asm',
  'phishing_bec','compliance_engine','pci_dss','ot_ics','ai_governance',
  'third_party_risk','vciso'
);
CREATE TYPE severity_level      AS ENUM ('low','medium','high','critical');
CREATE TYPE user_role_name      AS ENUM ('board_member','cxo','ciso','risk_lead','domain_analyst','program_office','auditor','admin');
CREATE TYPE finding_status      AS ENUM ('open','acknowledged','in_remediation','fix_reported','verified_closed','reopened','accepted_risk');
CREATE TYPE exposure_level      AS ENUM ('internet_facing','internal');
CREATE TYPE ingestion_pattern   AS ENUM ('api_pull','siem_query','file_drop','streaming','log_forwarding');
CREATE TYPE run_status          AS ENUM ('running','success','partial','failed');
CREATE TYPE signal_role         AS ENUM ('owning','lens');
CREATE TYPE policy_status       AS ENUM ('draft','approved','retired');
CREATE TYPE scenario_status     AS ENUM ('open','treating','accepted','closed');
CREATE TYPE decision_status     AS ENUM ('awaiting_decision','info_requested','approved','declined','deferred','closed');
CREATE TYPE decision_type       AS ENUM ('approve_fix','accept_risk','renew_acceptance','fund_scenario','defer','other');
CREATE TYPE acceptance_status   AS ENUM ('active','expired','revoked');
CREATE TYPE verification_result AS ENUM ('pass','fail','no_check');
CREATE TYPE treatment_type      AS ENUM ('mitigate','transfer','avoid','accept','monitor');
CREATE TYPE action_status       AS ENUM ('planned','in_progress','done','cancelled');
CREATE TYPE control_status      AS ENUM ('effective','partial','ineffective','not_tested','not_applicable');
CREATE TYPE board_pack_status   AS ENUM ('draft','reviewed','approved');
CREATE TYPE report_type         AS ENUM ('board_pack','executive_briefing','regulator_submission');
CREATE TYPE activity_type       AS ENUM ('finding_created','decision_escalated','decision_resolved','acceptance_expired',
                                         'verification_completed','policy_approved','report_generated',
                                         'compliance_refresh','simulation_completed','feed_stale');

-- Session context, set by the app per request:  SET app.current_org_id / app.current_user_id.
-- Unset or empty => NULL => RLS matches nothing (fail closed).
CREATE FUNCTION app_org_id()  RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_org_id',  true), '')::uuid $$;
CREATE FUNCTION app_user_id() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;

CREATE FUNCTION set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE FUNCTION trg_append_only() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only; write a new row instead', TG_TABLE_NAME; END $$;

-- ============================================================================
-- 1. TENANCY, IDENTITY AND ROLE CAPABILITIES
-- ============================================================================
CREATE TABLE organizations (
  org_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(200) NOT NULL,
  industry            VARCHAR(100),
  hq_country          VARCHAR(100),
  reporting_currency  CHAR(3) NOT NULL DEFAULT 'AED' CHECK (reporting_currency ~ '^[A-Z]{3}$'),
  timezone            VARCHAR(64) NOT NULL DEFAULT 'Asia/Dubai',
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Business context: units and the processes they run (finding -> asset -> unit).
CREATE TABLE business_units (
  business_unit_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  parent_unit_id    UUID,
  name              VARCHAR(150) NOT NULL,
  key_processes     TEXT[],                               -- e.g. {card payments, payroll}
  criticality_tier  SMALLINT NOT NULL DEFAULT 2 CHECK (criticality_tier BETWEEN 1 AND 3),
  UNIQUE (org_id, name),
  UNIQUE (business_unit_id, org_id),
  FOREIGN KEY (parent_unit_id, org_id) REFERENCES business_units(business_unit_id, org_id)
);

CREATE TABLE users (
  user_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100),
  email             VARCHAR(200) NOT NULL,
  role              user_role_name NOT NULL DEFAULT 'domain_analyst',
  job_title         VARCHAR(100),                          -- 'CFO', 'Head of Payments Engineering'
  business_unit_id  UUID,
  idp_subject       VARCHAR(200),                          -- SSO subject (phase 5)
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id),
  UNIQUE (org_id, idp_subject),
  FOREIGN KEY (business_unit_id, org_id) REFERENCES business_units(business_unit_id, org_id) ON DELETE SET NULL (business_unit_id)
);
CREATE UNIQUE INDEX uq_users_email ON users (lower(email));
CREATE INDEX ix_users_org ON users(org_id);

-- Login identity and per-org membership. Tenant key is org_id (not a second tenant id).
-- Not added to the RLS loop below: the session row is read before app_org_id() is set.
-- org_compliance_status, control_assessments, domain_scores, domain_score_components,
-- and enterprise_scores already carry org_id and stay in that loop.
CREATE TABLE auth_accounts (
  account_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(200) NOT NULL,
  password_hash TEXT NOT NULL,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_auth_password_hash CHECK (password_hash ~ '^[$]2[aby][$]')
);
CREATE UNIQUE INDEX uq_auth_accounts_email ON auth_accounts (lower(email));

CREATE TABLE auth_sessions (
  session_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  CHAR(64) NOT NULL UNIQUE,
  account_id  UUID NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX ix_auth_sessions_account ON auth_sessions(account_id);
CREATE INDEX ix_auth_sessions_org ON auth_sessions(org_id);

CREATE TABLE org_memberships (
  account_id  UUID NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_code   VARCHAR(64) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, org_id),
  CONSTRAINT ck_membership_status CHECK (status IN ('active', 'invited', 'disabled')),
  CONSTRAINT ck_membership_role CHECK (role_code IN (
    'board_member', 'cxo', 'ciso', 'risk_lead', 'domain_analyst', 'program_office', 'auditor', 'admin'
  ))
);
CREATE INDEX ix_org_memberships_org ON org_memberships(org_id);
CREATE INDEX ix_org_memberships_user ON org_memberships(user_id);

CREATE TABLE org_invites (
  invite_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  email       VARCHAR(200) NOT NULL,
  role_code   VARCHAR(64) NOT NULL,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  invited_by  UUID REFERENCES users(user_id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_invite_role CHECK (role_code IN (
    'board_member', 'cxo', 'ciso', 'risk_lead', 'domain_analyst', 'program_office', 'auditor', 'admin'
  ))
);
CREATE INDEX ix_org_invites_org ON org_invites(org_id);

-- What each role may do.  Global reference data, read-only to the app.
CREATE TABLE role_capabilities (
  role                    user_role_name PRIMARY KEY,
  view_financials         BOOLEAN NOT NULL,   -- loss, exposure, cost figures
  view_technical_evidence BOOLEAN NOT NULL,   -- CVEs, raw payloads, connector runs
  approve_decisions       BOOLEAN NOT NULL,   -- approve / decline / defer queue items
  accept_risk             BOOLEAN NOT NULL,   -- sign a risk acceptance
  approve_policy          BOOLEAN NOT NULL,   -- scoring policy and appetite
  verify_findings         BOOLEAN NOT NULL,   -- record a manual verification
  review_board_pack       BOOLEAN NOT NULL,
  manage_users            BOOLEAN NOT NULL
);

-- Does the current session user have a capability?  SECURITY DEFINER so it can
-- be used inside RLS policies without recursion.
CREATE FUNCTION fn_user_can(p_cap TEXT, p_user UUID DEFAULT NULL) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT (to_jsonb(rc) ->> p_cap)::boolean
    FROM users u JOIN role_capabilities rc ON rc.role = u.role
    WHERE u.user_id = COALESCE(p_user, app_user_id()) AND u.is_active
      AND (app_org_id() IS NULL OR u.org_id = app_org_id())     -- a user never acts in another tenant's session
  ), false)
$$;

-- Raises unless p_user exists in p_org, is active and holds p_cap.
CREATE FUNCTION fn_require_capability(p_user UUID, p_org UUID, p_cap TEXT, p_what TEXT) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u_org UUID; u_role user_role_name;
BEGIN
  SELECT org_id, role INTO u_org, u_role FROM users WHERE user_id = p_user AND is_active;
  IF u_org IS NULL THEN RAISE EXCEPTION '%: approver % is unknown or inactive', p_what, p_user; END IF;
  IF u_org IS DISTINCT FROM p_org THEN RAISE EXCEPTION '%: approver must belong to the same organization', p_what; END IF;
  IF NOT fn_user_can(p_cap, p_user) THEN RAISE EXCEPTION '%: role % lacks capability %', p_what, u_role, p_cap; END IF;
END $$;

-- ============================================================================
-- 2. DOMAINS, TOOL CATEGORIES AND THE OWNERSHIP MAP
-- ============================================================================
CREATE TABLE risk_domains (
  risk_domain_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            domain_code NOT NULL UNIQUE,
  display_name    VARCHAR(150) NOT NULL,
  short_label     VARCHAR(60)  NOT NULL,
  yvi_solution    VARCHAR(150),
  csf_functions   TEXT[] NOT NULL DEFAULT '{}',          -- NIST CSF 2.0: Govern, Identify, Protect, Detect, Respond, Recover
  sort_order      SMALLINT NOT NULL DEFAULT 0,
  description     TEXT
);

-- Each org subscribes to a subset; the enterprise roll-up only counts active subscriptions.
CREATE TABLE org_domain_subscriptions (
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  risk_domain_id  UUID NOT NULL REFERENCES risk_domains(risk_domain_id),
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, risk_domain_id)
);

CREATE TABLE tool_categories (
  category_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(60) NOT NULL UNIQUE,
  name              VARCHAR(150) NOT NULL,
  ingestion_pattern ingestion_pattern NOT NULL DEFAULT 'api_pull',
  description       TEXT
);

-- 'owning' = carries weight in that domain's score; 'lens' = shown there, never scored there.
CREATE TABLE signal_domain_map (
  category_id     UUID NOT NULL REFERENCES tool_categories(category_id) ON DELETE CASCADE,
  risk_domain_id  UUID NOT NULL REFERENCES risk_domains(risk_domain_id) ON DELETE CASCADE,
  role            signal_role NOT NULL,
  PRIMARY KEY (category_id, risk_domain_id)
);
CREATE UNIQUE INDEX uq_signal_one_owner ON signal_domain_map(category_id) WHERE role = 'owning';

CREATE FUNCTION fn_check_signal_ownership() RETURNS TABLE(category_id UUID, code VARCHAR)
LANGUAGE sql STABLE AS $$
  SELECT c.category_id, c.code FROM tool_categories c
  WHERE NOT EXISTS (SELECT 1 FROM signal_domain_map m WHERE m.category_id = c.category_id AND m.role = 'owning')
$$;

-- ============================================================================
-- 3. INGESTION, ASSETS AND COVERAGE  (stage 1: raw evidence retained)
-- ============================================================================
CREATE TABLE org_connectors (
  connector_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  category_id      UUID NOT NULL REFERENCES tool_categories(category_id),
  product_name     VARCHAR(150) NOT NULL,
  pattern          ingestion_pattern NOT NULL,
  schedule_minutes INT NOT NULL CHECK (schedule_minutes > 0),
  credential_ref   TEXT NOT NULL,                        -- path in the secrets vault, never the secret
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, category_id, product_name),
  UNIQUE (connector_id, org_id),
  CONSTRAINT ck_credential_is_reference CHECK (credential_ref ~ '^[a-z0-9_.:/-]+$')
);

CREATE TABLE ingestion_runs (
  run_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  connector_id   UUID NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  status         run_status NOT NULL DEFAULT 'running',
  rows_in        INT NOT NULL DEFAULT 0 CHECK (rows_in >= 0),
  rows_rejected  INT NOT NULL DEFAULT 0 CHECK (rows_rejected >= 0),
  rejected_rate  NUMERIC(5,4) GENERATED ALWAYS AS (CASE WHEN rows_in > 0 THEN round(rows_rejected::numeric / rows_in, 4) ELSE 0 END) STORED,
  raw_object_uri TEXT,                                   -- raw payload kept for replay
  error_text     TEXT,
  UNIQUE (run_id, org_id),
  FOREIGN KEY (connector_id, org_id) REFERENCES org_connectors(connector_id, org_id) ON DELETE CASCADE,
  CONSTRAINT ck_rejected_le_in CHECK (rows_rejected <= rows_in),
  CONSTRAINT ck_finished_after_start CHECK (finished_at IS NULL OR finished_at >= started_at)
);
CREATE INDEX ix_runs_connector_time ON ingestion_runs(org_id, connector_id, started_at DESC);

CREATE TABLE asset_inventory (
  asset_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  external_ref      VARCHAR(200) NOT NULL,               -- CMDB / cloud resource id
  name              VARCHAR(200) NOT NULL,
  asset_type        VARCHAR(60) NOT NULL,
  business_unit_id  UUID,
  business_process  VARCHAR(150),
  owner_user_id     UUID,
  criticality_tier  SMALLINT NOT NULL DEFAULT 2 CHECK (criticality_tier BETWEEN 1 AND 3),
  crown_jewel       BOOLEAN NOT NULL DEFAULT false,
  internet_facing   BOOLEAN NOT NULL DEFAULT false,
  source            VARCHAR(60),
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at        TIMESTAMPTZ,
  UNIQUE (org_id, external_ref),
  UNIQUE (asset_id, org_id),
  FOREIGN KEY (business_unit_id, org_id) REFERENCES business_units(business_unit_id, org_id) ON DELETE SET NULL (business_unit_id),
  FOREIGN KEY (owner_user_id, org_id)    REFERENCES users(user_id, org_id)                   ON DELETE SET NULL (owner_user_id),
  CONSTRAINT ck_crown_jewel_tier1 CHECK (NOT crown_jewel OR criticality_tier = 1)
);

-- The coverage denominator: which tools should see which assets, and when they last did.
CREATE TABLE asset_coverage (
  asset_id      UUID NOT NULL,
  org_id        UUID NOT NULL,
  category_id   UUID NOT NULL REFERENCES tool_categories(category_id),
  in_scope      BOOLEAN NOT NULL DEFAULT true,
  last_seen_at  TIMESTAMPTZ,                              -- NULL = never seen
  PRIMARY KEY (asset_id, category_id),
  FOREIGN KEY (asset_id, org_id) REFERENCES asset_inventory(asset_id, org_id) ON DELETE CASCADE
);
CREATE INDEX ix_asset_coverage_org_cat ON asset_coverage(org_id, category_id);

-- Curated per-category measurement: numerator compliant / denominator in scope.
CREATE TABLE control_signals (
  signal_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES tool_categories(category_id),
  run_id       UUID NOT NULL,
  observed_at  TIMESTAMPTZ NOT NULL,
  numerator    NUMERIC(14,2) NOT NULL CHECK (numerator >= 0),
  denominator  NUMERIC(14,2) NOT NULL CHECK (denominator > 0),
  gap          NUMERIC(6,5) GENERATED ALWAYS AS (round(1 - numerator / denominator, 5)) STORED,
  UNIQUE (org_id, category_id, run_id),
  UNIQUE (signal_id, org_id),
  FOREIGN KEY (run_id, org_id) REFERENCES ingestion_runs(run_id, org_id) ON DELETE CASCADE,
  CONSTRAINT ck_num_le_den CHECK (numerator <= denominator)
);
CREATE INDEX ix_signals_latest ON control_signals(org_id, category_id, observed_at DESC);
CREATE TRIGGER trg_signals_append_only BEFORE UPDATE ON control_signals FOR EACH ROW EXECUTE FUNCTION trg_append_only();

-- ============================================================================
-- 4. SCORING POLICY (versioned, approved, then frozen) AND BOARD APPETITE
-- ============================================================================
CREATE TABLE scoring_policy (
  policy_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  version             INT NOT NULL CHECK (version > 0),
  status              policy_status NOT NULL DEFAULT 'draft',
  unobserved_default  NUMERIC(5,2) NOT NULL DEFAULT 60 CHECK (unobserved_default BETWEEN 0 AND 100),
  band_medium_min     NUMERIC(5,2) NOT NULL DEFAULT 35,
  band_high_min       NUMERIC(5,2) NOT NULL DEFAULT 55,
  band_critical_min   NUMERIC(5,2) NOT NULL DEFAULT 70,
  floor_enabled       BOOLEAN NOT NULL DEFAULT true,
  floor_band          severity_level NOT NULL DEFAULT 'high',
  freshness_factor    NUMERIC(4,2) NOT NULL DEFAULT 2 CHECK (freshness_factor >= 1),     -- fresh = last run within factor x schedule
  max_rejected_rate   NUMERIC(5,4) NOT NULL DEFAULT 0.05 CHECK (max_rejected_rate BETWEEN 0 AND 1),
  coverage_window_days INT NOT NULL DEFAULT 7 CHECK (coverage_window_days > 0),
  notes               TEXT,
  proposed_by         UUID,                       -- CISO (or other) who drafted the proposal
  approved_by         UUID,                       -- Board (approve_policy); must differ from proposed_by
  approved_at         TIMESTAMPTZ,
  effective_from      TIMESTAMPTZ,
  effective_to        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, version),
  UNIQUE (policy_id, org_id),
  FOREIGN KEY (proposed_by, org_id) REFERENCES users(user_id, org_id),
  FOREIGN KEY (approved_by, org_id) REFERENCES users(user_id, org_id),
  CONSTRAINT ck_band_order CHECK (band_medium_min < band_high_min AND band_high_min < band_critical_min),
  CONSTRAINT ck_approved_fields CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND effective_from IS NOT NULL AND proposed_by IS NOT NULL)),
  CONSTRAINT ck_proposer_ne_approver CHECK (proposed_by IS NULL OR approved_by IS NULL OR proposed_by <> approved_by),
  CONSTRAINT ck_effective_order CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ex_policy_no_overlap EXCLUDE USING gist (
    org_id WITH =, tstzrange(effective_from, COALESCE(effective_to, 'infinity')) WITH &&
  ) WHERE (status = 'approved')
);

CREATE TABLE policy_domain_weights (
  policy_id       UUID NOT NULL,
  org_id          UUID NOT NULL,
  risk_domain_id  UUID NOT NULL REFERENCES risk_domains(risk_domain_id),
  weight          NUMERIC(6,3) NOT NULL CHECK (weight > 0),          -- business weight in the composite
  PRIMARY KEY (policy_id, risk_domain_id),
  FOREIGN KEY (policy_id, org_id) REFERENCES scoring_policy(policy_id, org_id) ON DELETE CASCADE
);

CREATE TABLE policy_category_weights (
  policy_id    UUID NOT NULL,
  org_id       UUID NOT NULL,
  category_id  UUID NOT NULL REFERENCES tool_categories(category_id),
  weight       NUMERIC(6,2) NOT NULL CHECK (weight >= 0),           -- should total 100 within each domain
  PRIMARY KEY (policy_id, category_id),
  FOREIGN KEY (policy_id, org_id) REFERENCES scoring_policy(policy_id, org_id) ON DELETE CASCADE
);

CREATE TABLE policy_sla (
  policy_id  UUID NOT NULL,
  org_id     UUID NOT NULL,
  severity   severity_level NOT NULL,
  days       INT NOT NULL CHECK (days > 0),
  PRIMARY KEY (policy_id, severity),
  FOREIGN KEY (policy_id, org_id) REFERENCES scoring_policy(policy_id, org_id) ON DELETE CASCADE
);

CREATE FUNCTION trg_policy_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Drafts may be proposed by any active user in the org (typically CISO). Approval is separate.
  IF TG_OP = 'INSERT' AND NEW.status = 'draft' AND NEW.proposed_by IS NULL AND app_user_id() IS NOT NULL THEN
    NEW.proposed_by := app_user_id();
  END IF;
  IF NEW.status <> 'draft' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    IF NEW.proposed_by IS NULL THEN
      RAISE EXCEPTION 'scoring policy approval: proposed_by is required (CISO proposes, Board approves)';
    END IF;
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'scoring policy approval: approved_by is required';
    END IF;
    IF NEW.approved_by = NEW.proposed_by THEN
      RAISE EXCEPTION 'scoring policy approval: the proposer cannot approve their own proposal';
    END IF;
    PERFORM fn_require_capability(NEW.approved_by, NEW.org_id, 'approve_policy', 'scoring policy approval');
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
    IF (to_jsonb(NEW) - 'status' - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'effective_to')
       OR NEW.status NOT IN ('approved','retired') THEN
      RAISE EXCEPTION 'approved scoring_policy v% is immutable; create a new version', OLD.version;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_policy_guard BEFORE INSERT OR UPDATE ON scoring_policy FOR EACH ROW EXECUTE FUNCTION trg_policy_guard();

CREATE FUNCTION trg_policy_child_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE st policy_status;
BEGIN
  SELECT status INTO st FROM scoring_policy WHERE policy_id = COALESCE(NEW.policy_id, OLD.policy_id);
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'scoring_policy % is %; its weights and SLAs are frozen', COALESCE(NEW.policy_id, OLD.policy_id), st;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_dw_guard  BEFORE INSERT OR UPDATE OR DELETE ON policy_domain_weights   FOR EACH ROW EXECUTE FUNCTION trg_policy_child_guard();
CREATE TRIGGER trg_cw_guard  BEFORE INSERT OR UPDATE OR DELETE ON policy_category_weights FOR EACH ROW EXECUTE FUNCTION trg_policy_child_guard();
CREATE TRIGGER trg_sla_guard BEFORE INSERT OR UPDATE OR DELETE ON policy_sla              FOR EACH ROW EXECUTE FUNCTION trg_policy_child_guard();

CREATE FUNCTION fn_band(p_score NUMERIC, p_policy UUID) RETURNS severity_level
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_score >= band_critical_min THEN 'critical'::severity_level
              WHEN p_score >= band_high_min     THEN 'high'::severity_level
              WHEN p_score >= band_medium_min   THEN 'medium'::severity_level
              ELSE 'low'::severity_level END
  FROM scoring_policy WHERE policy_id = p_policy
$$;

CREATE FUNCTION fn_active_policy(p_org UUID, p_at TIMESTAMPTZ DEFAULT now()) RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT policy_id FROM scoring_policy
  WHERE org_id = p_org AND status IN ('approved','retired') AND effective_from <= p_at
    AND (effective_to IS NULL OR effective_to > p_at)
  ORDER BY effective_from DESC LIMIT 1
$$;

-- Category weights must total 100 within each domain (returns offenders; run before approving).
CREATE FUNCTION fn_check_policy_weights(p_policy UUID) RETURNS TABLE(risk_domain_id UUID, total_weight NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT m.risk_domain_id, SUM(w.weight)
  FROM policy_category_weights w
  JOIN signal_domain_map m ON m.category_id = w.category_id AND m.role = 'owning'
  WHERE w.policy_id = p_policy
  GROUP BY m.risk_domain_id HAVING SUM(w.weight) <> 100
$$;

-- Board appetite per domain; risk_domain_id NULL = the enterprise-level limit.
CREATE TABLE risk_appetite (
  appetite_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  risk_domain_id  UUID REFERENCES risk_domains(risk_domain_id),
  max_score       NUMERIC(5,2) NOT NULL CHECK (max_score BETWEEN 0 AND 100),
  approaching_margin NUMERIC(5,2) NOT NULL DEFAULT 5 CHECK (approaching_margin >= 0),
  proposed_by     UUID,                           -- typically CISO
  approved_by     UUID NOT NULL,                  -- Board (approve_policy); ≠ proposed_by when set
  approved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  review_date     DATE NOT NULL,
  rationale       TEXT,
  FOREIGN KEY (proposed_by, org_id) REFERENCES users(user_id, org_id),
  FOREIGN KEY (approved_by, org_id) REFERENCES users(user_id, org_id),
  CONSTRAINT uq_appetite UNIQUE NULLS NOT DISTINCT (org_id, risk_domain_id, effective_from),
  CONSTRAINT ck_review_after_effective CHECK (review_date > effective_from),
  CONSTRAINT ck_appetite_proposer_ne_approver CHECK (proposed_by IS NULL OR proposed_by <> approved_by)
);
CREATE FUNCTION trg_appetite_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.proposed_by IS NOT NULL AND NEW.proposed_by = NEW.approved_by THEN
    RAISE EXCEPTION 'risk appetite: the proposer cannot approve their own proposal';
  END IF;
  PERFORM fn_require_capability(NEW.approved_by, NEW.org_id, 'approve_policy', 'risk appetite');
  RETURN NEW;
END $$;
CREATE TRIGGER trg_appetite_guard BEFORE INSERT OR UPDATE ON risk_appetite FOR EACH ROW EXECUTE FUNCTION trg_appetite_guard();

-- ============================================================================
-- 5. SCORES  (append-only snapshots; formulas enforced by CHECK)
-- ============================================================================
CREATE TABLE domain_scores (
  score_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  risk_domain_id      UUID NOT NULL REFERENCES risk_domains(risk_domain_id),
  policy_id           UUID NOT NULL,
  snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_score           NUMERIC(5,2) NOT NULL CHECK (raw_score BETWEEN 0 AND 100),
  coverage            NUMERIC(4,3) NOT NULL CHECK (coverage BETWEEN 0 AND 1),
  unobserved_default  NUMERIC(5,2) NOT NULL CHECK (unobserved_default BETWEEN 0 AND 100),
  adjusted_score      NUMERIC(5,2) NOT NULL,
  feeds_total         INT NOT NULL CHECK (feeds_total >= 0),
  feeds_fresh         INT NOT NULL CHECK (feeds_fresh >= 0),
  rejected_rate       NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (rejected_rate BETWEEN 0 AND 1),
  confidence          NUMERIC(4,3) NOT NULL,
  band                severity_level NOT NULL,
  headline_detail     VARCHAR(300),                        -- one-line driver, e.g. 'Only 7 of 28 recovery tests met target'
  UNIQUE (org_id, risk_domain_id, snapshot_at),
  UNIQUE (score_id, org_id),
  FOREIGN KEY (policy_id, org_id) REFERENCES scoring_policy(policy_id, org_id),
  CONSTRAINT ck_fresh_le_total CHECK (feeds_fresh <= feeds_total),
  CONSTRAINT ck_adjusted_formula CHECK (adjusted_score = round(coverage * raw_score + (1 - coverage) * greatest(raw_score, unobserved_default), 2)),
  CONSTRAINT ck_confidence_formula CHECK (confidence = round((CASE WHEN feeds_total = 0 THEN 0 ELSE feeds_fresh::numeric / feeds_total END) * coverage * (1 - rejected_rate), 3))
);
CREATE INDEX ix_domain_scores_latest ON domain_scores(org_id, risk_domain_id, snapshot_at DESC);

CREATE FUNCTION trg_domain_scores_fill() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.adjusted_score := round(NEW.coverage * NEW.raw_score + (1 - NEW.coverage) * greatest(NEW.raw_score, NEW.unobserved_default), 2);
  NEW.confidence := round((CASE WHEN NEW.feeds_total = 0 THEN 0 ELSE NEW.feeds_fresh::numeric / NEW.feeds_total END) * NEW.coverage * (1 - NEW.rejected_rate), 3);
  NEW.band := fn_band(NEW.adjusted_score, NEW.policy_id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_domain_scores_fill BEFORE INSERT ON domain_scores FOR EACH ROW EXECUTE FUNCTION trg_domain_scores_fill();
CREATE TRIGGER trg_domain_scores_append_only BEFORE UPDATE ON domain_scores FOR EACH ROW EXECUTE FUNCTION trg_append_only();

-- "Why did the number move": each category's contribution to a domain score.
CREATE TABLE domain_score_components (
  score_id     UUID NOT NULL,
  org_id       UUID NOT NULL,
  category_id  UUID NOT NULL REFERENCES tool_categories(category_id),
  signal_id    UUID,                                      -- the signal used (NULL = category missing)
  weight       NUMERIC(6,2) NOT NULL,
  gap          NUMERIC(6,5),
  points       NUMERIC(6,2),                              -- weight x gap (before normalising)
  PRIMARY KEY (score_id, category_id),
  FOREIGN KEY (score_id, org_id)  REFERENCES domain_scores(score_id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (signal_id, org_id) REFERENCES control_signals(signal_id, org_id)
);
CREATE TRIGGER trg_components_append_only BEFORE UPDATE ON domain_score_components FOR EACH ROW EXECUTE FUNCTION trg_append_only();

CREATE TABLE enterprise_scores (
  snapshot_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  policy_id         UUID NOT NULL,
  snapshot_at       TIMESTAMPTZ NOT NULL,
  arithmetic_score  NUMERIC(5,2) NOT NULL CHECK (arithmetic_score BETWEEN 0 AND 100),
  arithmetic_band   severity_level NOT NULL,
  displayed_band    severity_level NOT NULL,
  floor_applied     BOOLEAN NOT NULL,
  n_critical        INT NOT NULL CHECK (n_critical >= 0),
  n_high            INT NOT NULL CHECK (n_high >= 0),
  n_medium          INT NOT NULL CHECK (n_medium >= 0),
  n_low             INT NOT NULL CHECK (n_low >= 0),
  n_outside_appetite INT NOT NULL DEFAULT 0 CHECK (n_outside_appetite >= 0),
  confidence        NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  driver_summary    VARCHAR(300),
  UNIQUE (org_id, snapshot_at),
  UNIQUE (snapshot_id, org_id),
  FOREIGN KEY (policy_id, org_id) REFERENCES scoring_policy(policy_id, org_id),
  CONSTRAINT ck_floor_consistent CHECK (floor_applied = (displayed_band <> arithmetic_band)),
  CONSTRAINT ck_floor_never_lowers CHECK (displayed_band >= arithmetic_band)
);
CREATE INDEX ix_enterprise_scores_latest ON enterprise_scores(org_id, snapshot_at DESC);
CREATE TRIGGER trg_enterprise_append_only BEFORE UPDATE ON enterprise_scores FOR EACH ROW EXECUTE FUNCTION trg_append_only();

-- ============================================================================
-- 6. FINDINGS, VERIFICATION AND CORRELATED SCENARIOS
-- ============================================================================
CREATE TABLE risk_findings (
  finding_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  risk_domain_id      UUID NOT NULL REFERENCES risk_domains(risk_domain_id),
  title               VARCHAR(250) NOT NULL,
  description         TEXT,
  severity            severity_level NOT NULL,
  status              finding_status NOT NULL DEFAULT 'open',
  -- provenance and de-duplication
  source_category_id  UUID REFERENCES tool_categories(category_id),
  source_run_id       UUID,
  external_ref        VARCHAR(200),                        -- id in the upstream tool (system of record)
  raw_payload         JSONB,
  -- exploitability, asset, exposure
  cve_id              VARCHAR(30),
  kev_listed          BOOLEAN NOT NULL DEFAULT false,
  epss                NUMERIC(5,4) CHECK (epss BETWEEN 0 AND 1),
  asset_id            UUID,
  exposure            exposure_level,
  priority_score      NUMERIC(4,3),                        -- E x A x X, filled by trigger
  -- ownership, SLA and closure
  owner_user_id       UUID,
  sla_due_at          TIMESTAMPTZ,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fix_reported_at     TIMESTAMPTZ,
  verified_at         TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (finding_id, org_id),
  CONSTRAINT uq_finding_dedup UNIQUE (org_id, source_category_id, external_ref),
  FOREIGN KEY (source_run_id, org_id) REFERENCES ingestion_runs(run_id, org_id)  ON DELETE SET NULL (source_run_id),
  FOREIGN KEY (asset_id, org_id)      REFERENCES asset_inventory(asset_id, org_id) ON DELETE SET NULL (asset_id),
  FOREIGN KEY (owner_user_id, org_id) REFERENCES users(user_id, org_id)          ON DELETE SET NULL (owner_user_id),
  CONSTRAINT ck_cve_format CHECK (cve_id IS NULL OR cve_id ~ '^CVE-[0-9]{4}-[0-9]{4,}$')
);
CREATE INDEX ix_findings_org_status ON risk_findings(org_id, status);
CREATE INDEX ix_findings_domain ON risk_findings(org_id, risk_domain_id);
CREATE INDEX ix_findings_asset ON risk_findings(asset_id);
CREATE INDEX ix_findings_sla ON risk_findings(org_id, sla_due_at) WHERE status NOT IN ('verified_closed','accepted_risk');
CREATE TRIGGER trg_findings_updated BEFORE UPDATE ON risk_findings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Priority P = E x A x X.
--   E: 1.0 on CISA KEV; else max(EPSS, 0.1); 0.1 for a CVE without EPSS; 0.5 for non-CVE findings.
--   A: 1.0 crown jewel / tier 1, 0.6 tier 2 or no asset, 0.3 tier 3.
--   X: 1.0 internet-facing, 0.5 internal.
CREATE FUNCTION fn_finding_priority(p_kev BOOLEAN, p_epss NUMERIC, p_cve TEXT, p_tier SMALLINT, p_crown BOOLEAN, p_exposure exposure_level)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT round(
    (CASE WHEN p_kev THEN 1.0 WHEN p_epss IS NOT NULL THEN greatest(p_epss, 0.1) WHEN p_cve IS NOT NULL THEN 0.1 ELSE 0.5 END)
  * (CASE WHEN p_crown OR p_tier = 1 THEN 1.0 WHEN p_tier = 2 OR p_tier IS NULL THEN 0.6 ELSE 0.3 END)
  * (CASE WHEN p_exposure = 'internet_facing' THEN 1.0 ELSE 0.5 END), 3)
$$;

CREATE FUNCTION trg_finding_enrich() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE a asset_inventory; exp exposure_level; d INT;
BEGIN
  IF NEW.asset_id IS NOT NULL THEN SELECT * INTO a FROM asset_inventory WHERE asset_id = NEW.asset_id; END IF;
  exp := COALESCE(NEW.exposure, CASE WHEN a.internet_facing THEN 'internet_facing'::exposure_level ELSE 'internal'::exposure_level END);
  NEW.priority_score := fn_finding_priority(NEW.kev_listed, NEW.epss, NEW.cve_id, a.criticality_tier, COALESCE(a.crown_jewel, false), exp);
  IF TG_OP = 'INSERT' AND NEW.sla_due_at IS NULL THEN
    SELECT s.days INTO d FROM policy_sla s
    WHERE s.policy_id = fn_active_policy(NEW.org_id, NEW.detected_at) AND s.severity = NEW.severity;
    IF d IS NOT NULL THEN NEW.sla_due_at := NEW.detected_at + make_interval(days => d); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_finding_enrich BEFORE INSERT OR UPDATE ON risk_findings FOR EACH ROW EXECUTE FUNCTION trg_finding_enrich();

CREATE TABLE finding_verifications (
  verification_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  finding_id       UUID NOT NULL,
  run_id           UUID,                                   -- the re-scan that produced the evidence
  result           verification_result NOT NULL,
  evidence         JSONB,
  verified_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  verified_by      UUID,                                   -- NULL = automated check
  FOREIGN KEY (finding_id, org_id)  REFERENCES risk_findings(finding_id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, org_id)      REFERENCES ingestion_runs(run_id, org_id)    ON DELETE SET NULL (run_id),
  FOREIGN KEY (verified_by, org_id) REFERENCES users(user_id, org_id)
);
CREATE INDEX ix_verifications_finding ON finding_verifications(finding_id, verified_at DESC);
CREATE TRIGGER trg_verif_append_only BEFORE UPDATE ON finding_verifications FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE FUNCTION trg_verification_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.verified_by IS NOT NULL THEN
    PERFORM fn_require_capability(NEW.verified_by, NEW.org_id, 'verify_findings', 'manual verification');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_verification_guard BEFORE INSERT ON finding_verifications FOR EACH ROW EXECUTE FUNCTION trg_verification_guard();

-- Correlated cross-domain risk story (stage 2): several findings, one business scenario.
CREATE TABLE risk_scenarios (
  scenario_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  title              VARCHAR(250) NOT NULL,              -- 'Ransomware outage of card payments'
  primary_domain_id  UUID NOT NULL REFERENCES risk_domains(risk_domain_id),
  business_unit_id   UUID,
  likelihood         SMALLINT NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  impact             SMALLINT NOT NULL CHECK (impact BETWEEN 1 AND 5),
  risk_rating        SMALLINT GENERATED ALWAYS AS (likelihood * impact) STORED,   -- 1..25, explainable
  rationale          TEXT NOT NULL,                       -- why this likelihood and impact
  status             scenario_status NOT NULL DEFAULT 'open',
  owner_user_id      UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, org_id),
  FOREIGN KEY (business_unit_id, org_id) REFERENCES business_units(business_unit_id, org_id) ON DELETE SET NULL (business_unit_id),
  FOREIGN KEY (owner_user_id, org_id)    REFERENCES users(user_id, org_id)                   ON DELETE SET NULL (owner_user_id)
);
CREATE TRIGGER trg_scenarios_updated BEFORE UPDATE ON risk_scenarios FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE scenario_findings (
  scenario_id  UUID NOT NULL,
  finding_id   UUID NOT NULL,
  org_id       UUID NOT NULL,
  PRIMARY KEY (scenario_id, finding_id),
  FOREIGN KEY (scenario_id, org_id) REFERENCES risk_scenarios(scenario_id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (finding_id, org_id)  REFERENCES risk_findings(finding_id, org_id)  ON DELETE CASCADE
);
CREATE INDEX ix_scenario_findings_finding ON scenario_findings(finding_id);

-- ============================================================================
-- 7. BUSINESS IMPACT AND LOSS QUANTIFICATION  (financial; RLS-masked by role)
-- ============================================================================
CREATE FUNCTION trg_fill_currency() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency IS NULL THEN SELECT reporting_currency INTO NEW.currency FROM organizations WHERE org_id = NEW.org_id; END IF;
  RETURN NEW;
END $$;

CREATE TABLE business_impact_assessments (
  impact_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                     UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  finding_id                 UUID,
  scenario_id                UUID,
  currency                   CHAR(3) CHECK (currency ~ '^[A-Z]{3}$'),
  financial_exposure_amount  NUMERIC(14,2) CHECK (financial_exposure_amount >= 0),   -- NULL = unknown, never guessed
  downtime_hours_estimate    NUMERIC(8,2)  CHECK (downtime_hours_estimate >= 0),
  downtime_cost_per_hour     NUMERIC(12,2) CHECK (downtime_cost_per_hour >= 0),
  affected_business_unit_id  UUID,
  reputational_impact        severity_level,
  regulatory_impact          VARCHAR(200),                 -- e.g. 'PCI DSS scope; Dubai ISR notifiable'
  basis                      TEXT NOT NULL,                -- where any figure came from
  assessed_by                UUID,
  assessed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (impact_id, org_id),
  FOREIGN KEY (finding_id, org_id)  REFERENCES risk_findings(finding_id, org_id)   ON DELETE SET NULL (finding_id),
  FOREIGN KEY (scenario_id, org_id) REFERENCES risk_scenarios(scenario_id, org_id) ON DELETE SET NULL (scenario_id),
  FOREIGN KEY (affected_business_unit_id, org_id) REFERENCES business_units(business_unit_id, org_id) ON DELETE SET NULL (affected_business_unit_id),
  FOREIGN KEY (assessed_by, org_id) REFERENCES users(user_id, org_id),
  CONSTRAINT ck_impact_subject CHECK (finding_id IS NOT NULL OR scenario_id IS NOT NULL),
  CONSTRAINT ck_basis_present CHECK (length(btrim(basis)) >= 5)
);
CREATE INDEX ix_impact_finding ON business_impact_assessments(finding_id);
CREATE INDEX ix_impact_scenario ON business_impact_assessments(scenario_id);
CREATE TRIGGER trg_impact_currency BEFORE INSERT ON business_impact_assessments FOR EACH ROW EXECUTE FUNCTION trg_fill_currency();

-- FAIR-style Monte Carlo inputs and outputs (simulation runs outside SQL; results stored here).
CREATE TABLE loss_models (
  model_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  scenario_id       UUID,
  finding_id        UUID,
  risk_domain_id    UUID REFERENCES risk_domains(risk_domain_id),
  scenario_name     VARCHAR(200) NOT NULL,
  model_version     VARCHAR(30) NOT NULL,
  currency          CHAR(3) CHECK (currency ~ '^[A-Z]{3}$'),
  lef_min NUMERIC(8,4) NOT NULL, lef_mode NUMERIC(8,4) NOT NULL, lef_max NUMERIC(8,4) NOT NULL,      -- loss events per year
  vuln_min NUMERIC(5,4) NOT NULL, vuln_mode NUMERIC(5,4) NOT NULL, vuln_max NUMERIC(5,4) NOT NULL,    -- P(attempt succeeds)
  mag_min NUMERIC(14,2) NOT NULL, mag_mode NUMERIC(14,2) NOT NULL, mag_max NUMERIC(14,2) NOT NULL,    -- loss per event
  draws             INT NOT NULL CHECK (draws >= 1000),
  seed              BIGINT NOT NULL,
  ale_mean          NUMERIC(14,2),
  annual_p90        NUMERIC(14,2),
  annual_p95        NUMERIC(14,2),
  event_p10         NUMERIC(14,2),
  event_p50         NUMERIC(14,2),
  event_p90         NUMERIC(14,2),
  input_source      TEXT NOT NULL,
  approved_by       UUID,
  approved_at       TIMESTAMPTZ,
  simulated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, org_id),
  FOREIGN KEY (scenario_id, org_id) REFERENCES risk_scenarios(scenario_id, org_id) ON DELETE SET NULL (scenario_id),
  FOREIGN KEY (finding_id, org_id)  REFERENCES risk_findings(finding_id, org_id)   ON DELETE SET NULL (finding_id),
  FOREIGN KEY (approved_by, org_id) REFERENCES users(user_id, org_id),
  CONSTRAINT ck_lef_order  CHECK (lef_min  <= lef_mode  AND lef_mode  <= lef_max  AND lef_min  >= 0),
  CONSTRAINT ck_vuln_order CHECK (vuln_min <= vuln_mode AND vuln_mode <= vuln_max AND vuln_min >= 0 AND vuln_max <= 1),
  CONSTRAINT ck_mag_order  CHECK (mag_min  <= mag_mode  AND mag_mode  <= mag_max  AND mag_min  >= 0),
  CONSTRAINT ck_event_pct_order  CHECK (event_p10 IS NULL OR event_p50 IS NULL OR event_p90 IS NULL OR (event_p10 <= event_p50 AND event_p50 <= event_p90)),
  CONSTRAINT ck_annual_pct_order CHECK (annual_p90 IS NULL OR annual_p95 IS NULL OR annual_p90 <= annual_p95),
  CONSTRAINT ck_approval_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);
CREATE INDEX ix_loss_org_domain ON loss_models(org_id, risk_domain_id, simulated_at DESC);
CREATE TRIGGER trg_loss_currency BEFORE INSERT ON loss_models FOR EACH ROW EXECUTE FUNCTION trg_fill_currency();

-- Enterprise loss per score snapshot (sum of scenarios draw by draw, from the simulation job).
CREATE TABLE enterprise_loss_estimates (
  snapshot_id   UUID PRIMARY KEY,
  org_id        UUID NOT NULL,
  currency      CHAR(3) CHECK (currency ~ '^[A-Z]{3}$'),
  ale_expected  NUMERIC(14,2) NOT NULL CHECK (ale_expected >= 0),
  ale_p90       NUMERIC(14,2) CHECK (ale_p90 >= 0),
  ale_p95       NUMERIC(14,2) CHECK (ale_p95 >= 0),
  model_ids     UUID[] NOT NULL DEFAULT '{}',              -- the loss_models summed
  simulated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (snapshot_id, org_id) REFERENCES enterprise_scores(snapshot_id, org_id) ON DELETE CASCADE,
  CONSTRAINT ck_ale_pct_order CHECK (ale_p90 IS NULL OR ale_p95 IS NULL OR ale_p90 <= ale_p95)
);
CREATE TRIGGER trg_ent_loss_currency BEFORE INSERT ON enterprise_loss_estimates FOR EACH ROW EXECUTE FUNCTION trg_fill_currency();
CREATE TRIGGER trg_ent_loss_append_only BEFORE UPDATE ON enterprise_loss_estimates FOR EACH ROW EXECUTE FUNCTION trg_append_only();

CREATE TABLE whatif_scenarios (
  whatif_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  name              VARCHAR(200) NOT NULL,
  policy_id         UUID NOT NULL,
  base_snapshot_id  UUID,
  changes           JSONB NOT NULL CHECK (jsonb_typeof(changes) = 'object'),   -- e.g. {"immutable_backup":{"gap":0.10}}
  score_before      NUMERIC(5,2) NOT NULL,
  score_after       NUMERIC(5,2) NOT NULL,
  band_before       severity_level NOT NULL,
  band_after        severity_level NOT NULL,
  headline_after    severity_level,                        -- after the floor rule
  currency          CHAR(3) CHECK (currency ~ '^[A-Z]{3}$'),
  ale_before        NUMERIC(14,2),
  ale_after         NUMERIC(14,2),
  cost_estimate     NUMERIC(14,2) CHECK (cost_estimate IS NULL OR cost_estimate >= 0),
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (whatif_id, org_id),
  FOREIGN KEY (policy_id, org_id)        REFERENCES scoring_policy(policy_id, org_id),
  FOREIGN KEY (base_snapshot_id, org_id) REFERENCES enterprise_scores(snapshot_id, org_id),
  FOREIGN KEY (created_by, org_id)       REFERENCES users(user_id, org_id)
);
CREATE TRIGGER trg_whatif_currency BEFORE INSERT ON whatif_scenarios FOR EACH ROW EXECUTE FUNCTION trg_fill_currency();

-- ============================================================================
-- 8. RISK ACCEPTANCE, DECISIONS AND THE DECISION LOG
-- ============================================================================
CREATE TABLE risk_acceptances (
  acceptance_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  finding_id           UUID NOT NULL,
  reason               TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  reason_category      VARCHAR(30) NOT NULL CHECK (reason_category IN ('cost','business_need','compensating_control')),
  compensating_control TEXT,
  approver_user_id     UUID NOT NULL,
  accepted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,
  renewal_count        INT NOT NULL DEFAULT 0 CHECK (renewal_count >= 0),
  status               acceptance_status NOT NULL DEFAULT 'active',
  revoked_at           TIMESTAMPTZ,
  UNIQUE (acceptance_id, org_id),
  FOREIGN KEY (finding_id, org_id)       REFERENCES risk_findings(finding_id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (approver_user_id, org_id) REFERENCES users(user_id, org_id),
  CONSTRAINT ck_expiry_after_accept CHECK (expires_at > accepted_at),
  CONSTRAINT ck_revoked_fields CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_one_active_acceptance ON risk_acceptances(finding_id) WHERE status = 'active';
CREATE INDEX ix_acceptances_expiry ON risk_acceptances(org_id, expires_at) WHERE status = 'active';

-- Approver holds accept_risk in the same org and does not own the finding; expiry
-- is mandatory, max 365 days (90 for Critical), and a renewal obeys the same limit from now.
CREATE FUNCTION trg_acceptance_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE f_owner UUID; f_sev severity_level; max_days INT;
BEGIN
  SELECT owner_user_id, severity INTO f_owner, f_sev FROM risk_findings WHERE finding_id = NEW.finding_id;
  max_days := CASE WHEN f_sev = 'critical' THEN 90 ELSE 365 END;
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_require_capability(NEW.approver_user_id, NEW.org_id, 'accept_risk', 'risk acceptance');
    IF f_owner IS NOT NULL AND f_owner = NEW.approver_user_id THEN
      RAISE EXCEPTION 'the finding owner cannot approve their own risk acceptance';
    END IF;
    IF NEW.expires_at > NEW.accepted_at + make_interval(days => max_days) THEN
      RAISE EXCEPTION 'expiry exceeds the % day limit for a % finding', max_days, f_sev;
    END IF;
  ELSE
    IF (to_jsonb(NEW) - 'status' - 'revoked_at' - 'expires_at' - 'renewal_count') IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'revoked_at' - 'expires_at' - 'renewal_count') THEN
      RAISE EXCEPTION 'risk_acceptances rows are immutable except status, revoked_at and renewal of expires_at';
    END IF;
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      IF OLD.status <> 'active' THEN RAISE EXCEPTION 'only an active acceptance can be renewed'; END IF;
      IF NEW.expires_at > now() + make_interval(days => max_days) THEN
        RAISE EXCEPTION 'renewal exceeds the % day limit for a % finding', max_days, f_sev;
      END IF;
      NEW.renewal_count := OLD.renewal_count + 1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_acceptance_guard BEFORE INSERT OR UPDATE ON risk_acceptances FOR EACH ROW EXECUTE FUNCTION trg_acceptance_guard();

CREATE TABLE executive_decisions (
  decision_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  decision_type      decision_type NOT NULL DEFAULT 'other',
  title              VARCHAR(250) NOT NULL,
  priority           severity_level NOT NULL,
  risk_summary       TEXT NOT NULL,                       -- 'Risk:' text
  impact_summary     TEXT NOT NULL,                       -- 'Impact:' text
  recommended_action TEXT NOT NULL,                       -- 'Recommended:' text
  finding_id         UUID,
  scenario_id        UUID,
  impact_id          UUID,
  whatif_id          UUID,
  acceptance_id      UUID,
  status             decision_status NOT NULL DEFAULT 'awaiting_decision',
  escalated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_by             TIMESTAMPTZ,
  decided_by         UUID,
  decided_at         TIMESTAMPTZ,
  decision_notes     TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (decision_id, org_id),
  FOREIGN KEY (finding_id, org_id)    REFERENCES risk_findings(finding_id, org_id)                ON DELETE SET NULL (finding_id),
  FOREIGN KEY (scenario_id, org_id)   REFERENCES risk_scenarios(scenario_id, org_id)              ON DELETE SET NULL (scenario_id),
  FOREIGN KEY (impact_id, org_id)     REFERENCES business_impact_assessments(impact_id, org_id)   ON DELETE SET NULL (impact_id),
  FOREIGN KEY (whatif_id, org_id)     REFERENCES whatif_scenarios(whatif_id, org_id)              ON DELETE SET NULL (whatif_id),
  FOREIGN KEY (acceptance_id, org_id) REFERENCES risk_acceptances(acceptance_id, org_id)          ON DELETE SET NULL (acceptance_id),
  FOREIGN KEY (decided_by, org_id)    REFERENCES users(user_id, org_id),
  CONSTRAINT ck_decided_fields CHECK (status IN ('awaiting_decision','info_requested') OR decided_at IS NOT NULL)
);
CREATE INDEX ix_decisions_org_status ON executive_decisions(org_id, status);
CREATE TRIGGER trg_decisions_updated BEFORE UPDATE ON executive_decisions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every status change is logged with actor, old and new status (append-only).
CREATE TABLE decision_action_log (
  action_log_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  decision_id    UUID NOT NULL,
  actor_user_id  UUID,
  old_status     decision_status,
  new_status     decision_status NOT NULL,
  notes          TEXT,
  acted_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (decision_id, org_id)   REFERENCES executive_decisions(decision_id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id, org_id) REFERENCES users(user_id, org_id)
);
CREATE INDEX ix_decision_log_decision ON decision_action_log(decision_id, acted_at);
CREATE TRIGGER trg_decision_log_append_only BEFORE UPDATE ON decision_action_log FOR EACH ROW EXECUTE FUNCTION trg_append_only();

-- Only holders of approve_decisions can approve, decline or defer; an approved
-- accept_risk decision must point at its register entry.
CREATE FUNCTION trg_decision_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('approved','declined','deferred') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM fn_require_capability(NEW.decided_by, NEW.org_id, 'approve_decisions', 'executive decision');
    NEW.decided_at := COALESCE(NEW.decided_at, now());
    IF NEW.status = 'approved' AND NEW.decision_type IN ('accept_risk','renew_acceptance') AND NEW.acceptance_id IS NULL THEN
      RAISE EXCEPTION 'an approved % decision must reference its risk_acceptances entry', NEW.decision_type;
    END IF;
  ELSIF NEW.status = 'closed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.decided_at := COALESCE(NEW.decided_at, now());
  ELSIF NEW.status IN ('awaiting_decision','info_requested') THEN
    NEW.decided_at := NULL; NEW.decided_by := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_decision_guard BEFORE INSERT OR UPDATE ON executive_decisions FOR EACH ROW EXECUTE FUNCTION trg_decision_guard();

CREATE FUNCTION trg_decision_log() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO decision_action_log(org_id, decision_id, actor_user_id, old_status, new_status, notes)
    VALUES (NEW.org_id, NEW.decision_id, COALESCE(NEW.decided_by, app_user_id()),
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, NEW.decision_notes);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_decision_log AFTER INSERT OR UPDATE ON executive_decisions FOR EACH ROW EXECUTE FUNCTION trg_decision_log();

-- ============================================================================
-- 9. TREATMENT AND REMEDIATION  (stage 5: action, owner, due date)
-- ============================================================================
CREATE TABLE treatment_plans (
  plan_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  treatment       treatment_type NOT NULL,
  finding_id      UUID,
  scenario_id     UUID,
  decision_id     UUID,                                   -- the decision that authorised it
  owner_user_id   UUID,
  target_date     DATE,
  description     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, org_id),
  FOREIGN KEY (finding_id, org_id)    REFERENCES risk_findings(finding_id, org_id)        ON DELETE CASCADE,
  FOREIGN KEY (scenario_id, org_id)   REFERENCES risk_scenarios(scenario_id, org_id)      ON DELETE CASCADE,
  FOREIGN KEY (decision_id, org_id)   REFERENCES executive_decisions(decision_id, org_id) ON DELETE SET NULL (decision_id),
  FOREIGN KEY (owner_user_id, org_id) REFERENCES users(user_id, org_id)                   ON DELETE SET NULL (owner_user_id),
  CONSTRAINT ck_plan_subject CHECK (finding_id IS NOT NULL OR scenario_id IS NOT NULL)
);

CREATE TABLE remediation_actions (
  action_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  plan_id         UUID NOT NULL,
  finding_id      UUID,
  title           VARCHAR(250) NOT NULL,
  owner_user_id   UUID,
  owner_team      VARCHAR(100),                           -- SOC / IT / Compliance / business unit
  external_ticket VARCHAR(100),                           -- id in the ticketing system of record
  status          action_status NOT NULL DEFAULT 'planned',
  due_at          TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_id, org_id)       REFERENCES treatment_plans(plan_id, org_id)   ON DELETE CASCADE,
  FOREIGN KEY (finding_id, org_id)    REFERENCES risk_findings(finding_id, org_id)  ON DELETE SET NULL (finding_id),
  FOREIGN KEY (owner_user_id, org_id) REFERENCES users(user_id, org_id)             ON DELETE SET NULL (owner_user_id),
  CONSTRAINT ck_completed_when_done CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX ix_actions_org_status ON remediation_actions(org_id, status, due_at);
CREATE TRIGGER trg_actions_updated BEFORE UPDATE ON remediation_actions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION trg_action_completed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done' AND NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
  IF NEW.status <> 'done' THEN NEW.completed_at := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_action_completed BEFORE INSERT OR UPDATE ON remediation_actions FOR EACH ROW EXECUTE FUNCTION trg_action_completed();

-- Closed-loop rule: finishing the task reports a fix; it does not close the finding.
CREATE FUNCTION trg_action_reports_fix() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status <> 'done') AND NEW.finding_id IS NOT NULL THEN
    UPDATE risk_findings SET status = 'fix_reported'
    WHERE finding_id = NEW.finding_id AND status IN ('open','acknowledged','in_remediation','reopened');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_action_reports_fix AFTER INSERT OR UPDATE OF status ON remediation_actions FOR EACH ROW EXECUTE FUNCTION trg_action_reports_fix();

-- Finding lifecycle guard.
CREATE FUNCTION trg_finding_status_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('verified_closed','accepted_risk','reopened') THEN
      RAISE EXCEPTION 'a new finding cannot start as %', NEW.status;
    END IF;
    IF NEW.status = 'fix_reported' THEN NEW.fix_reported_at := clock_timestamp(); END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF OLD.status = 'verified_closed' AND NEW.status <> 'reopened' THEN
    RAISE EXCEPTION 'a verified-closed finding can only move to reopened';
  END IF;
  CASE NEW.status
    WHEN 'verified_closed' THEN
      IF NOT EXISTS (SELECT 1 FROM finding_verifications v
                     WHERE v.finding_id = NEW.finding_id AND v.result = 'pass'
                       AND v.verified_at >= COALESCE(OLD.fix_reported_at, '-infinity')) THEN
        RAISE EXCEPTION 'finding % cannot close: no passing verification since the fix was reported', NEW.finding_id;
      END IF;
      NEW.verified_at := clock_timestamp(); NEW.resolved_at := COALESCE(NEW.resolved_at, NEW.verified_at);
    WHEN 'accepted_risk' THEN
      IF NOT EXISTS (SELECT 1 FROM risk_acceptances a WHERE a.finding_id = NEW.finding_id AND a.status = 'active') THEN
        RAISE EXCEPTION 'finding % cannot be accepted: no active risk acceptance', NEW.finding_id;
      END IF;
    WHEN 'fix_reported' THEN
      NEW.fix_reported_at := clock_timestamp(); NEW.resolved_at := NULL;
    ELSE
      NEW.resolved_at := NULL;
      IF NEW.status = 'reopened' THEN NEW.verified_at := NULL; END IF;
  END CASE;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_finding_status_guard BEFORE INSERT OR UPDATE OF status ON risk_findings FOR EACH ROW EXECUTE FUNCTION trg_finding_status_guard();

-- ============================================================================
-- 10. COMPLIANCE
-- ============================================================================
CREATE TABLE compliance_frameworks (
  framework_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(40) NOT NULL UNIQUE,      -- table, not enum: new frameworks need no migration
  display_name          VARCHAR(150) NOT NULL,
  jurisdiction          VARCHAR(60),
  renewal_cycle_months  INT CHECK (renewal_cycle_months > 0)
);

CREATE TABLE framework_controls (
  control_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id    UUID NOT NULL REFERENCES compliance_frameworks(framework_id) ON DELETE CASCADE,
  control_ref     VARCHAR(40) NOT NULL,                  -- e.g. 'PCI 11.3.2'
  title           VARCHAR(250) NOT NULL,
  risk_domain_id  UUID REFERENCES risk_domains(risk_domain_id),
  UNIQUE (framework_id, control_ref)
);

-- Control-level evidence (append-only history; latest row per control is current).
CREATE TABLE control_assessments (
  assessment_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  control_id     UUID NOT NULL REFERENCES framework_controls(control_id),
  status         control_status NOT NULL,
  evidence_ref   TEXT,                                    -- link into the GRC tool of record
  finding_id     UUID,
  assessed_by    UUID,
  assessed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (finding_id, org_id)  REFERENCES risk_findings(finding_id, org_id) ON DELETE SET NULL (finding_id),
  FOREIGN KEY (assessed_by, org_id) REFERENCES users(user_id, org_id)
);
CREATE INDEX ix_control_assessments_latest ON control_assessments(org_id, control_id, assessed_at DESC);
CREATE TRIGGER trg_control_assessments_append_only BEFORE UPDATE ON control_assessments FOR EACH ROW EXECUTE FUNCTION trg_append_only();

-- Framework roll-up snapshot (what the compliance view and board pack quote).
CREATE TABLE org_compliance_status (
  status_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  framework_id        UUID NOT NULL REFERENCES compliance_frameworks(framework_id),
  coverage_pct        NUMERIC(5,2) NOT NULL CHECK (coverage_pct BETWEEN 0 AND 100),
  controls_total      INT CHECK (controls_total >= 0),
  controls_evidenced  INT CHECK (controls_evidenced >= 0),
  next_renewal_date   DATE,
  snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_evidenced_le_total CHECK (controls_evidenced IS NULL OR controls_total IS NULL OR controls_evidenced <= controls_total)
);
CREATE INDEX ix_compliance_status_org ON org_compliance_status(org_id, framework_id, snapshot_at DESC);

-- ============================================================================
-- 11. BOARD PACKS, EXPORTS AND ACTIVITY
-- ============================================================================
CREATE TABLE board_packs (
  pack_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  period_start           DATE NOT NULL,
  period_end             DATE NOT NULL,
  enterprise_snapshot_id UUID NOT NULL,
  prior_snapshot_id      UUID,
  status                 board_pack_status NOT NULL DEFAULT 'draft',
  content                JSONB NOT NULL,                  -- sections; every sentence carries source table + row ids
  generated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by            UUID,
  reviewed_at            TIMESTAMPTZ,
  approved_by            UUID,
  approved_at            TIMESTAMPTZ,
  UNIQUE (pack_id, org_id),
  FOREIGN KEY (enterprise_snapshot_id, org_id) REFERENCES enterprise_scores(snapshot_id, org_id),
  FOREIGN KEY (prior_snapshot_id, org_id)      REFERENCES enterprise_scores(snapshot_id, org_id),
  FOREIGN KEY (reviewed_by, org_id)            REFERENCES users(user_id, org_id),
  FOREIGN KEY (approved_by, org_id)            REFERENCES users(user_id, org_id),
  CONSTRAINT ck_period CHECK (period_end >= period_start),
  CONSTRAINT ck_reviewed CHECK (status = 'draft' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT ck_approved CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT ck_content_obj CHECK (jsonb_typeof(content) = 'object')
);
CREATE FUNCTION trg_board_pack_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    RAISE EXCEPTION 'an approved board pack is frozen; generate a new pack';
  END IF;
  IF NEW.reviewed_by IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.reviewed_by IS DISTINCT FROM NEW.reviewed_by) THEN
    PERFORM fn_require_capability(NEW.reviewed_by, NEW.org_id, 'review_board_pack', 'board pack review');
  END IF;
  IF NEW.approved_by IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.approved_by IS DISTINCT FROM NEW.approved_by) THEN
    PERFORM fn_require_capability(NEW.approved_by, NEW.org_id, 'review_board_pack', 'board pack approval');
    IF NEW.approved_by = NEW.reviewed_by THEN RAISE EXCEPTION 'reviewer and approver must be different people'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_board_pack_guard BEFORE INSERT OR UPDATE ON board_packs FOR EACH ROW EXECUTE FUNCTION trg_board_pack_guard();

CREATE TABLE report_exports (
  export_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  pack_id       UUID,
  report_type   report_type NOT NULL,
  period_start  DATE,
  period_end    DATE,
  file_uri      TEXT NOT NULL,
  sha256        CHAR(64) CHECK (sha256 ~ '^[0-9a-f]{64}$'),  -- proves the file shared is the file generated
  generated_by  UUID,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (pack_id, org_id)      REFERENCES board_packs(pack_id, org_id) ON DELETE SET NULL (pack_id),
  FOREIGN KEY (generated_by, org_id) REFERENCES users(user_id, org_id)
);
CREATE INDEX ix_exports_org ON report_exports(org_id, generated_at DESC);

CREATE TABLE command_center_activity (
  activity_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  risk_domain_id  UUID REFERENCES risk_domains(risk_domain_id),
  activity_type   activity_type NOT NULL,
  summary         VARCHAR(300) NOT NULL,
  entity_type     VARCHAR(50),
  entity_id       UUID,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_activity_org_time ON command_center_activity(org_id, occurred_at DESC);

-- ============================================================================
-- 12. CLOSED-LOOP PROCEDURES
-- ============================================================================
-- Record a verification and move the finding.  Pass => verified_closed, fail => reopened.
CREATE FUNCTION sp_verify_finding(p_finding UUID, p_result verification_result, p_evidence JSONB DEFAULT NULL, p_run UUID DEFAULT NULL)
RETURNS finding_status LANGUAGE plpgsql AS $$
DECLARE f risk_findings; new_status finding_status;
BEGIN
  SELECT * INTO f FROM risk_findings WHERE finding_id = p_finding FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'finding % not found (or not visible)', p_finding; END IF;
  INSERT INTO finding_verifications(org_id, finding_id, run_id, result, evidence, verified_by)
  VALUES (f.org_id, p_finding, p_run, p_result, p_evidence, app_user_id());
  IF f.status IN ('fix_reported','reopened') AND p_result <> 'no_check' THEN
    new_status := CASE WHEN p_result = 'pass' THEN 'verified_closed'::finding_status ELSE 'reopened'::finding_status END;
    UPDATE risk_findings SET status = new_status WHERE finding_id = p_finding;
    INSERT INTO command_center_activity(org_id, risk_domain_id, activity_type, summary, entity_type, entity_id)
    VALUES (f.org_id, f.risk_domain_id, 'verification_completed',
            left(CASE WHEN p_result = 'pass' THEN 'Verified closed: ' ELSE 'Re-scan still finds: ' END || f.title, 300), 'risk_findings', p_finding);
    RETURN new_status;
  END IF;
  RETURN f.status;
END $$;

-- Expire acceptances: the finding reopens and a renewal decision goes back on the agenda.
CREATE FUNCTION sp_expire_acceptances(p_now TIMESTAMPTZ DEFAULT now()) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE n INT := 0; r RECORD;
BEGIN
  FOR r IN SELECT a.acceptance_id, a.org_id, a.finding_id, a.reason, f.title, f.severity, f.risk_domain_id
           FROM risk_acceptances a JOIN risk_findings f USING (finding_id)
           WHERE a.status = 'active' AND a.expires_at <= p_now FOR UPDATE OF a LOOP
    UPDATE risk_acceptances SET status = 'expired' WHERE acceptance_id = r.acceptance_id;
    UPDATE risk_findings SET status = 'reopened' WHERE finding_id = r.finding_id AND status = 'accepted_risk';
    INSERT INTO executive_decisions(org_id, decision_type, title, priority, risk_summary, impact_summary, recommended_action,
                                    finding_id, acceptance_id)
    VALUES (r.org_id, 'renew_acceptance', left('Accepted risk expired: ' || r.title, 250), r.severity,
            'The risk acceptance has expired and the finding is open again.',
            'Original acceptance reason: ' || r.reason,
            'Fix the finding, or renew the acceptance with a fresh reason and expiry.', r.finding_id, r.acceptance_id);
    INSERT INTO command_center_activity(org_id, risk_domain_id, activity_type, summary, entity_type, entity_id)
    VALUES (r.org_id, r.risk_domain_id, 'acceptance_expired', left('Acceptance expired: ' || r.title, 300), 'risk_acceptances', r.acceptance_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ============================================================================
-- 13. SCORING FUNCTIONS
-- ============================================================================
-- Raw domain score = 100 x sum(weight x gap) / sum(weight) over each owning category's latest signal.
CREATE FUNCTION fn_domain_raw_score(p_org UUID, p_domain UUID, p_policy UUID, p_at TIMESTAMPTZ DEFAULT now())
RETURNS TABLE(raw_score NUMERIC, categories_expected INT, categories_present INT)
LANGUAGE sql STABLE AS $$
  WITH cats AS (
    SELECT w.category_id, w.weight FROM policy_category_weights w
    JOIN signal_domain_map m ON m.category_id = w.category_id AND m.role = 'owning' AND m.risk_domain_id = p_domain
    WHERE w.policy_id = p_policy AND w.weight > 0
  ), latest AS (
    SELECT DISTINCT ON (s.category_id) s.category_id, s.gap
    FROM control_signals s JOIN cats c ON c.category_id = s.category_id
    WHERE s.org_id = p_org AND s.observed_at <= p_at
    ORDER BY s.category_id, s.observed_at DESC
  )
  SELECT round(100 * sum(c.weight * l.gap) / NULLIF(sum(c.weight), 0), 2),
         (SELECT count(*)::int FROM cats),
         count(l.category_id)::int
  FROM cats c JOIN latest l USING (category_id)
$$;

CREATE VIEW v_category_coverage WITH (security_invoker = true) AS
SELECT ac.org_id, ac.category_id,
       count(*) FILTER (WHERE ac.in_scope) AS assets_in_scope,
       count(*) FILTER (WHERE ac.in_scope AND ac.last_seen_at >= now() - interval '7 days') AS assets_seen,
       CASE WHEN count(*) FILTER (WHERE ac.in_scope) = 0 THEN NULL
            ELSE round((count(*) FILTER (WHERE ac.in_scope AND ac.last_seen_at >= now() - interval '7 days'))::numeric
                       / count(*) FILTER (WHERE ac.in_scope), 3) END AS coverage
FROM asset_coverage ac JOIN asset_inventory a ON a.asset_id = ac.asset_id AND a.retired_at IS NULL
GROUP BY ac.org_id, ac.category_id;

-- Coverage of one category, using the policy's look-back window.
CREATE FUNCTION fn_category_coverage(p_org UUID, p_category UUID, p_window_days INT, p_at TIMESTAMPTZ DEFAULT now()) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN count(*) = 0 THEN 0
              ELSE round(count(*) FILTER (WHERE ac.last_seen_at >= p_at - make_interval(days => p_window_days))::numeric / count(*), 3) END
  FROM asset_coverage ac JOIN asset_inventory a ON a.asset_id = ac.asset_id AND a.retired_at IS NULL
  WHERE ac.org_id = p_org AND ac.category_id = p_category AND ac.in_scope
$$;

CREATE FUNCTION fn_domain_coverage(p_org UUID, p_domain UUID, p_policy UUID, p_at TIMESTAMPTZ DEFAULT now()) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(round(sum(w.weight * fn_category_coverage(p_org, w.category_id, p.coverage_window_days, p_at)) / NULLIF(sum(w.weight), 0), 3), 0)
  FROM policy_category_weights w
  JOIN scoring_policy p ON p.policy_id = w.policy_id
  JOIN signal_domain_map m ON m.category_id = w.category_id AND m.role = 'owning' AND m.risk_domain_id = p_domain
  WHERE w.policy_id = p_policy AND w.weight > 0
$$;

-- A connector is fresh when its last good run started within freshness_factor x schedule
-- and rejected no more than max_rejected_rate of rows.
CREATE FUNCTION fn_domain_feeds(p_org UUID, p_domain UUID, p_policy UUID, p_at TIMESTAMPTZ DEFAULT now())
RETURNS TABLE(feeds_total INT, feeds_fresh INT, rejected_rate NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH pol AS (SELECT freshness_factor, max_rejected_rate FROM scoring_policy WHERE policy_id = p_policy),
  conns AS (
    SELECT c.connector_id, c.schedule_minutes FROM org_connectors c
    JOIN signal_domain_map m ON m.category_id = c.category_id AND m.role = 'owning' AND m.risk_domain_id = p_domain
    WHERE c.org_id = p_org AND c.is_active
  ), last_run AS (
    SELECT DISTINCT ON (r.connector_id) r.connector_id, r.started_at, r.status, r.rejected_rate
    FROM ingestion_runs r JOIN conns c USING (connector_id)
    WHERE r.org_id = p_org AND r.started_at <= p_at AND r.status IN ('success','partial')
    ORDER BY r.connector_id, r.started_at DESC
  )
  SELECT count(*)::int,
         (count(*) FILTER (WHERE l.status = 'success' AND l.rejected_rate <= pol.max_rejected_rate
                           AND l.started_at >= p_at - make_interval(mins => (c.schedule_minutes * pol.freshness_factor)::int)))::int,
         COALESCE(round(avg(l.rejected_rate), 4), 0)
  FROM conns c CROSS JOIN pol LEFT JOIN last_run l USING (connector_id)
$$;

-- Score one domain end to end and keep the explanation (components).
CREATE FUNCTION sp_score_domain(p_org UUID, p_domain UUID, p_policy UUID, p_at TIMESTAMPTZ DEFAULT now(), p_detail VARCHAR DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE r RECORD; f RECORD; cov NUMERIC; u NUMERIC; sid UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM scoring_policy WHERE policy_id = p_policy AND org_id = p_org) THEN
    RAISE EXCEPTION 'policy % does not belong to org %', p_policy, p_org;
  END IF;
  SELECT * INTO r FROM fn_domain_raw_score(p_org, p_domain, p_policy, p_at);
  IF r.raw_score IS NULL THEN RAISE EXCEPTION 'no signals for domain % at %; refusing to score silently', p_domain, p_at; END IF;
  SELECT * INTO f FROM fn_domain_feeds(p_org, p_domain, p_policy, p_at);
  -- missing categories reduce coverage, so the unobserved default fills the gap
  cov := fn_domain_coverage(p_org, p_domain, p_policy, p_at) * r.categories_present::numeric / GREATEST(r.categories_expected, 1);
  SELECT unobserved_default INTO u FROM scoring_policy WHERE policy_id = p_policy;
  INSERT INTO domain_scores(org_id, risk_domain_id, policy_id, snapshot_at, raw_score, coverage, unobserved_default,
                            adjusted_score, feeds_total, feeds_fresh, rejected_rate, confidence, band, headline_detail)
  VALUES (p_org, p_domain, p_policy, p_at, r.raw_score, round(cov, 3), u, 0, f.feeds_total, f.feeds_fresh, f.rejected_rate, 0, 'low', p_detail)
  RETURNING score_id INTO sid;
  INSERT INTO domain_score_components(score_id, org_id, category_id, signal_id, weight, gap, points)
  SELECT sid, p_org, w.category_id, l.signal_id, w.weight, l.gap, round(w.weight * l.gap, 2)
  FROM policy_category_weights w
  JOIN signal_domain_map m ON m.category_id = w.category_id AND m.role = 'owning' AND m.risk_domain_id = p_domain
  LEFT JOIN LATERAL (SELECT s.signal_id, s.gap FROM control_signals s
                     WHERE s.org_id = p_org AND s.category_id = w.category_id AND s.observed_at <= p_at
                     ORDER BY s.observed_at DESC LIMIT 1) l ON true
  WHERE w.policy_id = p_policy AND w.weight > 0;
  RETURN sid;
END $$;

-- Enterprise headline: weighted mean of adjusted scores over ACTIVE subscriptions, then the floor rule.
CREATE FUNCTION fn_enterprise_headline(p_org UUID, p_at TIMESTAMPTZ)
RETURNS TABLE(policy_id UUID, arithmetic_score NUMERIC, arithmetic_band severity_level, displayed_band severity_level, floor_applied BOOLEAN,
              n_critical INT, n_high INT, n_medium INT, n_low INT, n_outside_appetite INT, confidence NUMERIC, n_policies INT)
LANGUAGE sql STABLE AS $$
  WITH s AS (
    SELECT d.*, w.weight FROM domain_scores d
    JOIN org_domain_subscriptions sub ON sub.org_id = d.org_id AND sub.risk_domain_id = d.risk_domain_id AND sub.is_active
    JOIN policy_domain_weights w ON w.policy_id = d.policy_id AND w.risk_domain_id = d.risk_domain_id
    WHERE d.org_id = p_org AND d.snapshot_at = p_at
  ), ap AS (
    SELECT DISTINCT ON (risk_domain_id) risk_domain_id, max_score FROM risk_appetite
    WHERE org_id = p_org AND risk_domain_id IS NOT NULL AND effective_from <= p_at::date
    ORDER BY risk_domain_id, effective_from DESC
  ), agg AS (
    SELECT min(s.policy_id::text)::uuid AS policy_id, count(DISTINCT s.policy_id)::int AS n_pol,
           round(sum(s.adjusted_score * s.weight) / sum(s.weight), 2) AS arith,
           round(sum(s.confidence * s.weight) / sum(s.weight), 3) AS conf,
           count(*) FILTER (WHERE s.band = 'critical')::int AS nc, count(*) FILTER (WHERE s.band = 'high')::int AS nh,
           count(*) FILTER (WHERE s.band = 'medium')::int AS nm,   count(*) FILTER (WHERE s.band = 'low')::int AS nl,
           count(*) FILTER (WHERE s.adjusted_score > ap.max_score)::int AS nout
    FROM s LEFT JOIN ap USING (risk_domain_id)
  ), b AS (
    SELECT a.*, fn_band(a.arith, a.policy_id) AS ab, p.floor_enabled, p.floor_band
    FROM agg a JOIN scoring_policy p ON p.policy_id = a.policy_id WHERE a.arith IS NOT NULL
  )
  SELECT b.policy_id, b.arith, b.ab,
         CASE WHEN b.floor_enabled AND b.nc > 0 THEN greatest(b.ab, b.floor_band) ELSE b.ab END,
         (CASE WHEN b.floor_enabled AND b.nc > 0 THEN greatest(b.ab, b.floor_band) ELSE b.ab END) <> b.ab,
         b.nc, b.nh, b.nm, b.nl, b.nout, b.conf, b.n_pol
  FROM b
$$;

CREATE FUNCTION sp_snapshot_enterprise(p_org UUID, p_at TIMESTAMPTZ, p_driver VARCHAR DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE h RECORD; sid UUID;
BEGIN
  SELECT * INTO h FROM fn_enterprise_headline(p_org, p_at);
  IF NOT FOUND THEN RAISE EXCEPTION 'no subscribed domain scores for org % at %', p_org, p_at; END IF;
  IF h.n_policies > 1 THEN RAISE EXCEPTION 'domain scores at % were computed under % different policies', p_at, h.n_policies; END IF;
  INSERT INTO enterprise_scores(org_id, policy_id, snapshot_at, arithmetic_score, arithmetic_band, displayed_band, floor_applied,
                                n_critical, n_high, n_medium, n_low, n_outside_appetite, confidence, driver_summary)
  VALUES (p_org, h.policy_id, p_at, h.arithmetic_score, h.arithmetic_band, h.displayed_band, h.floor_applied,
          h.n_critical, h.n_high, h.n_medium, h.n_low, h.n_outside_appetite, h.confidence, p_driver)
  RETURNING snapshot_id INTO sid;
  RETURN sid;
END $$;

-- "What changed since the last board": domain movers between two snapshot times.
-- same_policy = false warns that part of the move is a methodology change.
CREATE FUNCTION fn_domain_movers(p_org UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE(domain_code domain_code, score_from NUMERIC, score_to NUMERIC, delta NUMERIC,
              band_from severity_level, band_to severity_level, same_policy BOOLEAN)
LANGUAGE sql STABLE AS $$
  WITH a AS (SELECT DISTINCT ON (risk_domain_id) * FROM domain_scores WHERE org_id = p_org AND snapshot_at <= p_from ORDER BY risk_domain_id, snapshot_at DESC),
       b AS (SELECT DISTINCT ON (risk_domain_id) * FROM domain_scores WHERE org_id = p_org AND snapshot_at <= p_to   ORDER BY risk_domain_id, snapshot_at DESC)
  SELECT rd.code, a.adjusted_score, b.adjusted_score, b.adjusted_score - a.adjusted_score, a.band, b.band, a.policy_id = b.policy_id
  FROM b JOIN a USING (risk_domain_id) JOIN risk_domains rd USING (risk_domain_id)
  ORDER BY abs(b.adjusted_score - a.adjusted_score) DESC
$$;

-- ============================================================================
-- 14. VIEWS FOR THE EIGHT EXECUTIVE QUESTIONS  (security_invoker: RLS applies)
-- ============================================================================
-- Q2/Q3: Where are we weakest? Can I believe the numbers?
CREATE VIEW v_domain_posture WITH (security_invoker = true) AS
WITH latest AS (
  SELECT DISTINCT ON (org_id, risk_domain_id) * FROM domain_scores ORDER BY org_id, risk_domain_id, snapshot_at DESC
), ap AS (
  SELECT DISTINCT ON (org_id, risk_domain_id) org_id, risk_domain_id, max_score, approaching_margin, review_date
  FROM risk_appetite WHERE effective_from <= CURRENT_DATE AND risk_domain_id IS NOT NULL
  ORDER BY org_id, risk_domain_id, effective_from DESC
)
SELECT l.org_id, rd.risk_domain_id, rd.code AS domain_code, rd.short_label, rd.csf_functions, l.snapshot_at,
       l.raw_score, l.coverage, l.adjusted_score, l.band, l.confidence,
       CASE WHEN l.confidence >= 0.8 THEN 'high' WHEN l.confidence >= 0.5 THEN 'medium' ELSE 'low' END AS confidence_label,
       l.feeds_fresh, l.feeds_total, l.headline_detail, ap.max_score AS appetite_max,
       CASE WHEN ap.max_score IS NULL THEN 'not_set'
            WHEN l.adjusted_score > ap.max_score THEN 'outside_appetite'
            WHEN l.adjusted_score > ap.max_score - ap.approaching_margin THEN 'approaching'
            ELSE 'within_appetite' END AS appetite_state
FROM latest l
JOIN org_domain_subscriptions sub ON sub.org_id = l.org_id AND sub.risk_domain_id = l.risk_domain_id AND sub.is_active
JOIN risk_domains rd ON rd.risk_domain_id = l.risk_domain_id
LEFT JOIN ap ON ap.org_id = l.org_id AND ap.risk_domain_id = l.risk_domain_id;

-- Q1: Are we OK?  Money columns come back NULL for roles without view_financials (RLS on the loss table).
CREATE VIEW v_enterprise_headline WITH (security_invoker = true) AS
SELECT DISTINCT ON (e.org_id) e.org_id, e.snapshot_id, e.snapshot_at, e.arithmetic_score, e.arithmetic_band, e.displayed_band,
       e.floor_applied, e.n_critical, e.n_high, e.n_medium, e.n_low, e.n_outside_appetite, e.confidence, e.driver_summary,
       p.version AS policy_version, p.status AS policy_status,
       l.currency, l.ale_expected, l.ale_p90, l.ale_p95
FROM enterprise_scores e
JOIN scoring_policy p ON p.policy_id = e.policy_id
LEFT JOIN enterprise_loss_estimates l ON l.snapshot_id = e.snapshot_id
ORDER BY e.org_id, e.snapshot_at DESC;

-- Q4: What needs my decision today?  Ranked by finding priority, then decision priority.
CREATE VIEW v_decision_queue WITH (security_invoker = true) AS
SELECT d.org_id, d.decision_id, d.decision_type, d.title, d.priority, d.status, d.escalated_at, d.due_by,
       d.risk_summary, d.impact_summary, d.recommended_action,
       rd.short_label AS domain, f.finding_id, f.priority_score, f.kev_listed, f.epss, f.sla_due_at,
       a.name AS asset_name, a.crown_jewel, u.first_name || COALESCE(' ' || u.last_name, '') AS owner_name,
       i.currency, i.financial_exposure_amount, lm.ale_mean, lm.annual_p90
FROM executive_decisions d
LEFT JOIN risk_findings f   ON f.finding_id = d.finding_id
LEFT JOIN risk_domains rd   ON rd.risk_domain_id = f.risk_domain_id
LEFT JOIN asset_inventory a ON a.asset_id = f.asset_id
LEFT JOIN users u           ON u.user_id = f.owner_user_id
LEFT JOIN business_impact_assessments i ON i.impact_id = d.impact_id
LEFT JOIN LATERAL (SELECT ale_mean, annual_p90 FROM loss_models m
                   WHERE m.finding_id = d.finding_id OR m.scenario_id = d.scenario_id
                   ORDER BY m.simulated_at DESC LIMIT 1) lm ON true
WHERE d.status IN ('awaiting_decision','info_requested')
ORDER BY f.priority_score DESC NULLS LAST, d.priority DESC, d.escalated_at;

-- Q6: Did it work?
CREATE VIEW v_mttr_by_domain WITH (security_invoker = true) AS
SELECT f.org_id, rd.code AS domain_code, f.severity, count(*) AS closed_findings,
       round(avg(extract(epoch FROM (f.verified_at - f.detected_at)) / 86400)::numeric, 1) AS mean_days_to_remediate
FROM risk_findings f JOIN risk_domains rd ON rd.risk_domain_id = f.risk_domain_id
WHERE f.status = 'verified_closed' AND f.verified_at IS NOT NULL
GROUP BY f.org_id, rd.code, f.severity;

CREATE VIEW v_sla_breaches WITH (security_invoker = true) AS
SELECT f.org_id, f.finding_id, f.title, f.severity, f.status, f.owner_user_id, f.detected_at, f.sla_due_at,
       floor(extract(epoch FROM (now() - f.sla_due_at)) / 86400)::int AS days_overdue
FROM risk_findings f
WHERE f.sla_due_at IS NOT NULL AND f.sla_due_at < now() AND f.status NOT IN ('verified_closed','accepted_risk');

CREATE VIEW v_fixes_awaiting_verification WITH (security_invoker = true) AS
SELECT f.org_id, f.finding_id, f.title, f.severity, f.status, f.fix_reported_at, f.owner_user_id,
       (SELECT v.result FROM finding_verifications v WHERE v.finding_id = f.finding_id ORDER BY v.verified_at DESC LIMIT 1) AS last_result
FROM risk_findings f WHERE f.status IN ('fix_reported','reopened');

CREATE VIEW v_acceptances_expiring WITH (security_invoker = true) AS
SELECT a.org_id, a.acceptance_id, a.finding_id, f.title, a.reason, a.approver_user_id, a.expires_at, a.renewal_count,
       (a.expires_at::date - CURRENT_DATE) AS days_left
FROM risk_acceptances a JOIN risk_findings f ON f.finding_id = a.finding_id
WHERE a.status = 'active' AND a.expires_at <= now() + interval '30 days';

-- Compliance posture: latest snapshot per framework.
CREATE VIEW v_compliance_posture WITH (security_invoker = true) AS
SELECT DISTINCT ON (s.org_id, s.framework_id) s.org_id, fw.code, fw.display_name, s.coverage_pct, s.controls_total,
       s.controls_evidenced, s.next_renewal_date, s.snapshot_at
FROM org_compliance_status s JOIN compliance_frameworks fw ON fw.framework_id = s.framework_id
ORDER BY s.org_id, s.framework_id, s.snapshot_at DESC;

-- ============================================================================
-- 15. TAMPER-EVIDENT AUDIT LOG  (hash chain per organisation; outlives tenants)
-- ============================================================================
CREATE TABLE audit_log (
  log_id      BIGSERIAL PRIMARY KEY,
  org_id      UUID,                                       -- no FK: audit rows outlive tenants and users
  user_id     UUID,
  action      VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   UUID,
  old_value   JSONB,
  new_value   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  chain_key   UUID GENERATED ALWAYS AS (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  prev_hash   TEXT,
  row_hash    TEXT
);
CREATE INDEX ix_audit_time  ON audit_log(created_at DESC);
CREATE INDEX ix_audit_chain ON audit_log(chain_key, log_id);
CREATE INDEX ix_audit_entity ON audit_log(entity_type, entity_id);

CREATE FUNCTION fn_audit_hash(p_prev TEXT, r audit_log) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(concat_ws('|', COALESCE(p_prev,''), r.log_id, r.org_id, r.user_id, r.action, r.entity_type, r.entity_id,
                                 COALESCE(r.old_value::text,''), COALESCE(r.new_value::text,''), r.created_at), 'sha256'), 'hex')
$$;

CREATE FUNCTION trg_audit_chain() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE prev TEXT; k UUID := COALESCE(NEW.org_id, '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(k::text, 0));
  SELECT row_hash INTO prev FROM audit_log WHERE chain_key = k ORDER BY log_id DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.row_hash  := fn_audit_hash(prev, NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_audit_chain BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION trg_audit_chain();

CREATE FUNCTION trg_audit_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
CREATE TRIGGER trg_audit_no_update   BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION trg_audit_immutable();
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION trg_audit_immutable();

-- First broken row of each chain (empty = intact).
CREATE FUNCTION fn_verify_audit_chain(p_org UUID DEFAULT NULL)
RETURNS TABLE(chain_key UUID, bad_log_id BIGINT, reason TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ordered AS (
    SELECT a AS rec, a.chain_key AS ck, a.log_id AS lid, lag(a.row_hash) OVER (PARTITION BY a.chain_key ORDER BY a.log_id) AS expected_prev
    FROM audit_log a WHERE p_org IS NULL OR a.chain_key = p_org
  ), bad AS (
    SELECT o.ck, o.lid,
           CASE WHEN (o.rec).prev_hash IS DISTINCT FROM o.expected_prev THEN 'prev_hash does not match the previous row'
                WHEN (o.rec).row_hash IS DISTINCT FROM fn_audit_hash((o.rec).prev_hash, o.rec) THEN 'row content does not match its hash' END AS reason
    FROM ordered o
  )
  SELECT DISTINCT ON (b.ck) b.ck, b.lid, b.reason FROM bad b WHERE b.reason IS NOT NULL ORDER BY b.ck, b.lid
$$;

-- Generic row audit.  TG_ARGV[0] = primary key column.
CREATE FUNCTION trg_audit_row() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE j JSONB := to_jsonb(COALESCE(NEW, OLD));
        o JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
        n JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
BEGIN
  IF TG_OP = 'UPDATE' AND (o - 'updated_at') = (n - 'updated_at') THEN RETURN NULL; END IF;
  INSERT INTO audit_log(org_id, user_id, action, entity_type, entity_id, old_value, new_value)
  VALUES ((j->>'org_id')::uuid, app_user_id(), lower(TG_OP), TG_TABLE_NAME, (j->>TG_ARGV[0])::uuid, o, n);
  RETURN NULL;
END $$;
CREATE TRIGGER aud_users          AFTER INSERT OR UPDATE OF role, is_active, org_id OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION trg_audit_row('user_id');
CREATE TRIGGER aud_subscriptions  AFTER INSERT OR UPDATE OR DELETE ON org_domain_subscriptions    FOR EACH ROW EXECUTE FUNCTION trg_audit_row('risk_domain_id');
CREATE TRIGGER aud_scoring_policy AFTER INSERT OR UPDATE OR DELETE ON scoring_policy              FOR EACH ROW EXECUTE FUNCTION trg_audit_row('policy_id');
CREATE TRIGGER aud_risk_appetite  AFTER INSERT OR UPDATE OR DELETE ON risk_appetite               FOR EACH ROW EXECUTE FUNCTION trg_audit_row('appetite_id');
CREATE TRIGGER aud_findings_status AFTER UPDATE OF status, owner_user_id, severity ON risk_findings FOR EACH ROW EXECUTE FUNCTION trg_audit_row('finding_id');
CREATE TRIGGER aud_scenarios      AFTER INSERT OR UPDATE OR DELETE ON risk_scenarios              FOR EACH ROW EXECUTE FUNCTION trg_audit_row('scenario_id');
CREATE TRIGGER aud_impact         AFTER INSERT OR UPDATE OR DELETE ON business_impact_assessments FOR EACH ROW EXECUTE FUNCTION trg_audit_row('impact_id');
CREATE TRIGGER aud_loss_models    AFTER INSERT OR UPDATE OR DELETE ON loss_models                 FOR EACH ROW EXECUTE FUNCTION trg_audit_row('model_id');
CREATE TRIGGER aud_acceptances    AFTER INSERT OR UPDATE OR DELETE ON risk_acceptances            FOR EACH ROW EXECUTE FUNCTION trg_audit_row('acceptance_id');
CREATE TRIGGER aud_decisions      AFTER INSERT OR UPDATE OR DELETE ON executive_decisions         FOR EACH ROW EXECUTE FUNCTION trg_audit_row('decision_id');
CREATE TRIGGER aud_plans          AFTER INSERT OR UPDATE OR DELETE ON treatment_plans             FOR EACH ROW EXECUTE FUNCTION trg_audit_row('plan_id');
CREATE TRIGGER aud_actions        AFTER INSERT OR UPDATE OR DELETE ON remediation_actions         FOR EACH ROW EXECUTE FUNCTION trg_audit_row('action_id');
CREATE TRIGGER aud_board_packs    AFTER INSERT OR UPDATE OR DELETE ON board_packs                 FOR EACH ROW EXECUTE FUNCTION trg_audit_row('pack_id');
CREATE TRIGGER aud_exports        AFTER INSERT OR UPDATE OR DELETE ON report_exports              FOR EACH ROW EXECUTE FUNCTION trg_audit_row('export_id');

-- ============================================================================
-- 16. ROW-LEVEL SECURITY
-- ============================================================================
-- Standard tenant isolation on every table that carries org_id.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_units','users','org_domain_subscriptions','org_connectors','ingestion_runs','asset_inventory','asset_coverage',
    'control_signals','scoring_policy','policy_domain_weights','policy_category_weights','policy_sla','risk_appetite',
    'domain_scores','domain_score_components','enterprise_scores','risk_findings','finding_verifications','risk_scenarios',
    'scenario_findings','risk_acceptances','executive_decisions','decision_action_log','treatment_plans','remediation_actions',
    'control_assessments','org_compliance_status','board_packs','report_exports','command_center_activity'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id())', t);
  END LOOP;
END $$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());

-- Financial tables: writable within the tenant, readable only with view_financials
-- (the engine role always reads, so it can compute).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_impact_assessments','loss_models','enterprise_loss_estimates','whatif_scenarios'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY fin_insert ON %I FOR INSERT WITH CHECK (org_id = app_org_id())', t);
    EXECUTE format('CREATE POLICY fin_select ON %I FOR SELECT USING (org_id = app_org_id() AND (fn_user_can(''view_financials'') OR pg_has_role(current_user, ''ccc_engine'', ''MEMBER'')))', t);
    EXECUTE format('CREATE POLICY fin_update ON %I FOR UPDATE USING (org_id = app_org_id() AND (fn_user_can(''view_financials'') OR pg_has_role(current_user, ''ccc_engine'', ''MEMBER''))) WITH CHECK (org_id = app_org_id())', t);
    EXECUTE format('CREATE POLICY fin_delete ON %I FOR DELETE USING (org_id = app_org_id() AND (fn_user_can(''view_financials'') OR pg_has_role(current_user, ''ccc_engine'', ''MEMBER'')))', t);
  END LOOP;
END $$;

-- Audit log: tenants read and append to their own chain.  Not FORCED: the chain trigger is SECURITY DEFINER.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_select_own ON audit_log FOR SELECT USING (org_id = app_org_id());
CREATE POLICY audit_insert_own ON audit_log FOR INSERT WITH CHECK (org_id = app_org_id());

-- CI check: every table with org_id must have RLS enabled, forced (audit_log exempt) and a policy.
CREATE FUNCTION rls_audit() RETURNS TABLE(table_name TEXT, problem TEXT) LANGUAGE sql STABLE AS $$
  WITH t AS (
    SELECT c.oid, c.relname::text AS n, c.relrowsecurity AS en, c.relforcerowsecurity AS fo
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
  )
  SELECT n, CASE WHEN NOT en THEN 'RLS not enabled'
                 WHEN NOT fo AND n <> 'audit_log' THEN 'RLS not forced'
                 ELSE 'no policy' END
  FROM t WHERE NOT en OR (NOT fo AND n <> 'audit_log') OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = t.oid)
$$;

-- ============================================================================
-- 17. PRIVILEGES
-- ============================================================================
GRANT USAGE ON SCHEMA public TO ccc_app, ccc_engine;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ccc_app, ccc_engine;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ccc_app, ccc_engine;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ccc_app, ccc_engine;
-- reference data is read-only
REVOKE INSERT, UPDATE, DELETE ON risk_domains, role_capabilities, tool_categories, signal_domain_map,
       compliance_frameworks, framework_controls, schema_migrations FROM ccc_app, ccc_engine;
-- append-only evidence
REVOKE UPDATE, DELETE ON control_signals, domain_scores, domain_score_components, enterprise_scores, enterprise_loss_estimates,
       finding_verifications, decision_action_log, control_assessments FROM ccc_app, ccc_engine;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ccc_app, ccc_engine;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM ccc_app, ccc_engine;
-- only the engine writes scores and loss estimates
REVOKE INSERT ON domain_scores, domain_score_components, enterprise_scores, enterprise_loss_estimates, control_signals FROM ccc_app;

-- ============================================================================
-- 18. REFERENCE DATA
-- ============================================================================
INSERT INTO role_capabilities VALUES
--  role              fin    tech   decide accept policy verify pack   users
--  Policy: CISO proposes drafts; Board and CxO (approve_policy) lock. CISO has no approve_policy.
--  Accept risk: CxO and Risk Lead (product decision).
  ('board_member',   true,  false, false, false, true,  false, true,  false),
  ('cxo',            true,  false, true,  true,  true,  false, true,  false),
  ('ciso',           true,  true,  true,  false, false, true,  true,  false),
  ('risk_lead',      true,  true,  false, true,  false, true,  true,  false),
  ('domain_analyst', false, true,  false, false, false, true,  false, false),
  ('program_office', false, false, false, false, false, false, true,  false),
  ('auditor',        true,  true,  false, false, false, false, false, false),
  ('admin',          false, false, false, false, false, false, false, true);

INSERT INTO risk_domains (code, display_name, short_label, yvi_solution, csf_functions, sort_order) VALUES
  ('vapt_asm','Attack Surface & VAPT','Attack Surface (VAPT/ASM)','YVI Digital Attack Surface Shield','{Identify,Protect}',1),
  ('soc_mdr','SOC & MDR','SOC / MDR','YVI Cyber Fusion SOC','{Detect,Respond}',2),
  ('third_party_risk','Third-Party / Supply-Chain Risk','Third-Party Risk','YVI Third-Party Cyber Intelligence','{Govern,Identify}',3),
  ('ransomware_readiness','Ransomware Readiness & Resilience','Ransomware Readiness','YVI Cyber Recovery Assurance','{Protect,Recover}',4),
  ('pci_dss','PCI DSS & Data Security','PCI DSS / Data Trust','YVI DataTrust & PCI Shield','{Protect}',5),
  ('ai_governance','AI Security & GenAI Governance','AI Governance','YVI AI TrustGuard','{Govern,Protect}',6),
  ('iam_pam','Identity & Privileged Access Management','IAM / PAM','YVI HealthSecure Fabric','{Protect}',7),
  ('phishing_bec','Phishing / BEC Defense','Phishing / BEC','YVI Human + AI Defense Layer','{Protect}',8),
  ('vciso','Managed vCISO & Cyber CoE','vCISO / Cyber CoE','YVI Cyber CoE-as-a-Service','{Govern}',9),
  ('cspm_cnapp','Cloud Security Posture Management','Cloud (CSPM/CNAPP)','YVI CloudGuard AI','{Protect}',10),
  ('compliance_engine','Continuous Compliance','Compliance Engine','YVI Continuous Compliance Engine','{Govern,Identify,Protect,Detect,Respond,Recover}',11),
  ('ot_ics','OT / ICS Security','OT / ICS Security','YVI OT CyberGuard','{Protect,Detect}',12);

-- Starter tool-category catalogue: each owned by exactly one domain.  Extend per client.
INSERT INTO tool_categories (code, name, ingestion_pattern) VALUES
  ('external_asm','External attack surface management','api_pull'), ('vuln_management','Vulnerability management','api_pull'),
  ('pentest','Penetration test findings','file_drop'),
  ('mdr_alerting','MDR alert handling','siem_query'), ('ndr_ueba','NDR / UEBA sensors','streaming'), ('soc_case_mgmt','SOC case management','api_pull'),
  ('vendor_assessment','Vendor security assessments','api_pull'), ('vendor_ratings','Vendor security ratings','api_pull'),
  ('edr_xdr','EDR / XDR','api_pull'), ('siem_soar','SIEM / SOAR','siem_query'),
  ('immutable_backup','Immutable backup','api_pull'), ('dr_testing','DR / recovery testing','file_drop'),
  ('dlp','Data loss prevention','api_pull'), ('card_data_discovery','Card data discovery','api_pull'),
  ('ai_inventory','AI system inventory','api_pull'), ('ai_guardrails','GenAI guardrails and monitoring','log_forwarding'),
  ('idp_mfa','Identity provider and MFA','api_pull'), ('pam_vault','Privileged access vault','api_pull'), ('identity_governance','Identity governance','api_pull'),
  ('email_security','Email security gateway','log_forwarding'), ('phishing_simulation','Phishing simulation','api_pull'),
  ('governance_program','Security governance programme','file_drop'),
  ('cspm','Cloud posture (CSPM)','api_pull'), ('cwpp','Cloud workload protection','api_pull'),
  ('grc_controls','GRC control testing','api_pull'),
  ('ot_monitoring','OT network monitoring','streaming');

INSERT INTO signal_domain_map (category_id, risk_domain_id, role)
SELECT c.category_id, d.risk_domain_id, m.role::signal_role
FROM (VALUES
  ('external_asm','vapt_asm','owning'),('vuln_management','vapt_asm','owning'),('pentest','vapt_asm','owning'),
  ('mdr_alerting','soc_mdr','owning'),('ndr_ueba','soc_mdr','owning'),('soc_case_mgmt','soc_mdr','owning'),
  ('edr_xdr','soc_mdr','lens'),('siem_soar','soc_mdr','lens'),
  ('vendor_assessment','third_party_risk','owning'),('vendor_ratings','third_party_risk','owning'),
  ('edr_xdr','ransomware_readiness','owning'),('siem_soar','ransomware_readiness','owning'),
  ('immutable_backup','ransomware_readiness','owning'),('dr_testing','ransomware_readiness','owning'),
  ('dlp','pci_dss','owning'),('card_data_discovery','pci_dss','owning'),
  ('ai_inventory','ai_governance','owning'),('ai_guardrails','ai_governance','owning'),
  ('idp_mfa','iam_pam','owning'),('pam_vault','iam_pam','owning'),('identity_governance','iam_pam','owning'),
  ('email_security','phishing_bec','owning'),('phishing_simulation','phishing_bec','owning'),
  ('governance_program','vciso','owning'),
  ('cspm','cspm_cnapp','owning'),('cwpp','cspm_cnapp','owning'),
  ('grc_controls','compliance_engine','owning'),
  ('ot_monitoring','ot_ics','owning')
) AS m(cat, dom, role)
JOIN tool_categories c ON c.code = m.cat JOIN risk_domains d ON d.code = m.dom::domain_code;

INSERT INTO compliance_frameworks (code, display_name, jurisdiction, renewal_cycle_months) VALUES
  ('dubai_isr','Dubai ISR','AE-DU',12),
  ('pci_dss_v4','PCI DSS v4.0','Global',12),
  ('iso_27001','ISO/IEC 27001:2022','Global',36),
  ('nesa_uae_ia','UAE IA (NESA)','AE',12),
  ('gdpr','GDPR (EU data subjects)','EU',12),
  ('nist_csf_2','NIST CSF 2.0','Global',NULL);

INSERT INTO schema_migrations(version) VALUES ('dwan_consolidated_v3');
-- ============================================================================
-- END
-- ============================================================================
