# Canonical Security Signal v1

Vendor-neutral contract that every ECC connector adapter must emit after normalizing a source event.

## Why vendor-neutrality

ECC aggregates many domains and will eventually integrate many products. Encoding Sentinel- or CrowdStrike-specific fields as first-class columns would couple the product to vendors. Instead:

- **Canonical columns** = ECC meaning (severity, event_type, asset_id, …)
- **Vendor metadata (JSONB)** = source fidelity (P1, product codes, URLs, tags)

## Identity & lineage

| Field | Meaning |
|-------|---------|
| `signal_id` | Globally unique ECC signal UUID |
| `org_id` | Tenant |
| `connector_id` | Integration that produced the event |
| `raw_event_id` | Traceability to immutable `raw_events.payload` |

## Source

| Field | Meaning |
|-------|---------|
| `source_type` | Controlled catalog (`soc`, `iam`, `cloud`, …) |
| `source_name` | Human/system name (may be vendor product later) |

## Domain

Uses existing `risk_domains` (12 YVI domains + `unmapped`).  
No second taxonomy. Unmapped signals go to the `unmapped` domain — never silently dropped.

## Event type

Controlled catalog `signal_event_types` (V1 starter set). Extensible via rows, not code forks.

## Severity

Canonical: `info | low | medium | high | critical`  
Original vendor severity preserved in `vendor_severity` / `vendor_extensions.sourceSeverity`.

## Timing

| Field | Meaning |
|-------|---------|
| `observed_at` | When the security event occurred |
| `ingested_at` | When ECC received the raw event |
| `processed_at` | When ECC produced the canonical signal |

## Asset / identity / finding

- `asset_id` → canonical `assets` (via identifier resolution)
- `security_identity_ref` → external username/SID (NOT assumed to be `users.user_id`)
- `related_user_id` → only when the identity is a known ECC login user
- `finding_id` → optional link; signals do **not** auto-create findings

## Evidence

`evidence_refs` JSON array of `{kind, value, label?}`. Large payloads stay in `raw_events`.

## Business context

Resolved from asset → business_unit / business_process when possible (not copied blindly from vendor JSON).

## Lifecycle

`received → parsed → validated → normalized → resolved → deduplicated | ready_for_correlation`  
Terminal: `rejected` / `error` with reason. Transitions stored in `signal_lifecycle_events`.

## Fingerprint / dedupe

SHA-256 over normalized org, connector, domain, event_type, severity, identifiers, identity ref, finding, evidence, and a 5-minute observed-time bucket. Raw JSON key order is never used alone.
