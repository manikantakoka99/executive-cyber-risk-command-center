-- Minimal two-tenant seed for local docker compose (no Excel required).
-- Tenant A: Al Dhabi Holdings — full persona set
-- Tenant B: Falcon National Bank — CISO + Board + CxO for isolation tests

SET app.current_org_id = '2accc7de-f693-4b19-8fe8-6db501be05e2';
SET app.current_user_id = 'c1500001-a090-41a0-8ecc-000000000001';

INSERT INTO organizations (org_id, name, industry, hq_country, reporting_currency)
VALUES
  ('2accc7de-f693-4b19-8fe8-6db501be05e2', 'Al Dhabi Holdings', 'Conglomerate', 'UAE', 'AED'),
  ('e5082391-0ae2-4ed1-93d6-c11650b39dbb', 'Falcon National Bank', 'Banking', 'UAE', 'AED')
ON CONFLICT (org_id) DO NOTHING;

-- Bypass RLS for seed inserts by using session as each org in turn.
-- Superuser / table owner still sees rows; FORCE RLS applies to non-bypass roles.

INSERT INTO users (user_id, org_id, first_name, last_name, email, role, job_title) VALUES
  ('c1500001-a090-41a0-8ecc-000000000001', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Layla', 'Al Hashimi', 'layla.hashimi@aldhabi.demo', 'ciso', 'CISO'),
  ('c1500001-a090-41a0-8ecc-000000000002', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Omar', 'Al Mansoori', 'omar.mansoori@aldhabi.demo', 'cxo', 'CEO'),
  ('c1500001-a090-41a0-8ecc-000000000003', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Fatima', 'Al Nuaimi', 'fatima.nuaimi@aldhabi.demo', 'cxo', 'CFO'),
  ('c1500001-a090-41a0-8ecc-000000000004', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Khalid', 'Al Suwaidi', 'khalid.suwaidi@aldhabi.demo', 'cxo', 'CIO'),
  ('c1500001-a090-41a0-8ecc-000000000005', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Mariam', 'Al Dhaheri', 'mariam.dhaheri@aldhabi.demo', 'cxo', 'COO'),
  ('c1500001-a090-41a0-8ecc-000000000006', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Hessa', 'Al Ketbi', 'hessa.ketbi@aldhabi.demo', 'board_member', 'Board Member'),
  ('c1500001-a090-41a0-8ecc-000000000007', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Yusuf', 'Rahman', 'yusuf.rahman@aldhabi.demo', 'domain_analyst', 'Security Analyst'),
  ('c1500001-a090-41a0-8ecc-000000000008', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Aisha', 'Khan', 'aisha.khan@aldhabi.demo', 'domain_analyst', 'SOC Analyst'),
  ('c1500001-a090-41a0-8ecc-000000000009', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Nadia', 'Farouk', 'nadia.farouk@aldhabi.demo', 'admin', 'Admin'),
  ('c1500001-a090-41a0-8ecc-00000000000a', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Rashid', 'Al Maktoum', 'rashid.maktoum@aldhabi.demo', 'risk_lead', 'Risk Lead'),
  ('c1500001-a090-41a0-8ecc-00000000000b', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Sara', 'Ibrahim', 'sara.ibrahim@aldhabi.demo', 'program_office', 'Compliance Manager'),
  ('c1500001-a090-41a0-8ecc-00000000000c', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'James', 'Okoye', 'james.okoye@aldhabi.demo', 'auditor', 'Auditor'),
  -- Falcon National Bank (tenant B)
  ('c1500001-a090-41a0-8ecc-0000000000b1', 'e5082391-0ae2-4ed1-93d6-c11650b39dbb', 'Nora', 'Al Falasi', 'nora.falasi@falcon.demo', 'ciso', 'CISO'),
  ('c1500001-a090-41a0-8ecc-0000000000b2', 'e5082391-0ae2-4ed1-93d6-c11650b39dbb', 'Tariq', 'Hassan', 'tariq.hassan@falcon.demo', 'board_member', 'Board Member'),
  ('c1500001-a090-41a0-8ecc-0000000000b3', 'e5082391-0ae2-4ed1-93d6-c11650b39dbb', 'Samira', 'Qureshi', 'samira.qureshi@falcon.demo', 'cxo', 'CEO')
ON CONFLICT DO NOTHING;

-- Re-map user_roles after seed (schema role codes only)
INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
SELECT u.user_id, r.role_id, u.org_id, true
FROM users u
JOIN roles r ON r.code = u.role::text
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.user_id AND ur.is_primary
)
ON CONFLICT DO NOTHING;

-- Lightweight Falcon finding so isolation tests have a tenant-B row
SET app.current_org_id = 'e5082391-0ae2-4ed1-93d6-c11650b39dbb';
SET app.current_user_id = 'c1500001-a090-41a0-8ecc-0000000000b1';

INSERT INTO org_domain_subscriptions (org_id, risk_domain_id)
SELECT 'e5082391-0ae2-4ed1-93d6-c11650b39dbb', risk_domain_id FROM risk_domains
ON CONFLICT (org_id, risk_domain_id) DO NOTHING;

INSERT INTO org_domain_subscriptions (org_id, risk_domain_id)
SELECT '2accc7de-f693-4b19-8fe8-6db501be05e2', risk_domain_id FROM risk_domains
ON CONFLICT (org_id, risk_domain_id) DO NOTHING;
