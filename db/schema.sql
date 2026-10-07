-- ============================================================================
-- YVI DWAN CYBER COMMAND CENTER — DATABASE MODEL (PostgreSQL 14+)
-- ============================================================================
-- Scope: the executive aggregation layer sitting above YVI Tech's 12 domain
--        solutions (SOC/MDR, IAM/PAM, CSPM/CNAPP, Ransomware Readiness,
--        VAPT/ASM, Phishing/BEC, Compliance Engine, PCI DSS, OT/ICS,
--        AI Governance, Third-Party Risk, vCISO) — consolidating cyber,
--        compliance, vulnerabilities, incidents and business impact into
--        one view: Risk -> Impact -> Decision -> Action.
-- Tenancy: multi-tenant (the Command Center serves multiple client
--        enterprises), so every tenant-scoped table carries org_id and is
--        protected with Row-Level Security, matching the EduTrack pattern.
-- Conventions: UUID PKs via gen_random_uuid(); TIMESTAMPTZ throughout;
--        NUMERIC(14,2) for AED currency amounts; JSONB for flexible
--        domain-specific finding payloads.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 0. ENUM TYPES
-- ----------------------------------------------------------------------------
CREATE TYPE domain_code AS ENUM (
  'soc_mdr','iam_pam','cspm_cnapp','ransomware_readiness','vapt_asm',
  'phishing_bec','compliance_engine','pci_dss','ot_ics','ai_governance',
  'third_party_risk','vciso'
);
CREATE TYPE severity_level   AS ENUM ('low','medium','high','critical');
CREATE TYPE finding_status   AS ENUM ('open','acknowledged','in_remediation','resolved','accepted_risk');
CREATE TYPE decision_status  AS ENUM ('awaiting_decision','approved','info_requested','declined','closed');
CREATE TYPE decision_priority AS ENUM ('critical','high','medium','low');
CREATE TYPE user_role_name   AS ENUM ('cxo','board_member','program_office','domain_analyst','auditor');
CREATE TYPE framework_code   AS ENUM ('dubai_isr','pci_dss_v4','iso_27001','nesa_uae_ia','gdpr');
CREATE TYPE activity_type    AS ENUM ('finding_created','decision_escalated','decision_resolved',
                                       'report_generated','compliance_refresh','simulation_completed');

CREATE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. TENANCY & IDENTITY
-- ============================================================================
CREATE TABLE organizations (
  org_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(200) NOT NULL,        -- e.g. 'Al Dhabi Holdings'
  industry      VARCHAR(100),
  hq_country    VARCHAR(100) DEFAULT 'UAE',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100),
  email         VARCHAR(200) NOT NULL UNIQUE,
  role          user_role_name NOT NULL DEFAULT 'domain_analyst',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_users_org ON users(org_id);

-- ============================================================================
-- 2. RISK DOMAINS — the 12 YVI Tech solutions feeding the Command Center
-- ============================================================================
CREATE TABLE risk_domains (
  risk_domain_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            domain_code NOT NULL UNIQUE,
  display_name    VARCHAR(150) NOT NULL,       -- e.g. 'Digital Attack Surface Shield'
  short_label     VARCHAR(60) NOT NULL,        -- e.g. 'Attack Surface (VAPT/ASM)'
  yvi_solution    VARCHAR(150),                -- product name, e.g. 'YVI Digital Attack Surface Shield'
  description     TEXT
);

-- Per-org enablement — not every client subscribes to every domain solution
CREATE TABLE org_domain_subscriptions (
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  risk_domain_id  UUID NOT NULL REFERENCES risk_domains(risk_domain_id) ON DELETE CASCADE,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, risk_domain_id)
);

-- ============================================================================
-- 3. DOMAIN RISK SCORING — point-in-time snapshots powering "Risk by Domain"
-- ============================================================================
CREATE TABLE domain_risk_snapshots (
  snapshot_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  risk_domain_id  UUID NOT NULL REFERENCES risk_domains(risk_domain_id) ON DELETE CASCADE,
  score           NUMERIC(5,2) NOT NULL,        -- 0-100, higher = greater risk
  severity        severity_level NOT NULL,
  headline_detail VARCHAR(300),                 -- e.g. '2 internet-facing CVEs unpatched >30 days'
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_domain_snapshots_org_domain ON domain_risk_snapshots(org_id, risk_domain_id, snapshot_at DESC);

-- ============================================================================
-- 4. FINDINGS — the underlying signals rolled up into each domain score
-- ============================================================================
CREATE TABLE risk_findings (
  finding_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  risk_domain_id  UUID NOT NULL REFERENCES risk_domains(risk_domain_id) ON DELETE CASCADE,
  title           VARCHAR(250) NOT NULL,         -- e.g. 'Unpatched external CVEs on payment gateway'
  description     TEXT,
  severity        severity_level NOT NULL,
  status          finding_status NOT NULL DEFAULT 'open',
  affected_asset  VARCHAR(200),                  -- e.g. 'Customer-facing payment gateway'
  raw_payload     JSONB,                         -- domain-specific detail (CVE IDs, scan refs, etc.)
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_findings_updated BEFORE UPDATE ON risk_findings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_findings_org_status ON risk_findings(org_id, status);
CREATE INDEX ix_findings_domain ON risk_findings(risk_domain_id);

-- ============================================================================
-- 5. ENTERPRISE RISK SCORE — the single headline number ("62/100 Elevated")
-- ============================================================================
CREATE TABLE enterprise_risk_score_snapshots (
  snapshot_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  score           NUMERIC(5,2) NOT NULL,          -- 0-100
  severity        severity_level NOT NULL,
  driver_summary  VARCHAR(300),                   -- e.g. 'Driven by 2 unpatched external-facing findings'
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, snapshot_at)
);
CREATE INDEX ix_enterprise_score_org ON enterprise_risk_score_snapshots(org_id, snapshot_at DESC);

-- ============================================================================
-- 6. BUSINESS IMPACT — Risk -> Impact translation (financial exposure)
-- ============================================================================
CREATE TABLE business_impact_assessments (
  impact_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  finding_id      UUID REFERENCES risk_findings(finding_id) ON DELETE SET NULL,
  financial_exposure_aed NUMERIC(14,2),           -- e.g. 2100000.00
  downtime_cost_per_hour_aed NUMERIC(12,2),
  affected_business_unit VARCHAR(150),
  compliance_scope_impact VARCHAR(200),           -- e.g. 'PCI DSS scope'
  assessed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_impact_org ON business_impact_assessments(org_id);
CREATE INDEX ix_impact_finding ON business_impact_assessments(finding_id);

-- ============================================================================
-- 7. EXECUTIVE DECISIONS — Risk -> Impact -> Decision -> Action
-- ============================================================================
CREATE TABLE executive_decisions (
  decision_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  finding_id      UUID REFERENCES risk_findings(finding_id) ON DELETE SET NULL,
  impact_id       UUID REFERENCES business_impact_assessments(impact_id) ON DELETE SET NULL,
  title           VARCHAR(250) NOT NULL,
  priority        decision_priority NOT NULL,
  risk_summary    TEXT NOT NULL,                  -- the 'Risk:' chip text
  impact_summary  TEXT NOT NULL,                  -- the 'Impact:' chip text
  recommended_action TEXT NOT NULL,                -- the 'Recommended:' chip text
  status          decision_status NOT NULL DEFAULT 'awaiting_decision',
  escalated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  decision_notes  TEXT
);
CREATE INDEX ix_decisions_org_status ON executive_decisions(org_id, status);

-- Audit trail of every action taken on a decision (approve / request info / decline)
CREATE TABLE decision_action_log (
  action_log_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id     UUID NOT NULL REFERENCES executive_decisions(decision_id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES users(user_id) ON DELETE SET NULL,
  action          VARCHAR(50) NOT NULL,            -- 'approved' / 'info_requested' / 'declined' / 'closed'
  notes           TEXT,
  acted_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_decision_action_log_decision ON decision_action_log(decision_id);

-- ============================================================================
-- 8. COMPLIANCE — frameworks and posture tracking
-- ============================================================================
CREATE TABLE compliance_frameworks (
  framework_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            framework_code NOT NULL UNIQUE,
  display_name    VARCHAR(150) NOT NULL,          -- e.g. 'PCI DSS v4.0'
  renewal_cycle_months INT
);

CREATE TABLE org_compliance_status (
  status_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  framework_id    UUID NOT NULL REFERENCES compliance_frameworks(framework_id) ON DELETE CASCADE,
  coverage_pct    NUMERIC(5,2) NOT NULL,           -- e.g. 92.00
  controls_total  INT,
  controls_evidenced INT,
  next_renewal_date DATE,
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_compliance_status_org ON org_compliance_status(org_id, framework_id, snapshot_at DESC);

-- ============================================================================
-- 9. ACTIVITY FEED — "Recent Command Center Activity"
-- ============================================================================
CREATE TABLE command_center_activity (
  activity_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  risk_domain_id  UUID REFERENCES risk_domains(risk_domain_id) ON DELETE SET NULL,
  activity_type   activity_type NOT NULL,
  summary         VARCHAR(300) NOT NULL,           -- e.g. 'Q3 board risk briefing auto-compiled...'
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_activity_org_time ON command_center_activity(org_id, occurred_at DESC);

-- ============================================================================
-- 10. BOARD / REGULATOR REPORTING — generated briefings
-- ============================================================================
CREATE TABLE generated_reports (
  report_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  report_type     VARCHAR(50) NOT NULL,            -- 'board_briefing' / 'regulator_submission'
  period_start    DATE,
  period_end      DATE,
  file_url        TEXT,
  generated_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_reports_org ON generated_reports(org_id);

-- ============================================================================
-- 11. SYSTEM-WIDE AUDIT LOG
-- ============================================================================
CREATE TABLE audit_log (
  log_id      BIGSERIAL PRIMARY KEY,
  org_id      UUID REFERENCES organizations(org_id) ON DELETE SET NULL,
  user_id     UUID REFERENCES users(user_id) ON DELETE SET NULL,
  action      VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   UUID,
  old_value   JSONB,
  new_value   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_time ON audit_log(created_at DESC);

-- ============================================================================
-- 12. ROW-LEVEL SECURITY — multi-tenant isolation (org_id-scoped)
-- ============================================================================
DO $$ BEGIN
  CREATE ROLE ccc_app LOGIN PASSWORD 'change_me_in_production';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_users ON users
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

ALTER TABLE domain_risk_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_risk_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_domain_snapshots ON domain_risk_snapshots
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

ALTER TABLE risk_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_findings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_findings ON risk_findings
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

ALTER TABLE enterprise_risk_score_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_risk_score_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_enterprise_score ON enterprise_risk_score_snapshots
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

ALTER TABLE business_impact_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_impact_assessments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_impact ON business_impact_assessments
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

ALTER TABLE executive_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE executive_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_decisions ON executive_decisions
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

ALTER TABLE org_compliance_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_compliance_status FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_compliance ON org_compliance_status
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

ALTER TABLE command_center_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_center_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_activity ON command_center_activity
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_reports ON generated_reports
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ccc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ccc_app;

-- ============================================================================
-- 13. SEED DATA — the 12 domain solutions and 5 compliance frameworks
-- ============================================================================
INSERT INTO risk_domains (code, display_name, short_label, yvi_solution) VALUES
  ('soc_mdr','SOC & MDR','SOC / MDR','YVI Cyber Fusion SOC'),
  ('iam_pam','Identity & Privileged Access Management','IAM / PAM','YVI HealthSecure Fabric'),
  ('cspm_cnapp','Cloud Security Posture Management','Cloud (CSPM/CNAPP)','YVI CloudGuard AI'),
  ('ransomware_readiness','Ransomware Readiness & Resilience','Ransomware Readiness','YVI Cyber Recovery Assurance'),
  ('vapt_asm','Attack Surface & VAPT','Attack Surface (VAPT/ASM)','YVI Digital Attack Surface Shield'),
  ('phishing_bec','Phishing / BEC Defense','Phishing / BEC','YVI Human + AI Defense Layer'),
  ('compliance_engine','Continuous Compliance','Compliance Engine','YVI Continuous Compliance Engine'),
  ('pci_dss','PCI DSS & Data Security','PCI DSS / Data Trust','YVI DataTrust & PCI Shield'),
  ('ot_ics','OT / ICS Security','OT / ICS Security','YVI OT CyberGuard'),
  ('ai_governance','AI Security & GenAI Governance','AI Governance','YVI AI TrustGuard'),
  ('third_party_risk','Third-Party / Supply-Chain Risk','Third-Party Risk','YVI Third-Party Cyber Intelligence'),
  ('vciso','Managed vCISO & Cyber CoE','vCISO / Cyber CoE','YVI Cyber CoE-as-a-Service');

INSERT INTO compliance_frameworks (code, display_name, renewal_cycle_months) VALUES
  ('dubai_isr','Dubai ISR', 12),
  ('pci_dss_v4','PCI DSS v4.0', 12),
  ('iso_27001','ISO 27001', 36),
  ('nesa_uae_ia','NESA / UAE IA', 12),
  ('gdpr','GDPR (EU Data Subjects)', 12);

-- ============================================================================
-- END OF SCRIPT
-- ============================================================================


-- Docker local app user (superuser of this DB in compose) — bypasses RLS; API still filters by org_id.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecc') THEN
    GRANT ALL ON ALL TABLES IN SCHEMA public TO ecc;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ecc;
  END IF;
END $$;
