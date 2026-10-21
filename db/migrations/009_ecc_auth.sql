-- Session authentication and per-organization membership.
-- The tenant column is org_id, the same identifier used by organizations,
-- org_compliance_status, and the score tables. There is no parallel tenant id.
--
-- Already org-scoped (do not rename):
--   org_compliance_status, compliance_assessments,
--   domain_risk_snapshots, enterprise_risk_score_snapshots
-- Global catalogs stay shared: compliance_frameworks, framework_controls, risk_domains.
--
-- auth_* tables are not under RLS. The session row is read before
-- app.current_org_id is set. Every later query filters on org_id.

CREATE TABLE IF NOT EXISTS auth_accounts (
  account_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(200) NOT NULL,
  password_hash TEXT NOT NULL,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_auth_password_hash CHECK (password_hash ~ '^[$]2[aby][$]')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_accounts_email ON auth_accounts (lower(email));

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  CHAR(64) NOT NULL UNIQUE,
  account_id  UUID NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_auth_sessions_account ON auth_sessions(account_id);
CREATE INDEX IF NOT EXISTS ix_auth_sessions_org ON auth_sessions(org_id);

CREATE TABLE IF NOT EXISTS org_memberships (
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
CREATE INDEX IF NOT EXISTS ix_org_memberships_org ON org_memberships(org_id);
CREATE INDEX IF NOT EXISTS ix_org_memberships_user ON org_memberships(user_id);

CREATE TABLE IF NOT EXISTS org_invites (
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
CREATE INDEX IF NOT EXISTS ix_org_invites_org ON org_invites(org_id);

INSERT INTO schema_migrations (version, description) VALUES
  (
    '009_ecc_auth',
    'Session auth, per-org memberships, and invite-only signup'
  )
ON CONFLICT (version) DO NOTHING;
