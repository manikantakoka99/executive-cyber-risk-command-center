-- schema.sql inserts risk domains and frameworks with generated ids.
-- The sample workbook uses stable ids and the same codes. On a fresh
-- volume nothing references these rows yet (tenant seed runs later).
DELETE FROM org_domain_subscriptions;
DELETE FROM domain_risk_snapshots;
DELETE FROM risk_findings;
DELETE FROM org_compliance_status;
DELETE FROM compliance_frameworks;
DELETE FROM risk_domains;
