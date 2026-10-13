-- Command-center roles used by the executive dashboard demo.
-- Enforcement lives in server/src/command/rbac.ts. These rows keep the
-- directory consistent for seeded personas.

INSERT INTO roles (code, display_name, description) VALUES
  ('soc_analyst', 'SOC Analyst', 'Security operations analyst'),
  ('org_admin', 'Admin', 'Organization administrator')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, display_name) VALUES
  ('ecc.command.headline', 'Board headline'),
  ('ecc.command.technical', 'Technical command evidence'),
  ('ecc.command.act', 'Act on the command queue'),
  ('ecc.command.loss', 'Financial exposure'),
  ('ecc.admin.users', 'Manage users and roles')
ON CONFLICT (code) DO NOTHING;
