-- ============================================================================
-- ECC Phase 2 — Vendor-neutral Connector + Canonical Security Signal Framework
-- Extends Phase 1 foundation. Does not destroy existing data.
-- ============================================================================

-- NOTE: Enum ADD VALUE statements run outside an explicit transaction wrapper
-- (apply script uses autocommit) so new values are usable immediately.

-- ----------------------------------------------------------------------------
-- ENUM extensions
-- ----------------------------------------------------------------------------
ALTER TYPE domain_code ADD VALUE IF NOT EXISTS 'unmapped';
ALTER TYPE severity_level ADD VALUE IF NOT EXISTS 'info';

-- New enum for canonical signal lifecycle (separate from raw_events.processing_status)
DO $$ BEGIN
  CREATE TYPE signal_lifecycle AS ENUM (
    'received',
    'parsed',
    'validated',
    'normalized',
    'resolved',
    'deduplicated',
    'ready_for_correlation',
    'rejected',
    'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend raw processing_status with Phase 2 names (keep legacy values)
ALTER TYPE processing_status ADD VALUE IF NOT EXISTS 'parsed';
ALTER TYPE processing_status ADD VALUE IF NOT EXISTS 'resolved';
ALTER TYPE processing_status ADD VALUE IF NOT EXISTS 'deduplicated';
ALTER TYPE processing_status ADD VALUE IF NOT EXISTS 'ready_for_correlation';
ALTER TYPE processing_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE processing_status ADD VALUE IF NOT EXISTS 'error';

-- >>> ENUMS_COMMIT_POINT <<<
-- (apply_migrations.py commits here so new enum values are usable below)

-- ----------------------------------------------------------------------------
-- EVENT TAXONOMY (vendor-neutral V1 catalog)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signal_event_types (
  event_type_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(80) NOT NULL UNIQUE,
  display_name    VARCHAR(160) NOT NULL,
  domain_code     domain_code,          -- NULL = cross-domain / shared
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signal_source_types (
  source_type_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(40) NOT NULL UNIQUE,
  display_name    VARCHAR(120) NOT NULL,
  domain_code     domain_code,          -- preferred domain mapping hint
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true
);

-- Seed source types aligned to ECC domains
INSERT INTO signal_source_types (code, display_name, domain_code) VALUES
  ('soc', 'SOC / MDR', 'soc_mdr'),
  ('iam', 'IAM / PAM', 'iam_pam'),
  ('cloud', 'Cloud', 'cspm_cnapp'),
  ('ransomware', 'Ransomware Readiness', 'ransomware_readiness'),
  ('vapt', 'VAPT', 'vapt_asm'),
  ('asm', 'Attack Surface', 'vapt_asm'),
  ('phishing', 'Phishing / BEC', 'phishing_bec'),
  ('compliance', 'Compliance', 'compliance_engine'),
  ('pci', 'PCI DSS', 'pci_dss'),
  ('ot', 'OT / ICS', 'ot_ics'),
  ('ai', 'AI Governance', 'ai_governance'),
  ('third_party', 'Third-Party Risk', 'third_party_risk'),
  ('vciso', 'vCISO / Cyber CoE', 'vciso'),
  ('unknown', 'Unknown / Unmapped', 'unmapped')
ON CONFLICT (code) DO NOTHING;

-- Seed manageable V1 event taxonomy
INSERT INTO signal_event_types (code, display_name, domain_code) VALUES
  -- SOC/MDR
  ('authentication_failure', 'Authentication Failure', 'soc_mdr'),
  ('malware_detection', 'Malware Detection', 'soc_mdr'),
  ('suspicious_process', 'Suspicious Process', 'soc_mdr'),
  ('lateral_movement', 'Lateral Movement', 'soc_mdr'),
  ('command_execution', 'Command Execution', 'soc_mdr'),
  -- IAM/PAM
  ('privilege_change', 'Privilege Change', 'iam_pam'),
  ('privileged_login', 'Privileged Login', 'iam_pam'),
  ('authentication_anomaly', 'Authentication Anomaly', 'iam_pam'),
  ('access_policy_violation', 'Access Policy Violation', 'iam_pam'),
  ('privilege_escalation', 'Privilege Escalation', 'iam_pam'),
  -- Cloud
  ('public_exposure', 'Public Exposure', 'cspm_cnapp'),
  ('security_control_change', 'Security Control Change', 'cspm_cnapp'),
  ('suspicious_cloud_activity', 'Suspicious Cloud Activity', 'cspm_cnapp'),
  ('misconfiguration', 'Misconfiguration', 'cspm_cnapp'),
  ('cloud_exposure', 'Cloud Exposure', 'cspm_cnapp'),
  ('configuration_change', 'Configuration Change', 'cspm_cnapp'),
  -- Ransomware
  ('ransomware_indicator', 'Ransomware Indicator', 'ransomware_readiness'),
  ('backup_control_failure', 'Backup Control Failure', 'ransomware_readiness'),
  ('encryption_activity', 'Encryption Activity', 'ransomware_readiness'),
  -- VAPT/ASM
  ('vulnerability_detected', 'Vulnerability Detected', 'vapt_asm'),
  ('exposed_service', 'Exposed Service', 'vapt_asm'),
  ('attack_surface_change', 'Attack Surface Change', 'vapt_asm'),
  -- Phishing
  ('phishing_detected', 'Phishing Detected', 'phishing_bec'),
  ('malicious_attachment', 'Malicious Attachment', 'phishing_bec'),
  ('credential_harvest', 'Credential Harvest', 'phishing_bec'),
  ('business_email_anomaly', 'Business Email Anomaly', 'phishing_bec'),
  -- Compliance
  ('control_failure', 'Control Failure', 'compliance_engine'),
  ('evidence_expired', 'Evidence Expired', 'compliance_engine'),
  ('policy_violation', 'Policy Violation', 'compliance_engine'),
  -- PCI
  ('pci_control_failure', 'PCI Control Failure', 'pci_dss'),
  ('cardholder_data_exposure', 'Cardholder Data Exposure', 'pci_dss'),
  -- OT
  ('industrial_anomaly', 'Industrial Anomaly', 'ot_ics'),
  ('unsafe_configuration', 'Unsafe Configuration', 'ot_ics'),
  ('ot_asset_exposure', 'OT Asset Exposure', 'ot_ics'),
  -- AI
  ('ai_policy_violation', 'AI Policy Violation', 'ai_governance'),
  ('model_security_event', 'Model Security Event', 'ai_governance'),
  ('sensitive_ai_data_access', 'Sensitive AI Data Access', 'ai_governance'),
  -- Third party
  ('third_party_control_failure', 'Third-Party Control Failure', 'third_party_risk'),
  ('supplier_risk_change', 'Supplier Risk Change', 'third_party_risk'),
  ('vendor_security_event', 'Vendor Security Event', 'third_party_risk'),
  -- vCISO
  ('risk_assessment_update', 'Risk Assessment Update', 'vciso'),
  ('security_posture_change', 'Security Posture Change', 'vciso'),
  ('advisory_finding', 'Advisory Finding', 'vciso'),
  -- shared
  ('data_access', 'Data Access', NULL),
  ('unknown_event', 'Unknown Event Type', 'unmapped')
ON CONFLICT (code) DO NOTHING;

-- Controlled unmapped domain row
INSERT INTO risk_domains (code, display_name, short_label, yvi_solution, description)
VALUES (
  'unmapped',
  'Unmapped / Unknown Source',
  'Unmapped',
  NULL,
  'Holding domain for signals that could not be mapped to a subscribed ECC domain'
)
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- CONNECTORS — Phase 2 columns (preserve existing)
-- ----------------------------------------------------------------------------
ALTER TABLE connectors
  ADD COLUMN IF NOT EXISTS polling_interval_seconds INT,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credentials_reference VARCHAR(250),
  ADD COLUMN IF NOT EXISTS adapter_key VARCHAR(80) NOT NULL DEFAULT 'generic';

-- Backfill credentials_reference from secret_ref when empty
UPDATE connectors
SET credentials_reference = COALESCE(credentials_reference, secret_ref)
WHERE credentials_reference IS NULL AND secret_ref IS NOT NULL;

COMMENT ON COLUMN connectors.secret_ref IS 'Legacy alias; prefer credentials_reference. Never store raw secrets.';
COMMENT ON COLUMN connectors.credentials_reference IS 'Reference to secret manager entry — never raw credentials.';
COMMENT ON COLUMN connectors.config_nonsecret IS 'Non-secret connector configuration JSON only.';
COMMENT ON COLUMN connectors.adapter_key IS 'Adapter registry key, e.g. generic_security_events. Vendor-neutral.';

-- ----------------------------------------------------------------------------
-- CONNECTOR SYNC RUNS — quality metrics
-- ----------------------------------------------------------------------------
ALTER TABLE connector_sync_runs
  ADD COLUMN IF NOT EXISTS events_received INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS events_accepted INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS events_rejected INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS events_deduplicated INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unresolved_assets INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unresolved_identities INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unresolved_findings INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missing_timestamps INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missing_severity INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unknown_event_types INT NOT NULL DEFAULT 0;

-- Backfill from legacy counters when new columns are zero and legacy has data
UPDATE connector_sync_runs
SET events_received = GREATEST(events_received, records_received),
    events_accepted = GREATEST(events_accepted, records_processed),
    events_rejected = GREATEST(events_rejected, records_failed);

-- ----------------------------------------------------------------------------
-- RAW EVENTS — Phase 2 extensions (immutable payload preserved)
-- ----------------------------------------------------------------------------
ALTER TABLE raw_events
  ADD COLUMN IF NOT EXISTS content_type VARCHAR(80) NOT NULL DEFAULT 'application/json',
  ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(512);

UPDATE raw_events
SET observed_at = COALESCE(observed_at, source_timestamp)
WHERE observed_at IS NULL;

-- external_event_id is the conceptual name; source_event_id remains the column
COMMENT ON COLUMN raw_events.source_event_id IS 'External/source event ID for idempotency (connector-scoped).';
COMMENT ON COLUMN raw_events.payload IS 'Immutable original source payload. Never mutate during normalization.';
COMMENT ON COLUMN raw_events.idempotency_key IS 'Deterministic key: external id OR hash+observed_at fallback.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_events_idempotency
  ON raw_events (org_id, connector_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- SECURITY SIGNALS — Canonical Security Signal v1 columns
-- ----------------------------------------------------------------------------
ALTER TABLE security_signals
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS source_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS vendor_severity VARCHAR(80),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finding_id UUID,
  ADD COLUMN IF NOT EXISTS business_unit_id UUID,
  ADD COLUMN IF NOT EXISTS business_process_id UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_status signal_lifecycle NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(128),
  ADD COLUMN IF NOT EXISTS evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS security_identity_ref VARCHAR(250),
  ADD COLUMN IF NOT EXISTS unresolved_identifiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sync_run_id UUID,
  ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of_signal_id UUID;

-- Allow domain to point at unmapped; keep NOT NULL after ensuring default domain exists
-- Finding tenant-safe FK
DO $$ BEGIN
  ALTER TABLE security_signals
    ADD CONSTRAINT fk_signals_finding
    FOREIGN KEY (finding_id) REFERENCES risk_findings(finding_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE security_signals
    ADD CONSTRAINT fk_signals_bu
    FOREIGN KEY (org_id, business_unit_id)
    REFERENCES business_units(org_id, business_unit_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE security_signals
    ADD CONSTRAINT fk_signals_bp
    FOREIGN KEY (org_id, business_process_id)
    REFERENCES business_processes(org_id, business_process_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE security_signals
    ADD CONSTRAINT fk_signals_duplicate_of
    FOREIGN KEY (org_id, duplicate_of_signal_id)
    REFERENCES security_signals(org_id, signal_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_signals_org_fingerprint
  ON security_signals (org_id, fingerprint)
  WHERE fingerprint IS NOT NULL AND is_duplicate = false;

CREATE INDEX IF NOT EXISTS ix_signals_org_lifecycle
  ON security_signals (org_id, lifecycle_status, observed_at DESC);

CREATE INDEX IF NOT EXISTS ix_signals_org_source
  ON security_signals (org_id, source_type);

CREATE INDEX IF NOT EXISTS ix_signals_fingerprint
  ON security_signals (org_id, fingerprint);

-- Lifecycle transition audit (traceability)
CREATE TABLE IF NOT EXISTS signal_lifecycle_events (
  event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  signal_id     UUID NOT NULL,
  from_status   signal_lifecycle,
  to_status     signal_lifecycle NOT NULL,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, signal_id) REFERENCES security_signals(org_id, signal_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_signal_lifecycle_signal
  ON signal_lifecycle_events (org_id, signal_id, created_at);

-- Unresolved identifier holding (entity resolution did not match)
CREATE TABLE IF NOT EXISTS unresolved_signal_identifiers (
  unresolved_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  signal_id     UUID NOT NULL,
  id_type       VARCHAR(64) NOT NULL,
  id_value      VARCHAR(500) NOT NULL,
  normalized_value VARCHAR(500) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, signal_id) REFERENCES security_signals(org_id, signal_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_unresolved_ids_org
  ON unresolved_signal_identifiers (org_id, id_type, normalized_value);

-- RLS for new tables
ALTER TABLE signal_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_lifecycle_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_signal_lifecycle_events ON signal_lifecycle_events;
CREATE POLICY tenant_isolation_signal_lifecycle_events ON signal_lifecycle_events
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

ALTER TABLE unresolved_signal_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE unresolved_signal_identifiers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_unresolved_signal_identifiers ON unresolved_signal_identifiers;
CREATE POLICY tenant_isolation_unresolved_signal_identifiers ON unresolved_signal_identifiers
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

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
  '002_ecc_connector_signal_framework',
  'Phase 2: vendor-neutral connectors, canonical security signal v1, taxonomy, lifecycle, resolution, dedupe foundation'
)
ON CONFLICT (version) DO NOTHING;
