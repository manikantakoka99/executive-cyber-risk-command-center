# ECC Data Mapping

## 1. Workbook → schema

| Excel sheet | Table | PK | Notes |
|-------------|-------|----|-------|
| organizations | organizations | org_id | 5 UAE demo tenants |
| users | users | user_id | roles: cxo, board_member, program_office, domain_analyst, auditor |
| risk_domains | risk_domains | risk_domain_id | Prefer workbook UUIDs over schema seed inserts |
| org_domain_subscriptions | org_domain_subscriptions | (org_id, risk_domain_id) | 12×5 = 60 |
| domain_risk_snapshots | domain_risk_snapshots | snapshot_id | ~6 months × 12 domains × 5 orgs |
| enterprise_risk_score_snapshots | enterprise_risk_score_snapshots | snapshot_id | 6 per org |
| risk_findings | risk_findings | finding_id | 3 findings typical per org |
| business_impact_assessments | business_impact_assessments | impact_id | 1:1 with findings in sample |
| executive_decisions | executive_decisions | decision_id | links finding + impact |
| decision_action_log | decision_action_log | action_log_id | history for non-awaiting |
| compliance_frameworks | compliance_frameworks | framework_id | Prefer workbook UUIDs |
| org_compliance_status | org_compliance_status | status_id | multiple snapshots possible |
| command_center_activity | command_center_activity | activity_id | feed |
| generated_reports | generated_reports | report_id | board_briefing / regulator_submission |
| audit_log | audit_log | log_id | empty in sample; populated by app |

**Import order:** organizations → users → risk_domains → compliance_frameworks → org_domain_subscriptions → domain_risk_snapshots → enterprise_risk_score_snapshots → risk_findings → business_impact_assessments → executive_decisions → decision_action_log → org_compliance_status → command_center_activity → generated_reports.

When importing sample domains/frameworks, **skip or truncate schema seed inserts** for those tables to preserve workbook UUIDs (FK integrity).

## 2. Entity → business → API → UI → executive value

| DB entity | Business purpose | API | Frontend | Executive value |
|-----------|------------------|-----|----------|-----------------|
| organizations | Tenant context | `GET /orgs` | Org switcher | Correct enterprise boundary |
| users | Actors / RBAC | `GET /me`, users list | Avatar / role | Accountability |
| risk_domains | 12 solution taxonomy | embedded in domains API | Domain cards | Where risk lives |
| org_domain_subscriptions | Enabled coverage | filter domains | “N domains monitored” | Scope clarity |
| domain_risk_snapshots | Domain residual risk | `/risk-domains` | Domain grid + detail | Cause of enterprise score |
| enterprise_risk_score_snapshots | Headline risk | `/overview` score + trend | Hero ring + trend chart | “How risky are we?” |
| risk_findings | Evidence | `/findings` | Findings pages | “What is critical?” |
| business_impact_assessments | $ / downtime / BU | nested in findings/decisions | Impact chips | “What could it cost?” |
| executive_decisions | Action required | `/decisions` + actions | Decision queue | “What should I do?” |
| decision_action_log | Immutable history | nested | Timeline | Governance |
| org_compliance_status | Framework posture | `/compliance` | Bars + page | “Are we compliant?” |
| command_center_activity | Recent changes | `/activity` | Activity list | “What changed?” |
| generated_reports | Board pack | `/reports` | Reports page | Oversight cadence |
| audit_log | Forensic trail | `/audit` | Audit page | Trust / regulators |

## 3. Al Dhabi Holdings snapshot (sample, illustrative)

| Metric | Derived value |
|--------|---------------|
| Latest enterprise score | 42.83 (medium) |
| MoM delta | 45.33 → 42.83 (−2.5) |
| Open exposure | ≈ AED 5.10M |
| Avg compliance | 80% |
| Awaiting CXO | 0 |
| Highest domains | Attack Surface 76 (critical), SOC/MDR 72 (critical), Third-Party 65 (high) |

UI must show these computed values — **not** the HTML mockup’s 62 / 4.2M / 81% / 3.

## 4. Relationship graph (simplified)

```
organizations ─┬─ users
               ├─ org_domain_subscriptions ─ risk_domains
               ├─ domain_risk_snapshots ──── risk_domains
               ├─ enterprise_risk_score_snapshots
               ├─ risk_findings ─┬─ business_impact_assessments
               │                 └─ executive_decisions ─ decision_action_log
               ├─ org_compliance_status ─ compliance_frameworks
               ├─ command_center_activity
               ├─ generated_reports
               └─ audit_log
```

## 5. Validation checklist post-import

- Row counts match workbook  
- Every `org_id` / `risk_domain_id` / `finding_id` / `impact_id` / `decision_id` / `user_id` / `framework_id` FK resolves  
- No duplicate PKs  
- At least one enterprise snapshot per org  
- Latest domain snapshot exists for each active subscription  
