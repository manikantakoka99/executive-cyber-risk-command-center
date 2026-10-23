-- MFA Pending Enrollment Table
-- Stores unconfirmed TOTP secrets during two-step setup until the user verifies their first code.
-- Automatically cleaned up when confirmed or upon expiration (15-minute TTL).

CREATE TABLE IF NOT EXISTS auth_mfa_pending_enrollments (
  account_id       UUID PRIMARY KEY REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  secret_encrypted TEXT NOT NULL,
  secret_iv        TEXT NOT NULL,
  secret_tag       TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_mfa_pending_expires ON auth_mfa_pending_enrollments(expires_at);

INSERT INTO schema_migrations (version, description) VALUES
  (
    '014_ecc_mfa_enrollment',
    'Pending MFA enrollment table for atomic two-step secret confirmation'
  )
ON CONFLICT (version) DO NOTHING;
