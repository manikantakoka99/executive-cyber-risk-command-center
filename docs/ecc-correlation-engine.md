# ECC Correlation Engine (Phase 3)

Deterministic, explainable cross-domain correlation that turns **canonical security signals** into **business risk scenarios**.

This is **not** a SIEM, not vendor-specific, and **not** LLM/ML scoring.

## Inputs

- `security_signals` (lifecycle `ready_for_correlation`, non-duplicate)
- Canonical assets / business processes / units
- Findings (optional strengthen path)
- Controls (effectiveness assessed at scenario level)
- Risk policy config (`risk_policies.config`, default `ecc_default` **1.1.0**)

## Decision flow

For each eligible signal:

1. **Skip informational** — `severity = info` is not scenario-worthy by default.
2. **Match existing scenario** (strengthen) via rules below.
3. **Finding link** — if `finding_id` already appears on a scenario, strengthen that scenario.
4. **Create vs skip** — create only when evidence threshold is met:
   - ≥ `min_signals_for_scenario` related signals in the temporal window, **or**
   - severity ≥ `min_severity_for_single_signal` (default: `critical`)
5. Persist a `correlation_events` row (`create` | `strengthen` | `skip`) with `rule_code` + human reason.

## V1 correlation rules

| Code | Pattern | Behavior |
|------|---------|----------|
| `same_asset` | Signals share `asset_id` within temporal window | Strengthen existing open/candidate/active/monitoring scenario |
| `same_business_process` | Signals share `business_process_id` | Strengthen process-scoped scenario |
| `correlation_key` | Deterministic hash of org+asset or org+process | Stable join key when asset/process present |
| `finding_signal` | Signal references finding already on a scenario | Strengthen |
| `cross_signal_create` | Multiple related signals meet threshold | Create scenario; link peers in window |
| `critical_single_create` | Single critical (policy threshold) signal | Create candidate scenario |
| `skip_info` | Info severity | Skip |
| `insufficient_evidence` | Below multi-signal threshold and below single-signal severity | Skip (anti-explosion) |
| `not_eligible` | Missing / not ready | Skip |

### Temporal window

`temporal_window_hours` from policy (default **72**). Used for peer discovery and “related” counts.

### Cross-domain

Domains are not averaged. When peers from multiple `risk_domains` attach to the same scenario, the scenario becomes **cross-domain** evidence for scoring/confidence.

### Control weakness / exposure + threat

Correlation itself links evidence; **scoring** (see `ecc-risk-engine-v1.md`) raises likelihood when threat-like events combine with exposure and ineffective controls.

## Scenario explosion controls

- Info signals skipped
- Medium/low alone on a lonely asset skipped
- Related-signal minimum configurable
- Prefer strengthen over create when correlation key / asset / process matches

## Audit

Every correlation action writes `correlation_events` (tenant-scoped RLS). Recalculation after create/strengthen updates assessment history without deleting prior rows.

## Extension points

- Additional rule modules with the same `(action, rule_code, reason)` contract
- Optional domain-pair boosts (still deterministic)
- Scheduled batch via `correlateReadySignals(orgId)` (also invoked after connector sync)

## Limitations (V1)

- No graph ML / anomaly clustering
- No vendor-specific correlation semantics
- Business-process correlation requires `business_process_id` on signals or scenario
- Unresolved assets still may create scenarios when severity threshold is met (confidence drops)
