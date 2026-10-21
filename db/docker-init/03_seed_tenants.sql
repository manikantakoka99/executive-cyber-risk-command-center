-- Two demo tenants for a database built from db/schema.sql + migrations 001–008.
-- Migration 001 drops users.role, so personas are stored in user_roles.
-- organizations has no reporting_currency column on this schema.
-- Tenant A: Al Dhabi Holdings — full persona set
-- Tenant B: Falcon National Bank — CISO + Board + CxO for isolation tests

INSERT INTO roles (code, display_name, description) VALUES
  ('board_member', 'Board Member', 'Board oversight'),
  ('cxo', 'CxO', 'Executive decision maker'),
  ('ciso', 'CISO', 'Chief information security officer'),
  ('risk_lead', 'Risk Lead', 'Risk acceptance and register'),
  ('domain_analyst', 'Domain Analyst', 'Domain evidence analyst'),
  ('program_office', 'Program Office', 'PMO / compliance program'),
  ('auditor', 'Auditor', 'Read-only auditor'),
  ('admin', 'Admin', 'Organization administrator')
ON CONFLICT (code) DO NOTHING;

INSERT INTO organizations (org_id, name, industry, hq_country)
VALUES
  ('2accc7de-f693-4b19-8fe8-6db501be05e2', 'Al Dhabi Holdings', 'Conglomerate', 'UAE'),
  ('e5082391-0ae2-4ed1-93d6-c11650b39dbb', 'Falcon National Bank', 'Banking', 'UAE')
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO users (user_id, org_id, first_name, last_name, email) VALUES
  ('c1500001-a090-41a0-8ecc-000000000001', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Layla', 'Al Hashimi', 'layla@ciso.com'),
  ('c1500001-a090-41a0-8ecc-000000000002', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Omar', 'Al Mansoori', 'omar.almansoori@example.com'),
  ('c1500001-a090-41a0-8ecc-000000000003', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Fatima', 'Al Nuaimi', 'fatima.alnuaimi@example.com'),
  ('c1500001-a090-41a0-8ecc-000000000004', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Khalid', 'Al Suwaidi', 'khalid.alsuwaidi@example.com'),
  ('c1500001-a090-41a0-8ecc-000000000005', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Mariam', 'Al Dhaheri', 'mariam@cxo.com'),
  ('c1500001-a090-41a0-8ecc-000000000006', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Hessa', 'Al Ketbi', 'hessa@board.com'),
  ('c1500001-a090-41a0-8ecc-000000000007', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Yusuf', 'Rahman', 'yusuf@domainanalyst.com'),
  ('c1500001-a090-41a0-8ecc-000000000008', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Aisha', 'Khan', 'aisha.khan@example.com'),
  ('c1500001-a090-41a0-8ecc-000000000009', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Nadia', 'Farouk', 'nadia@admin.com'),
  ('c1500001-a090-41a0-8ecc-00000000000a', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Rashid', 'Al Maktoum', 'rashid@risklead.com'),
  ('c1500001-a090-41a0-8ecc-00000000000b', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'Sara', 'Ibrahim', 'sara@programoffice.com'),
  ('c1500001-a090-41a0-8ecc-00000000000c', '2accc7de-f693-4b19-8fe8-6db501be05e2', 'James', 'Okoye', 'james@auditor.com'),
  ('c1500001-a090-41a0-8ecc-0000000000b1', 'e5082391-0ae2-4ed1-93d6-c11650b39dbb', 'Nora', 'Al Falasi', 'nora.alfalasi@example.com'),
  ('c1500001-a090-41a0-8ecc-0000000000b2', 'e5082391-0ae2-4ed1-93d6-c11650b39dbb', 'Tariq', 'Hassan', 'tariq.hassan@example.com'),
  ('c1500001-a090-41a0-8ecc-0000000000b3', 'e5082391-0ae2-4ed1-93d6-c11650b39dbb', 'Samira', 'Qureshi', 'samira.qureshi@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
SELECT m.user_id, r.role_id, u.org_id, true
FROM (
  VALUES
    ('c1500001-a090-41a0-8ecc-000000000001'::uuid, 'ciso'),
    ('c1500001-a090-41a0-8ecc-000000000002'::uuid, 'cxo'),
    ('c1500001-a090-41a0-8ecc-000000000003'::uuid, 'cxo'),
    ('c1500001-a090-41a0-8ecc-000000000004'::uuid, 'cxo'),
    ('c1500001-a090-41a0-8ecc-000000000005'::uuid, 'cxo'),
    ('c1500001-a090-41a0-8ecc-000000000006'::uuid, 'board_member'),
    ('c1500001-a090-41a0-8ecc-000000000007'::uuid, 'domain_analyst'),
    ('c1500001-a090-41a0-8ecc-000000000008'::uuid, 'domain_analyst'),
    ('c1500001-a090-41a0-8ecc-000000000009'::uuid, 'admin'),
    ('c1500001-a090-41a0-8ecc-00000000000a'::uuid, 'risk_lead'),
    ('c1500001-a090-41a0-8ecc-00000000000b'::uuid, 'program_office'),
    ('c1500001-a090-41a0-8ecc-00000000000c'::uuid, 'auditor'),
    ('c1500001-a090-41a0-8ecc-0000000000b1'::uuid, 'ciso'),
    ('c1500001-a090-41a0-8ecc-0000000000b2'::uuid, 'board_member'),
    ('c1500001-a090-41a0-8ecc-0000000000b3'::uuid, 'cxo')
) AS m(user_id, role_code)
JOIN users u ON u.user_id = m.user_id
JOIN roles r ON r.code = m.role_code
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.user_id AND ur.is_primary
)
ON CONFLICT DO NOTHING;

INSERT INTO org_domain_subscriptions (org_id, risk_domain_id)
SELECT 'e5082391-0ae2-4ed1-93d6-c11650b39dbb', risk_domain_id FROM risk_domains
ON CONFLICT (org_id, risk_domain_id) DO NOTHING;

INSERT INTO org_domain_subscriptions (org_id, risk_domain_id)
SELECT '2accc7de-f693-4b19-8fe8-6db501be05e2', risk_domain_id FROM risk_domains
ON CONFLICT (org_id, risk_domain_id) DO NOTHING;
