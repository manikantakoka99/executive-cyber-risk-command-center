# ECC Organization Configuration (Phase 5)

No hardcoded client hierarchy.

## `org_settings`

- default risk appetite
- active risk policy id
- reporting default window
- executive thresholds (JSON)
- display labels / terminology
- enabled framework codes

Seeded per organization on migration.

## Domain enablement

`org_domain_subscriptions` — 12-domain baseline remains; orgs enable/disable via subscriptions. Exposed in `GET /api/ecc/org/settings`.

## Business context

Configurable `business_units` / `business_processes` per org — views via:

`GET /api/ecc/business-units/:id`  
`GET /api/ecc/business-processes/:id`

## Connectors

Vendor-neutral catalog: `GET /api/ecc/connectors/catalog` — status, last sync, health, stale warnings. No vendor-specific adapters in Phase 5.
