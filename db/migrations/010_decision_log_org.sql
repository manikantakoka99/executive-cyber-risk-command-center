-- Scope decision_action_log by org_id, matching dwan_schema.sql and the
-- other org-owned tables. Import rows that omit org_id take it from the
-- parent decision. Compliance and score tables already have org_id.

ALTER TABLE decision_action_log
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(org_id) ON DELETE CASCADE;

UPDATE decision_action_log l
SET org_id = d.org_id
FROM executive_decisions d
WHERE l.decision_id = d.decision_id
  AND l.org_id IS NULL;

CREATE OR REPLACE FUNCTION set_decision_log_org() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT d.org_id INTO NEW.org_id
    FROM executive_decisions d
    WHERE d.decision_id = NEW.decision_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_decision_log_org ON decision_action_log;
CREATE TRIGGER trg_decision_log_org
  BEFORE INSERT ON decision_action_log
  FOR EACH ROW EXECUTE FUNCTION set_decision_log_org();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM decision_action_log WHERE org_id IS NULL) THEN
    ALTER TABLE decision_action_log ALTER COLUMN org_id SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_decision_action_log_org ON decision_action_log(org_id);

ALTER TABLE decision_action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_action_log FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY tenant_isolation_decision_log ON decision_action_log
    USING (org_id = current_setting('app.current_org_id', true)::UUID);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO schema_migrations (version, description) VALUES
  (
    '010_decision_log_org',
    'decision_action_log.org_id so decision history is org-scoped'
  )
ON CONFLICT (version) DO NOTHING;
