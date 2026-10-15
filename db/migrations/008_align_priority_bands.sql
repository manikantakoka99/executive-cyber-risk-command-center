-- Align stored risk-policy priority bands and scenario priority tiers with
-- server/src/risk/bands.ts: Critical ≥70, High 55–69, Medium 35–54, Low <35.
-- Older seeds used critical:80 / high:60 and wrote boosted tiers to risk_scenarios.

UPDATE risk_policies
SET config = jsonb_set(
      jsonb_set(
        jsonb_set(COALESCE(config, '{}'::jsonb), '{priority_bands,critical}', '70'::jsonb, true),
        '{priority_bands,high}', '55'::jsonb, true
      ),
      '{priority_bands,medium}', '35'::jsonb, true
    )
WHERE config IS NULL
   OR config->'priority_bands' IS NULL
   OR (config->'priority_bands'->>'critical')::numeric IS DISTINCT FROM 70
   OR (config->'priority_bands'->>'high')::numeric IS DISTINCT FROM 55
   OR (config->'priority_bands'->>'medium')::numeric IS DISTINCT FROM 35;

-- Ensure a platform default exists with the shared cutoffs (dev DBs may have an empty table).
INSERT INTO risk_policies (org_id, code, version, display_name, is_active, effective_from, config)
SELECT NULL, 'ecc_default', '1.2.0', 'ECC Default Risk Policy (shared bands)', true, now(),
  jsonb_build_object(
    'priority_bands', jsonb_build_object('critical', 70, 'high', 55, 'medium', 35),
    'tolerance', jsonb_build_object('default_max_residual', 50, 'near_band', 10)
  )
WHERE NOT EXISTS (
  SELECT 1 FROM risk_policies WHERE org_id IS NULL AND code = 'ecc_default' AND is_active
);

-- Recompute scenario priority from current residual (ignore stored / boosted tier).
UPDATE risk_scenarios s
SET priority = CASE
      WHEN ra.residual_risk IS NULL THEN 'low'::priority_tier
      WHEN ra.residual_risk >= 70 THEN 'critical'::priority_tier
      WHEN ra.residual_risk >= 55 THEN 'high'::priority_tier
      WHEN ra.residual_risk >= 35 THEN 'medium'::priority_tier
      ELSE 'low'::priority_tier
    END,
    updated_at = now()
FROM risk_assessments ra
WHERE ra.risk_assessment_id = s.current_assessment_id
  AND ra.org_id = s.org_id
  AND (
    s.priority IS DISTINCT FROM CASE
      WHEN ra.residual_risk IS NULL THEN 'low'::priority_tier
      WHEN ra.residual_risk >= 70 THEN 'critical'::priority_tier
      WHEN ra.residual_risk >= 55 THEN 'high'::priority_tier
      WHEN ra.residual_risk >= 35 THEN 'medium'::priority_tier
      ELSE 'low'::priority_tier
    END
  );

-- Keep assessment priority_tier column consistent with residual_risk.
UPDATE risk_assessments
SET priority_tier = CASE
      WHEN residual_risk IS NULL THEN 'low'::priority_tier
      WHEN residual_risk >= 70 THEN 'critical'::priority_tier
      WHEN residual_risk >= 55 THEN 'high'::priority_tier
      WHEN residual_risk >= 35 THEN 'medium'::priority_tier
      ELSE 'low'::priority_tier
    END
WHERE priority_tier IS DISTINCT FROM CASE
      WHEN residual_risk IS NULL THEN 'low'::priority_tier
      WHEN residual_risk >= 70 THEN 'critical'::priority_tier
      WHEN residual_risk >= 55 THEN 'high'::priority_tier
      WHEN residual_risk >= 35 THEN 'medium'::priority_tier
      ELSE 'low'::priority_tier
    END;
