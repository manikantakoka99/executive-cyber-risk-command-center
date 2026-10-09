# ECC Import Validation Report

## Row counts
- organizations: 5 (expected 5) [OK]
- users: 25 (expected 25) [OK]
- risk_domains: 13 (expected 13) [OK]
- org_domain_subscriptions: 60 (expected 60) [OK]
- domain_risk_snapshots: 360 (expected 360) [OK]
- enterprise_risk_score_snapshots: 30 (expected 30) [OK]
- risk_findings: 15 (expected 15) [OK]
- business_impact_assessments: 15 (expected 15) [OK]
- executive_decisions: 21 (expected 15) [MISMATCH]
- decision_action_log: 35 (expected 11) [MISMATCH]
- compliance_frameworks: 5 (expected 5) [OK]
- org_compliance_status: 50 (expected 50) [OK]
- command_center_activity: 65 (expected 34) [MISMATCH]
- generated_reports: 12 (expected 10) [MISMATCH]
- audit_log: 93 (sample may be 0) [INFO]

## Foreign-key spot checks
- users with missing org: 0 [OK]
- findings missing org/domain: 0 [OK]
- impacts missing finding: 0 [OK]
- decisions missing finding/impact: 0 [OK]
- action logs missing decision: 0 [OK]
- subscriptions missing domain: 0 [OK]

## Per-org sanity
- Al Dhabi Holdings: enterprise_snaps=6, domain_snaps=72, findings=3, awaiting_decisions=0
- Burj Retail Collective: enterprise_snaps=6, domain_snaps=72, findings=3, awaiting_decisions=1
- Falcon National Bank: enterprise_snaps=6, domain_snaps=72, findings=3, awaiting_decisions=1
- Meridian Health Group: enterprise_snaps=6, domain_snaps=72, findings=3, awaiting_decisions=1
- Zayed Energy & Utilities: enterprise_snaps=6, domain_snaps=72, findings=3, awaiting_decisions=0

## Workbook sheet presence
- organizations: present
- users: present
- risk_domains: present
- org_domain_subscriptions: present
- domain_risk_snapshots: present
- enterprise_risk_score_snapshots: present
- risk_findings: present
- business_impact_assessments: present
- executive_decisions: present
- decision_action_log: present
- compliance_frameworks: present
- org_compliance_status: present
- command_center_activity: present
- generated_reports: present
