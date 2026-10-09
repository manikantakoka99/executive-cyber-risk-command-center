# ECC Connector Framework (Phase 2)

Vendor-neutral ingestion foundation. **No vendor-specific adapters** (Sentinel, Splunk, CrowdStrike, …) in this phase.

## Pipeline

```
External Security Source
        ↓
Connector Adapter (normalize contract)
        ↓
Raw Event (immutable payload)
        ↓
Parser / Validator
        ↓
Canonical Security Signal v1
        ↓
Entity Resolution (exact identifier match)
        ↓
Deduplication (fingerprint)
        ↓
ready_for_correlation   ← Phase 3+ consumes here
```

## Connector model

Table: `connectors`

- Belongs to `org_id` + `risk_domain_id`
- `adapter_key` selects registered adapter (e.g. `generic_security_events`)
- `credentials_reference` / `secret_ref` — **references only**, never raw secrets
- `config_nonsecret` — non-secret JSON configuration
- Sync telemetry: `last_sync_at`, `last_success_at`, `last_failure_at`

## Adapter contract

```ts
interface ConnectorAdapter {
  validateConfiguration(config)
  testConnection(ctx)
  fetch(ctx) → RawEventInput[]
  normalize(raw, ctx) → CanonicalSecuritySignalV1
  healthCheck(ctx)
}
```

Adapters **must not** create risk scores, scenarios, or executive decisions.

## Demo adapter

`generic_security_events` — synthetic events only, proves the pipeline:

1. Critical malware detection  
2. High privilege escalation  
3. Medium public cloud exposure  
4. Low authentication anomaly  

## Sync runs & quality metrics

`connector_sync_runs` records:

- events received / accepted / rejected / deduplicated  
- unresolved assets / identities  
- missing timestamps / severity  
- unknown event types  

## APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/ecc/connectors` | List |
| POST | `/api/ecc/connectors` | Create |
| GET | `/api/ecc/connectors/:id` | Detail |
| POST | `/api/ecc/connectors/:id/test` | Health |
| POST | `/api/ecc/connectors/:id/sync` | Fetch + ingest |
| GET | `/api/ecc/connectors/:id/runs` | Sync history |
| POST | `/api/ecc/ingestion/raw-events` | Manual push |
| GET | `/api/ecc/signals` | List signals |
| GET | `/api/ecc/signals/:id` | Detail + lineage |

All routes use existing tenant middleware (`X-Org-Id`, `X-User-Id`).

## Migration

```bash
.venv-ecc/bin/python db/apply_migrations.py
# or
.venv-ecc/bin/python db/apply_migration_v2.py
```

Version: `002_ecc_connector_signal_framework`
