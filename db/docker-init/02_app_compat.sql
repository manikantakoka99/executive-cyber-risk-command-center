-- Compatibility layer so the ECC Node API can query a DWAN-initialized database.
-- DWAN stores role on users.role; the cyber_command_center app historically used
-- roles / user_roles / v_user_primary_role.

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
  ('risk_manager', 'Risk Manager', 'Alias for risk lead in app RBAC'),
  ('domain_analyst', 'Domain Analyst', 'Domain evidence analyst'),
  ('security_analyst', 'Security Analyst', 'App alias for domain analyst'),
  ('soc_analyst', 'SOC Analyst', 'Security operations analyst'),
  ('program_office', 'Program Office', 'PMO / compliance program'),
  ('compliance_manager', 'Compliance Manager', 'App alias for program office'),
  ('auditor', 'Auditor', 'Read-only auditor'),
  ('admin', 'Admin', 'Organization administrator'),
  ('org_admin', 'Org Admin', 'App alias for admin')
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

-- Map DWAN enum roles into user_roles for directory queries.
INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
SELECT u.user_id, r.role_id, u.org_id, true
FROM users u
JOIN roles r ON r.code = CASE u.role::text
  WHEN 'admin' THEN 'org_admin'
  WHEN 'risk_lead' THEN 'risk_manager'
  WHEN 'program_office' THEN 'compliance_manager'
  WHEN 'domain_analyst' THEN 'security_analyst'
  ELSE u.role::text
END
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.user_id AND ur.is_primary
)
ON CONFLICT DO NOTHING;
