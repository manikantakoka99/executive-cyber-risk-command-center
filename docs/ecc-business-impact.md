# ECC Business Impact (Phase 4)

## Finding impact vs scenario impact

| Layer | Table | Meaning |
|-------|-------|---------|
| **Finding-level** | `business_impact_assessments` | Impact of one security issue (MVP) |
| **Scenario scoring** | `impact_assessments` | Numeric impact score used in √(L×I) |
| **Scenario business impact** | `scenario_business_impacts` | Executive business consequence of the combined scenario |

Do **not** sum finding AED values into scenario exposure when they overlap — V1 uses **MAX** of linked finding financial exposures (`derivation_meta.doubleCountAvoidance = max_not_sum`).

## Scenario impact fields

- financial exposure (AED) — **NULL if unknown**
- `financial_known` / `financialStatus`
- downtime cost/hour, expected downtime hours
- affected business unit / process
- business criticality
- regulatory, data, operational, reputational narrative
- confidence
- explanation (deterministic)
- evidence_refs + derivation_meta

## Derivation

```
Scenario → assets → processes/units → linked finding BIAs → compliance cues
```

Example explanation:

> Exposure is primarily driven by the critical payment-processing business process and the affected internet-facing asset.

No LLM. No invented money.

## API

`GET /api/ecc/scenarios/:id/impact`
