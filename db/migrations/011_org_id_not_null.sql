-- Copy the platform-default risk policies (ecc_default 1.0.0 and 1.1.0) onto
-- every organization as new rows. The original NULL rows stay unowned and are
-- deleted after the copy, so they are not attached to one organization.
-- New organizations, and invites into an organization that has none, call
-- seed_org_default_risk_policies. Then org_id is NOT NULL on every
-- tenant-scoped base table. A remaining NULL fails with the table name and count.
-- DWAN audit_log is a different schema (rows outlive tenants) and is not here.

CREATE OR REPLACE FUNCTION seed_org_default_risk_policies(p_org uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  ver text;
  dest uuid;
  src risk_policies%ROWTYPE;
BEGIN
  IF p_org IS NULL THEN
    RETURN;
  END IF;

  FOREACH ver IN ARRAY ARRAY['1.0.0', '1.1.0'] LOOP
    SELECT policy_id INTO dest
    FROM risk_policies
    WHERE org_id = p_org AND code = 'ecc_default' AND version = ver
    LIMIT 1;

    IF dest IS NULL THEN
      SELECT * INTO src
      FROM risk_policies
      WHERE code = 'ecc_default' AND version = ver AND org_id IS DISTINCT FROM p_org
      ORDER BY (org_id IS NULL) DESC, created_at
      LIMIT 1;

      IF FOUND THEN
        INSERT INTO risk_policies (
          org_id, code, version, display_name, is_active,
          effective_from, effective_to, config, created_at
        ) VALUES (
          p_org, src.code, src.version, src.display_name, src.is_active,
          src.effective_from, src.effective_to, src.config, src.created_at
        )
        RETURNING policy_id INTO dest;

        INSERT INTO risk_policy_factors (policy_id, factor_category, factor_code, weight, enabled)
        SELECT dest, factor_category, factor_code, weight, enabled
        FROM risk_policy_factors
        WHERE policy_id = src.policy_id;
      ELSIF ver = '1.0.0' THEN
        INSERT INTO risk_policies (
          org_id, code, version, display_name, is_active, effective_from, config
        ) VALUES (
          p_org, 'ecc_default', '1.0.0', 'ECC Default Risk Policy', false, now(),
          '{"note":"weights not yet approved — Phase 1 foundation only"}'::jsonb
        )
        RETURNING policy_id INTO dest;
      ELSE
        INSERT INTO risk_policies (
          org_id, code, version, display_name, is_active, effective_from, config
        ) VALUES (
          p_org, 'ecc_default', '1.1.0', 'ECC Default Risk Policy (dev)', true, now(),
          '{
            "note": "Development defaults — product must approve production weights",
            "temporal_window_hours": 72,
            "min_signals_for_scenario": 2,
            "min_severity_for_single_signal": "critical",
            "likelihood_weights": {
              "threat_activity": 0.30,
              "exposure_reachability": 0.25,
              "exploitability": 0.20,
              "control_weakness": 0.15,
              "attack_evidence": 0.10
            },
            "impact_weights": {
              "financial": 0.30,
              "operational": 0.20,
              "business_criticality": 0.25,
              "regulatory_compliance": 0.15,
              "data_impact": 0.10
            },
            "control_reduction": {
              "effective": 0.45,
              "partially_effective": 0.20,
              "ineffective": 0.0,
              "unknown": 0.05
            },
            "tolerance": { "default_max_residual": 50, "near_band": 10 },
            "priority_bands": { "critical": 70, "high": 55, "medium": 35 }
          }'::jsonb
        )
        RETURNING policy_id INTO dest;

        INSERT INTO risk_policy_factors (policy_id, factor_category, factor_code, weight, enabled)
        SELECT dest, 'likelihood', f.key, (f.value)::numeric, true
        FROM risk_policies p, LATERAL jsonb_each_text(p.config->'likelihood_weights') AS f(key, value)
        WHERE p.policy_id = dest
        ON CONFLICT (policy_id, factor_category, factor_code) DO NOTHING;

        INSERT INTO risk_policy_factors (policy_id, factor_category, factor_code, weight, enabled)
        SELECT dest, 'impact', f.key, (f.value)::numeric, true
        FROM risk_policies p, LATERAL jsonb_each_text(p.config->'impact_weights') AS f(key, value)
        WHERE p.policy_id = dest
        ON CONFLICT (policy_id, factor_category, factor_code) DO NOTHING;
      END IF;
    END IF;

    UPDATE risk_tolerance_rules t
    SET policy_id = dest
    FROM risk_policies platform
    WHERE platform.org_id IS NULL
      AND platform.code = 'ecc_default'
      AND platform.version = ver
      AND t.org_id = p_org
      AND t.policy_id = platform.policy_id
      AND t.policy_id IS DISTINCT FROM dest;

    UPDATE org_settings s
    SET active_risk_policy_id = dest
    FROM risk_policies platform
    WHERE platform.org_id IS NULL
      AND platform.code = 'ecc_default'
      AND platform.version = ver
      AND s.org_id = p_org
      AND s.active_risk_policy_id = platform.policy_id
      AND s.active_risk_policy_id IS DISTINCT FROM dest;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION trg_seed_org_default_risk_policies() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_org_default_risk_policies(NEW.org_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_organizations_seed_risk_policies ON organizations;
CREATE TRIGGER trg_organizations_seed_risk_policies
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION trg_seed_org_default_risk_policies();

SELECT seed_org_default_risk_policies(org_id) FROM organizations;

DELETE FROM risk_policies WHERE org_id IS NULL;

DO $$
DECLARE
  rec record;
  nulls bigint;
BEGIN
  FOR rec IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'org_id'
      AND c.is_nullable = 'YES'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'organizations'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE org_id IS NULL', rec.table_name) INTO nulls;
    IF nulls > 0 THEN
      RAISE EXCEPTION 'org_id still NULL on % (% rows)', rec.table_name, nulls;
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET NOT NULL', rec.table_name);
  END LOOP;
END $$;

INSERT INTO schema_migrations (version, description) VALUES
  (
    '011_org_id_not_null',
    'Copy default risk policies onto every org and require org_id'
  )
ON CONFLICT (version) DO UPDATE SET description = EXCLUDED.description;
