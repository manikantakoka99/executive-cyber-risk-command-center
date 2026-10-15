-- Rewrite stored impact_summary AED chip text to compact display form
-- (AED x.xM / AED xxxK) from linked business_impact_assessments numbers.
-- Safe to re-run; only touches rows that still contain comma-grouped AED amounts
-- or that have numeric exposure/downtime to regenerate from.

UPDATE executive_decisions ed
SET impact_summary = trim(both ' ,' FROM concat_ws(
  ', ',
  CASE
    WHEN b.financial_exposure_aed IS NOT NULL AND b.financial_exposure_aed >= 1000000
      THEN 'AED ' || trim(to_char(round(b.financial_exposure_aed / 1000000.0, 1), 'FM999999990.0')) || 'M exposure'
    WHEN b.financial_exposure_aed IS NOT NULL AND b.financial_exposure_aed >= 1000
      THEN 'AED ' || trim(to_char(round(b.financial_exposure_aed / 1000.0), 'FM999999999')) || 'K exposure'
    WHEN b.financial_exposure_aed IS NOT NULL
      THEN 'AED ' || trim(to_char(round(b.financial_exposure_aed), 'FM999999999')) || ' exposure'
    ELSE NULL
  END,
  CASE
    WHEN b.downtime_cost_per_hour_aed IS NOT NULL AND b.downtime_cost_per_hour_aed >= 1000000
      THEN 'downtime ~AED ' || trim(to_char(round(b.downtime_cost_per_hour_aed / 1000000.0, 1), 'FM999999990.0')) || 'M/hr'
    WHEN b.downtime_cost_per_hour_aed IS NOT NULL AND b.downtime_cost_per_hour_aed >= 1000
      THEN 'downtime ~AED ' || trim(to_char(round(b.downtime_cost_per_hour_aed / 1000.0), 'FM999999999')) || 'K/hr'
    WHEN b.downtime_cost_per_hour_aed IS NOT NULL
      THEN 'downtime ~AED ' || trim(to_char(round(b.downtime_cost_per_hour_aed), 'FM999999999')) || '/hr'
    ELSE NULL
  END
))
FROM business_impact_assessments b
WHERE b.impact_id = ed.impact_id
  AND (
    b.financial_exposure_aed IS NOT NULL
    OR b.downtime_cost_per_hour_aed IS NOT NULL
  )
  AND (
    ed.impact_summary ~ 'AED[[:space:]]*[0-9]{1,3}(,[0-9]{3})+'
    OR ed.impact_summary !~ 'AED[[:space:]]*[0-9]+(\.[0-9]+)?[KkMm]\b'
  );
