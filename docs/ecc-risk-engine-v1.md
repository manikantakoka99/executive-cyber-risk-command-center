# ECC Risk Engine V1 (Phase 3)

Deterministic scoring for risk scenarios. **Weights are development defaults** in policy `ecc_default` **1.1.0** — not permanent product truth.

Source of configuration: `risk_policies.config` (+ `risk_policy_factors`, `risk_tolerance_rules`). Code fallback exists only if DB policy is missing.

## Pipeline

```
Signals / findings / assets / controls
        ↓
Likelihood factors (weighted)
Impact factors (weighted)
        ↓
Inherent Risk = √(Likelihood × Impact)   // 0–100
        ↓
Control effectiveness reduction
        ↓
Residual Risk
        ↓
Confidence (separate) · Velocity · Priority · Tolerance
        ↓
Deterministic explanation + assessment history row
```

## Likelihood factors (0–100 each)

| Code | Intent |
|------|--------|
| `threat_activity` | Threat-like event types + max severity |
| `exposure_reachability` | Internet exposure / criticality |
| `exploitability` | Vuln/exposure-like signals + exposure |
| `control_weakness` | Mapped from control effectiveness |
| `attack_evidence` | Supporting signal volume |

Default weights (sum ≈ 1.0):

- threat_activity **0.30**
- exposure_reachability **0.25**
- exploitability **0.20**
- control_weakness **0.15**
- attack_evidence **0.10**

Aggregation: weighted average of available weighted factors → **Likelihood 0–100**.

## Impact factors (0–100 each)

| Code | Intent |
|------|--------|
| `financial` | From linked `business_impact_assessments.financial_exposure_aed` only |
| `operational` | Downtime cost linkage / asset criticality |
| `business_criticality` | Asset criticality on scenario |
| `regulatory_compliance` | Compliance scope on linked impacts |
| `data_impact` | Compliance/title heuristics |

Default weights:

- financial **0.30**
- operational **0.20**
- business_criticality **0.25**
- regulatory_compliance **0.15**
- data_impact **0.10**

### Missing financial exposure

- **Never invent AED / monetary values**
- Factor note: `Financial exposure unknown — not invented`
- Financial weight redistributed across remaining impact factors
- Confidence reduced (`hasFinancial = false`)
- `impact_assessments.financial_aed` stored as `NULL`

## Inherent risk

\[
\text{Inherent} = \sqrt{L \times I}
\]

Normalized to **0–100**. Severity words for narrative: ≥80 critical, ≥60 high, ≥35 medium, else low.

## Control effectiveness → residual

Effectiveness on `scenario_controls.effectiveness`:

| Value | Default residual reduction |
|-------|----------------------------|
| `effective` | 45% |
| `partially_effective` | 20% |
| `ineffective` | 0% |
| `unknown` | 5% |

\[
\text{Residual} = \text{Inherent} \times (1 - \text{reduction})
\]

Existence of a control alone does **not** reduce risk; effectiveness must be assessed.

Scenario rollup: any `ineffective` → ineffective; all effective → effective; else partial/unknown.

## Confidence (≠ risk)

Deterministic V1 score ~5–98 from:

- signal count
- cross-domain count
- asset resolution
- business context
- financial known
- control effectiveness known
- freshness (hours since `last_seen_at`)

Labels: **high** (≥75), **medium** (≥50), **low**.

Uncertainty is explicit in explanation notes (e.g. “financial exposure unknown”).

## Risk age + velocity

- Age from `first_seen_at`
- Velocity: `new` | `increasing` | `stable` | `decreasing` | `aging`
  - new: age &lt; 24h and no prior assessment
  - increasing/decreasing: residual delta vs prior current assessment (±5)
  - aging: last_seen stale &gt; 168h
  - else stable

## Prioritization

**Do not average domain scores.**

Priority score starts at residual, with boosts:

- critical/high asset +8
- outside tolerance +10
- increasing velocity +5
- capped at 100

Tiers from policy `priority_bands` (defaults: critical ≥80, high ≥60, medium ≥35, else low).

## Tolerance

Uses `risk_tolerance_rules.max_residual_risk` (org + optional asset criticality), else policy default (50).

| State | Rule |
|-------|------|
| `outside` | residual &gt; max |
| `near` | residual ≥ max − near_band |
| `within` | else |

Reason strings explain the breach (threshold / near-band).

## Assessment history

Each recalculation:

1. Flips prior `risk_assessments.is_current` → false (**keeps row**)
2. Inserts new likelihood, impact, risk assessment + factors
3. Updates scenario `current_assessment_id`, priority, tolerance, velocity, explanation

Answers: *Why was this High yesterday?* via historical assessments + `calculation_meta` + factors.

## Explanation

`buildExplanation()` concatenates structured fields — **no LLM**.

## APIs

- `GET /api/ecc/scenarios` (filters: status, priority, domain, business_unit, business_process, asset, tolerance_state)
- `GET /api/ecc/scenarios/:id`
- `POST /api/ecc/scenarios/:id/recalculate`
- `GET /api/ecc/scenarios/:id/assessments`
- `GET /api/ecc/scenarios/:id/evidence`
- `GET /api/ecc/scenarios/:id/relationships`
- `POST /api/ecc/scenarios/demo/seed`
- `POST /api/ecc/scenarios/correlate`

Tenant isolation mandatory via request org context.

## Limitations / future

- Weights require product ratification
- No Monte Carlo / FAIR simulation yet
- Velocity is residual delta only (not full time-series)
- Domain scores remain separate executive views; scenarios are the enterprise prioritization path
