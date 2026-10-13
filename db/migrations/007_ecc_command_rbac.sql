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

INSERT INTO schema_migrations (version, description) VALUES
  (
    '007_ecc_command_rbac',
    'Command-center demo roles (soc_analyst, org_admin) and command permission codes'
  )
ON CONFLICT (version) DO NOTHING;
