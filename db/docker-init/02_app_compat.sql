-- Compatibility layer so the ECC Node API can query a DWAN-initialized database.
-- Roles match the schema's 8 user_role_name values exactly.

CREATE TABLE IF NOT EXISTS roles (
  role_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  description   TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  org_id     UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS permissions (
  permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  description TEXT,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO roles (code, display_name, description) VALUES
  ('board_member', 'Board Member', 'Board oversight'),
  ('cxo', 'CxO', 'Executive decision maker'),
  ('ciso', 'CISO', 'Chief information security officer'),
  ('risk_lead', 'Risk Lead', 'Risk acceptance and register'),
  ('domain_analyst', 'Domain Analyst', 'Domain evidence analyst'),
  ('program_office', 'Program Office', 'PMO / compliance program'),
  ('auditor', 'Auditor', 'Read-only auditor'),
  ('admin', 'Admin', 'Organization administrator')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE VIEW v_user_primary_role AS
SELECT
  u.user_id,
  u.org_id,
  COALESCE(r.code, u.role::text) AS role_code
FROM users u
LEFT JOIN LATERAL (
  SELECT roles.code
  FROM user_roles ur
  JOIN roles ON roles.role_id = ur.role_id
  WHERE ur.user_id = u.user_id AND ur.is_primary
  ORDER BY roles.code
  LIMIT 1
) r ON true;

-- Map DWAN enum roles into user_roles (schema codes only).
INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
SELECT u.user_id, r.role_id, u.org_id, true
FROM users u
JOIN roles r ON r.code = u.role::text
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.user_id AND ur.is_primary
)
ON CONFLICT DO NOTHING;
