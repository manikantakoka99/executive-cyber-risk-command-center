# Ingestion readiness (Phase 6)

## Lifecycle

```
SOURCE RECORD → RAW EVENT → VALIDATION → CANONICAL
  → ENTITY RESOLUTION → DEDUPLICATION → RISK-READY DATA
```

## Data quality metrics (sync run)

received · accepted · rejected · duplicates · unresolved assets/identities · missing timestamps · missing severity · unknown event types · unmapped domains · posture / event / assessment / compliance counts · ready_for_correlation

## Real vendor connector (what changes)

| Sample workbook proof | Production vendor connector |
|----------------------|-----------------------------|
| Local fixture JSON/XLSX | Live API / webhook / file drop |
| Synthetic payloads | Vendor-owned schemas |
| Shared adapter contract | Same `ConnectorAdapter` interface |
| No secrets | Vaulted credentials, network allowlists |
| Demo idempotency keys | Cursor / watermark / vendor event IDs |

## Recommendation (next real connector)

Start with **one** high-value pull API where:

1. Credentials and export rights exist
2. A small real payload sample can be validated offline
3. Mapping to `event` vs `posture_metric` is clear

Suggested first candidates (architecture-ready only): Microsoft Defender for Endpoint **or** a SIEM export already landing in a controlled bucket — not “all 127 products.”
