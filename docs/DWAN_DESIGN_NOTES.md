# DWAN Command Center — Consolidated Database Design (v3)

Files
- `dwan_schema.sql` — single fresh-install script (PostgreSQL 15+, tested on 16.15). Replaces `001` + `002` + `002_down`.
- `dwan_tests.sql` — 135 checks, runs in one rolled-back transaction: `psql -v ON_ERROR_STOP=1 -d dwan -f dwan_tests.sql`
- `DWAN_Consolidated_ERD.pdf` — page 1 overview, page 2 every column; both generated from the executed schema.

## Shape: 42 tables in 11 groups, following the five-stage flow

| Stage | Tables |
|---|---|
| Tenancy, identity, RBAC | organizations, business_units ★, users, role_capabilities ★ |
| Domains & catalogue | risk_domains, org_domain_subscriptions, tool_categories, signal_domain_map |
| 1 Ingestion | org_connectors, ingestion_runs, control_signals, asset_inventory, asset_coverage |
| Policy & appetite | scoring_policy, policy_domain_weights, policy_category_weights, policy_sla, risk_appetite |
| 3 Scores | domain_scores, domain_score_components ★, enterprise_scores |
| 2 Findings & scenarios | risk_findings, finding_verifications, risk_scenarios ★, scenario_findings ★ |
| Impact & loss (financial) | business_impact_assessments, loss_models, enterprise_loss_estimates ★, whatif_scenarios |
| 4 Decisions | risk_acceptances, executive_decisions, decision_action_log |
| 5 Treatment | treatment_plans ★, remediation_actions ★ |
| Compliance | compliance_frameworks, framework_controls ★, control_assessments ★, org_compliance_status |
| Reporting & audit | board_packs, report_exports ★, command_center_activity, audit_log |

## What changed from 001 + 002

Merged and retired
- `domain_risk_snapshots` and `enterprise_risk_score_snapshots` (v1) are gone; `domain_scores_v2` / `enterprise_scores_v2` become `domain_scores` / `enterprise_scores`.
- `generated_reports` becomes `report_exports` (linked to the pack, with a SHA-256 of the file).
- Legacy finding status `resolved` and the `dwan.allow_legacy_resolved` switch are removed.
- `decision_priority` enum folded into `severity_level`; `framework_code` enum replaced by a table column so new frameworks need no migration.

Gaps closed against the product context
- **Correlated scenarios** (stage 2): `risk_scenarios` + `scenario_findings`; likelihood × impact (1–5 each) with a required rationale.
- **Closed loop** (phase 3): `treatment_plans` (mitigate/transfer/avoid/accept/monitor) and `remediation_actions`. Marking an action *done* moves the finding to `fix_reported` only; a passing verification **after** the fix report is required to close it (an old pass no longer counts).
- **RBAC as data**: `role_capabilities` (view financials, approve decisions, accept risk, approve policy, verify, review pack…). Roles now match the personas: board_member, cxo, ciso, risk_lead, domain_analyst, program_office, auditor, admin. All approval rules check capabilities instead of hard-coded role lists.
- **Financial masking enforced by RLS**: impact, loss, enterprise loss and what-if rows are invisible to roles without `view_financials`. Money therefore moved out of `enterprise_scores` into `enterprise_loss_estimates`, so analysts still see the band.
- **Accepted risk returns to the agenda**: on expiry the finding reopens *and* a `renew_acceptance` decision is created. Renewals obey the 90/365-day limit from today and are counted.
- **Decision log is automatic**: every status change writes `decision_action_log` (actor, old → new); approved accept-risk decisions must reference their register entry.
- **Explainability**: `domain_score_components` stores each category's weight, gap and points per score; `fn_domain_movers` answers "what changed since the last board" and flags if the policy changed in between.
- **Enterprise roll-up respects subscriptions**; snapshot refuses mixed policies; `n_outside_appetite` stored; enterprise-level appetite supported (`risk_domain_id` NULL).
- **No invented money**: amounts nullable; every impact row needs a `basis`.
- **Multi-currency**: `organizations.reporting_currency` (default AED); money columns renamed from `*_aed` and carry `currency`.
- **De-duplication**: findings carry `source_category_id` + `external_ref` (unique per tenant) and the ingestion run.
- **Business context**: `business_units` with key processes, linked from assets, users, scenarios and impacts.
- **Tenant consistency**: owner/approver/asset links use composite `(id, org_id)` foreign keys, so a row cannot point into another tenant.
- **Board pack**: reviewer and approver must be different people with the capability; approved packs are frozen.
- Compliance gains control-level evidence (`framework_controls`, `control_assessments`) under the framework roll-up.
- Starter tool catalogue (26 categories) seeded with one owning domain each, using the deck's ransomware weights as the worked example.

Fixes to 002
- `fn_user_can` also refuses a user acting inside another tenant's session.
- Freshness factor, rejected-row threshold and coverage window are policy parameters (were hard-coded 2×, 5%, 7 days).
- `ck_ale_order` was ineffective; replaced by a real p90 ≤ p95 check.
- Roles created `NOLOGIN` without a password in the script (002 shipped `change_me_in_production`); new `ccc_engine` role for scoring/simulation jobs, which alone may write scores.

## Views for the eight tabs
`v_enterprise_headline` (1), `v_domain_posture` (2, 3), `v_decision_queue` (4), `whatif_scenarios` (5), `v_fixes_awaiting_verification`, `v_acceptances_expiring`, `v_sla_breaches`, `v_mttr_by_domain` (6), `fn_domain_movers` (7), `board_packs` (8), plus `v_compliance_posture`. All are `security_invoker`, so RLS and money masking apply.

## Open decisions for the team
1. Should risk_lead be able to sign acceptances? (Currently cxo only; board and CISO cannot.)
2. Are auditors allowed to see financials? (Currently yes.)
3. Existing 001+002 databases need a data migration script into this shape; not written yet.
