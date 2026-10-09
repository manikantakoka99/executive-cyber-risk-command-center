# ECC Data Lineage — Ingestion Path

## End-to-end chain

```
External Source
    → Connector (config + credentials_reference)
    → Raw Event (immutable JSON payload + payload_hash)
    → Canonical Security Signal (normalized columns + vendor_extensions)
    → Entity Resolution (asset_identifiers → assets → BU/process)
    → Deduplication (fingerprint)
    → ready_for_correlation
    → (future) Risk Scenario → Assessment → Decision → Action → Verification
```

## Traceability guarantees

1. **Raw payload never mutated** after insert into `raw_events.payload`.
2. Every accepted signal stores `raw_event_id`.
3. `GET /api/ecc/signals/:id` returns the raw payload + hash for audit.
4. Lifecycle transitions append to `signal_lifecycle_events`.
5. Unresolved identifiers persist in `unresolved_signal_identifiers` (not discarded).

## Idempotency

| Case | Strategy |
|------|----------|
| Source provides event ID | Unique `(org_id, connector_id, source_event_id)` |
| No stable ID | `idempotency_key = hash(payload) + observed_at` |

Retries must not create duplicate raw rows or inflate downstream findings/decisions.

## Tenant isolation

- Connector, raw event, and signal always carry `org_id`
- Composite FKs / validation reject cross-tenant asset, finding, BU, process refs
- Application filters + RLS (Phase 1) remain in force

## Canonical vs vendor fields

| Layer | Stores |
|-------|--------|
| Canonical columns | ECC-normalized meaning |
| `vendor_extensions` / `vendor_severity` | Source-native fidelity |
| `raw_events.payload` | Exact original bytes/JSON |

## Future adapters

A vendor adapter only implements `ConnectorAdapter` and maps product fields → Canonical Security Signal v1. No ECC core schema changes required for a new vendor.
