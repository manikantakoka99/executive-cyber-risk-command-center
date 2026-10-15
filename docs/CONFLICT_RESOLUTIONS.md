# Conflict resolutions (Vinga checklist §11)

**Authority order:** (1) `dwan_schema.sql` + DESIGN_NOTES · (2) ECC_PRODUCT_CONTEXT · (3) Explanation PDF · (4) HTML reference (UX patterns only).

| # | Topic | Resolution |
|---|--------|------------|
| 1 | Financial visibility | **Mask money** unless role has `view_financials` (DB RLS + API). HTML “same numbers for all” is rejected. |
| 2 | Roles | **8 DB roles:** board_member, cxo, ciso, risk_lead, domain_analyst, program_office, auditor, admin. |
| 3 | Who can accept risk | **CxO and Risk Lead** (`accept_risk` in `role_capabilities`). Override with `ACCEPT_RISK_ROLES` if needed. Server checks capability; UI alone is not enough. |
| 4 | Analyst verification | Analysts **can verify** (`verify_findings`); HTML `canAct()` exclusion is wrong vs DB. |
| 5 | Acceptance expiry | **DB limits:** Critical ≤90 days; others ≤365. UI offers 30/90 (Critical) and 30/90/180/365 (non-Critical). Renew = +90 days within remaining limit. |
| 6 | Approver identity | Capability-based user ≠ finding owner (not a free-text CFO dropdown alone). |
| 7 | Board pack | **Reviewer ≠ approver**; approve freezes pack; export records SHA-256. |
| 8 | Source tags | Use `enterprise_scores` / current table names (not `_v2`). |
| 9 | Policy / appetite | **CISO proposes** (`proposed_by`); **Board and CxO** (`approve_policy`) may lock. Proposer ≠ approver; approved versions are immutable. CISO has `approve_policy=false`. |
| 10 | Board technical screens | Board **does not** get Trust, What-if, Closure technical ops, or technical posture columns. Tabs: Headline, Posture (exec), Changed, Pack (+ Compliance read). |
| 11 | Extra screens | Built: Compliance, Audit, Admin users/roles, Policy & appetite, Tenant selector, Risk register, Remediation, Connector health. |
| 12 | Trends | Seed/UI use HTML `tr` arrays reconciled with June board baseline + Sep snapshot. |
