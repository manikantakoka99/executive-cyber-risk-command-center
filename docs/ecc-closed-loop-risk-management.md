# ECC Closed-Loop Risk Management (Phase 4)

## Loop

```
Signal → Scenario → Risk → Decision → Action → Verification → Recalculation → Updated residual
```

## Critical rule

**Completing an action does NOT reduce residual risk.**

Only a **successful verification** may improve control effectiveness and trigger recalculation.

## Action lifecycle

Statuses: `open` | `pending` | `in_progress` | `blocked` | `completed` | `cancelled` | `verified`

Fields: owner, title, description, priority, due date, blocker, `verification_required`.

## Verification

On `POST /api/ecc/actions/:id/verification`:

- Requires action `completed` (or already `verified`)
- Records `previous_residual_risk`, `verified_residual_risk`
- Preserves prior `risk_assessments` (`is_current` flipped, not deleted)
- On success (`verified`/`pass`): improve ineffective controls → `recalculateScenario` → refresh impact + recommendation
- On fail/inconclusive: residual unchanged

Explainable outcome:

> Residual risk decreased from 82 to 51 after verified remediation.

## Auditability

`audit_log` entries for: decision created, treatment changed, action created/reassigned/status, verification submitted/approved, risk recalculated — with actor, timestamps, old/new JSON, correlation id.

## Demo workflows

`POST /api/ecc/scenarios/demo/closed-loop`

1. Ransomware outside tolerance → mitigate → approve → action → verify → residual decreases  
2. Medium path → acknowledge/monitor → no remediation  
3. High risk incomplete cost evidence → transfer consideration / request info  

Synthetic only.

## Limitations

- Remediation cost rarely known in V1 — ROI often unknown  
- Control improvement on verify is a blunt “set effective” for demo/product V1  
- Finding-level decision queue remains; scenario queue is additive  
- `scenario_id` on decisions still optional for legacy rows  
