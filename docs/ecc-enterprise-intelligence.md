# ECC Enterprise Intelligence (Phase 5)

## Portfolio aggregation

Aggregates **Risk Scenarios** only. **Does not average domain scores.**

Metrics: active scenarios, priority distribution, outside-tolerance, increasing/aging, accepted/mitigated/closed, known AED exposure (max-linked, never invented), unknown financial count, confidence bands, remediation backlog, overdue actions.

Filters: business unit/process, domain, asset criticality, priority, tolerance, status, period.

## Trends

Built from `risk_assessments` history. Windows: 7d / 30d / 90d / quarter / year.

If fewer than two daily buckets: **`Insufficient historical data`** — empty series, no fabricated points.

## Hotspots

Deterministic concentration with explicit denominators (e.g. share of high/critical scenarios).

## Material changes

Reason codes: `RESIDUAL_CROSSED_TOLERANCE`, `NEW_CRITICAL_SCENARIO`, `REMEDIATION_VERIFIED`, `MATERIAL_RISK_INCREASE`, `CONTROL_INEFFECTIVE`.

## Freshness

Connector catalog exposes health: configured / connected / degraded / failed / not_configured + stale warnings.

## APIs

`GET /api/ecc/portfolio|trends|hotspots|decision-center|compliance/posture|controls/posture|executive-briefing|material-changes|connectors/catalog|org/settings`
