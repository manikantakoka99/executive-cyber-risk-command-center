# ECC Risk Scenario Model (Phase 3)

## What a Risk Scenario is

A **Risk Scenario** is the primary executive risk object: a meaningful **business risk** supported by multiple signals, findings, assets, domains, controls, and evidence.

It is **not**:

- a raw security event
- a vendor alert
- a single CVE / vulnerability
- a domain score

Example title: *Potential compromise of externally exposed payment infrastructure*.

## Lifecycle (`risk_scenario_status`)

| Status | Meaning |
|--------|---------|
| `candidate` | Minimum evidence met; awaiting confirmation / early assessment |
| `active` | Material enterprise risk; typically outside tolerance or multi-signal |
| `monitoring` | Tracked; may be within/near tolerance |
| `mitigated` / `mitigating` | Controls/remediation applied (schema retains both legacy + Phase 3 values) |
| `accepted` | Residual risk accepted under policy |
| `closed` | Resolved / no longer material |
| `open` | Legacy default from Phase 1 |

Engine transitions: create → `candidate`; multi-signal or outside tolerance → `active`. Terminal statuses (`accepted`, `closed`, `mitigated`) are preserved on recalculation.

## Core attributes

- `scenario_id`, `org_id`
- `title`, `description`, `scenario_type`
- `status`, `priority`, `priority_score`
- `first_seen_at`, `last_seen_at`
- `primary_domain_id`, `primary_asset_id`
- `business_unit_id`, `business_process_id`
- `tolerance_state`, `tolerance_reason`
- `velocity` (`new` | `increasing` | `stable` | `decreasing` | `aging`)
- `explanation` (deterministic narrative)
- `correlation_key`, `current_assessment_id`
- `is_demo` (synthetic demos only)

## Relationships (existing junction tables)

- `risk_scenario_domains`
- `risk_scenario_signals`
- `risk_scenario_findings`
- `risk_scenario_assets`
- `scenario_controls` (+ `effectiveness`, `evidence_note`)
- `scenario_evidence`
- `correlation_events` (how the scenario was formed/updated)

## Explainability contract

Every scenario must answer:

| Question | Source |
|----------|--------|
| What could happen? | `title` / `description` / `scenario_type` |
| Why? | Linked signals + correlation reasons + `explanation` |
| What is affected? | Assets, business process/unit |
| How severe? | Likelihood, impact, inherent, residual |
| Which controls? | `scenario_controls` effectiveness |
| How confident? | Confidence score/label (separate from risk) |
| Executive action? | Tolerance + priority → optional `executive_decisions.scenario_id` |

## Executive decisions

`executive_decisions.scenario_id` is **optional**. Finding-level decisions remain valid during migration. Prefer scenario linkage for new executive workflow once scenarios are populated.

## Demo scenarios

Synthetic only (`is_demo = true`):

1. SOC + ASM + IAM → exposed privileged payment asset
2. VAPT + Cloud → internet-facing API vulnerability
3. Ransomware + backup control weakness → resilience risk
4. Phishing/BEC + IAM → credential compromise path

Seed via `POST /api/ecc/scenarios/demo/seed`.

## Tenant isolation

All scenario rows and junctions are `org_id`-scoped with RLS. Cross-tenant attach of assets/signals/findings/controls is blocked by composite FKs and API org context.
