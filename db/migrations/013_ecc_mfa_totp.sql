-- Google Authenticator TOTP Multi-Factor Authentication (RFC 6238)
--
-- Adds encrypted TOTP secret storage, replay attack guard, recovery code hashes
-- to auth_accounts, and creates the auth_mfa_challenges table for two-step sign-in.
-- Default mfa_enabled is FALSE so all existing accounts and seed flows stay compatible.

ALTER TABLE auth_accounts
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS totp_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS totp_secret_iv TEXT,
  ADD COLUMN IF NOT EXISTS totp_secret_tag TEXT,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backup_codes_hashes TEXT[],
  ADD COLUMN IF NOT EXISTS last_totp_timestamp BIGINT;

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  challenge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_hash  CHAR(64) NOT NULL UNIQUE,
  account_id   UUID NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  attempts     INT NOT NULL DEFAULT 0,
  consumed_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_mfa_challenge_attempts CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS ix_mfa_challenges_ticket ON auth_mfa_challenges(ticket_hash);
CREATE INDEX IF NOT EXISTS ix_mfa_challenges_account ON auth_mfa_challenges(account_id);
CREATE INDEX IF NOT EXISTS ix_mfa_challenges_expires ON auth_mfa_challenges(expires_at);

INSERT INTO schema_migrations (version, description) VALUES
  (
    '013_ecc_mfa_totp',
    'Google Authenticator TOTP schema: encrypted secrets, replay guard, and ephemeral challenges'
  )
ON CONFLICT (version) DO NOTHING;
