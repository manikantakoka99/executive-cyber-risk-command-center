-- audit_log.org_id is NOT NULL. ON DELETE SET NULL cannot clear the column,
-- and deleting an organization must not delete the audit rows. Restrict the
-- organization delete instead. DWAN audit_log is a different table and is not here.

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_org_id_fkey;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES organizations(org_id) ON DELETE RESTRICT;

INSERT INTO schema_migrations (version, description) VALUES
  (
    '012_audit_log_org_restrict',
    'Keep audit rows when an organization would be deleted'
  )
ON CONFLICT (version) DO UPDATE SET description = EXCLUDED.description;
