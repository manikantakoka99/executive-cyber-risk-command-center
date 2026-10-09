# ECC Executive Decision Intelligence (Phase 4)

## Concepts (do not merge)

| Concept | Answers | Examples |
|---------|---------|----------|
| **Treatment** | What will we do about the risk? | mitigate, transfer, avoid, accept, monitor |
| **Decision outcome** | What did the executive decide? | approve, request_information, decline, acknowledge, accept_risk, monitor |
| **Action** | What work item was assigned? | open → in_progress → completed |

A decision can be: Treatment=`mitigate` + Outcome=`approve`.

## Recommendation engine (deterministic)

Inputs: residual, tolerance, velocity, control effectiveness, scenario business impact, confidence.

Outputs:

- `recommended_treatment`
- `recommended_priority`
- `recommended_action`
- `reason_codes` (e.g. `OUTSIDE_TOLERANCE`, `CONTROL_INEFFECTIVE`, `LOW_CONFIDENCE`, `REMEDIATION_COST_UNCERTAIN`)

No LLM.

## Treatment plan

`treatment_plans`: type, rationale, target residual, target date, owner, economics fields, status (`proposed`…`cancelled`).

Economics: if cost or exposure unknown → `economics_known=false`, ROI null, note = "unknown" / "not enough evidence".

## Executive decision

Primary link: `executive_decisions.scenario_id` (nullable; finding_id remains for MVP).

Captures treatment, rationale, owner, recommendation/treatment plan FKs.

## APIs

- `POST /api/ecc/scenarios/:id/decision`
- `GET /api/ecc/scenarios/:id/decisions`
- `POST|GET /api/ecc/scenarios/:id/treatment`

## UI

Scenario detail: WHAT / WHY / IMPACT / RISK / WHAT SHOULD WE DO / WHO / BY WHEN.  
Overview: **Executive Scenario Queue** (no raw telemetry).
