-- NIST CSF 2.0 for databases created before it was added to db/schema.sql.
-- Matches the catalog row in db/schema.sql and db/dwan_schema.sql (label NIST CSF 2.0).
-- ADD VALUE must commit before the new code can be inserted. Both steps are idempotent.

ALTER TYPE framework_code ADD VALUE IF NOT EXISTS 'nist_csf_2';

-- >>> ENUMS_COMMIT_POINT <<<

INSERT INTO compliance_frameworks (code, display_name, renewal_cycle_months)
VALUES ('nist_csf_2', 'NIST CSF 2.0', NULL)
ON CONFLICT (code) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      renewal_cycle_months = EXCLUDED.renewal_cycle_months;

INSERT INTO schema_migrations (version, description) VALUES
  (
    '013_nist_csf_2',
    'Add NIST CSF 2.0 framework code and catalog row'
  )
ON CONFLICT (version) DO UPDATE SET description = EXCLUDED.description;
