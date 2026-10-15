-- DWAN consolidated schema tests.  Run as a superuser on a database where dwan_schema.sql is installed:
--   psql -v ON_ERROR_STOP=1 -d dwan -f dwan_tests.sql
-- Self-contained: own fixtures inside one transaction that always rolls back.
-- Safe on empty and seeded databases (does not depend on demo seed rows).
-- Prints PASS lines; the first failure raises and stops.
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;
-- Pin timezone so date→timestamptz casts in movers / snapshots are stable everywhere.
SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.ok(c BOOLEAN, msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; RAISE NOTICE 'PASS: %', msg; END $$;

CREATE FUNCTION pg_temp.fails(sql TEXT, p_like TEXT, msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%' || p_like || '%' THEN RAISE NOTICE 'PASS: % (%)', msg, left(SQLERRM, 80); RETURN; END IF;
    RAISE EXCEPTION 'FAIL: % raised the wrong error: %', msg, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % did not fail', msg;
END $$;

-- ------------------------------------------------------------------ fixtures (unique names; independent of seed data)
CREATE TEMP TABLE fx(k TEXT PRIMARY KEY, id UUID);
CREATE FUNCTION pg_temp.f(k TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT id FROM fx WHERE fx.k = $1 $$;
CREATE FUNCTION pg_temp.d(c TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT risk_domain_id FROM risk_domains WHERE code = $1::domain_code $$;
CREATE FUNCTION pg_temp.c(c TEXT) RETURNS UUID LANGUAGE sql AS $$ SELECT category_id FROM tool_categories WHERE code = $1 $$;

INSERT INTO organizations(name, industry, hq_country) VALUES ('__dwan_test_org_a__','Bank','UAE');
INSERT INTO organizations(name, industry, hq_country, reporting_currency) VALUES ('__dwan_test_org_b__','Retail','USA','USD');
INSERT INTO fx SELECT 'orgA', org_id FROM organizations WHERE name='__dwan_test_org_a__';
INSERT INTO fx SELECT 'orgB', org_id FROM organizations WHERE name='__dwan_test_org_b__';
INSERT INTO users(org_id, first_name, last_name, email, role) VALUES
  (pg_temp.f('orgA'),'Cara','Xo','cxo@dwan-test.a','cxo'), (pg_temp.f('orgA'),'Dan','Analyst','an@dwan-test.a','domain_analyst'),
  (pg_temp.f('orgA'),'Bo','Ard','board@dwan-test.a','board_member'), (pg_temp.f('orgA'),'Cy','So','ciso@dwan-test.a','ciso'),
  (pg_temp.f('orgA'),'Fin','Cfo','cfo@dwan-test.a','cxo'), (pg_temp.f('orgA'),'Risk','Lead','risk@dwan-test.a','risk_lead'),
  (pg_temp.f('orgB'),'Bea','Xo','cxo@dwan-test.b','cxo');
INSERT INTO fx
SELECT split_part(email,'@',1) || CASE WHEN email LIKE '%@dwan-test.b' THEN 'B' ELSE 'A' END, user_id
FROM users
WHERE email LIKE '%@dwan-test.%';
-- keys: cxoA anA boardA cisoA cfoA riskA cxoB
INSERT INTO org_domain_subscriptions(org_id, risk_domain_id) SELECT pg_temp.f('orgA'), risk_domain_id FROM risk_domains;

SELECT pg_temp.ok((SELECT count(*) FROM tool_categories) >= 26 AND (SELECT count(*) FROM risk_domains) = 12, 'reference data seeded: 12 domains, starter tool catalogue');
SELECT pg_temp.ok((SELECT count(*) FROM fn_check_signal_ownership()) = 0, 'every seeded tool category has exactly one owning domain');
SELECT pg_temp.fails($$INSERT INTO signal_domain_map VALUES ((SELECT category_id FROM tool_categories WHERE code='cspm'), (SELECT risk_domain_id FROM risk_domains WHERE code='iam_pam'), 'owning')$$,
  'uq_signal_one_owner', 'a category cannot be owned by two domains (no double counting)');
SELECT pg_temp.fails($$INSERT INTO users(org_id, first_name, email) VALUES ((SELECT id FROM fx WHERE k='orgA'), 'Dup', 'CXO@DWAN-TEST.A')$$,
  'uq_users_email', 'e-mail is unique regardless of case');
SELECT pg_temp.ok(fn_user_can('approve_decisions', pg_temp.f('cxoA')) AND NOT fn_user_can('approve_decisions', pg_temp.f('boardA'))
  AND NOT fn_user_can('view_financials', pg_temp.f('anA'))
  AND fn_user_can('accept_risk', pg_temp.f('cxoA')) AND fn_user_can('accept_risk', pg_temp.f('riskA'))
  AND NOT fn_user_can('accept_risk', pg_temp.f('cisoA'))
  AND fn_user_can('approve_policy', pg_temp.f('boardA')) AND NOT fn_user_can('approve_policy', pg_temp.f('cisoA')),
  'role capabilities: accept=cxo+risk_lead; policy approve=board not ciso; analyst sees no money');

-- ------------------------------------------------------------------ policy (CISO proposes, Board approves; lock on approve)
INSERT INTO scoring_policy(org_id, version, proposed_by) VALUES (pg_temp.f('orgA'), 1, pg_temp.f('cisoA'));
INSERT INTO fx SELECT 'pol1', policy_id FROM scoring_policy WHERE version=1 AND org_id=pg_temp.f('orgA');
INSERT INTO policy_category_weights(policy_id, org_id, category_id, weight)
  SELECT pg_temp.f('pol1'), pg_temp.f('orgA'), pg_temp.c(k), w FROM (VALUES ('edr_xdr',25),('siem_soar',20),('immutable_backup',25),('dr_testing',30),('cspm',100),('cwpp',0)) v(k,w);
INSERT INTO policy_domain_weights(policy_id, org_id, risk_domain_id, weight) SELECT pg_temp.f('pol1'), pg_temp.f('orgA'), risk_domain_id, 1 FROM risk_domains;
INSERT INTO policy_sla(policy_id, org_id, severity, days) VALUES
  (pg_temp.f('pol1'), pg_temp.f('orgA'), 'critical', 7),(pg_temp.f('pol1'), pg_temp.f('orgA'), 'high', 30),
  (pg_temp.f('pol1'), pg_temp.f('orgA'), 'medium', 60),(pg_temp.f('pol1'), pg_temp.f('orgA'), 'low', 90);
SELECT pg_temp.ok((SELECT count(*) FROM fn_check_policy_weights(pg_temp.f('pol1'))) = 0, 'category weights total 100 in every weighted domain');
SELECT pg_temp.fails($$UPDATE scoring_policy SET status='approved', proposed_by=(SELECT id FROM fx WHERE k='cisoA'), approved_by=(SELECT id FROM fx WHERE k='anA'), approved_at=now(), effective_from=now() - interval '1 day' WHERE policy_id=(SELECT id FROM fx WHERE k='pol1')$$,
  'lacks capability approve_policy', 'an analyst cannot approve a scoring policy');
SELECT pg_temp.fails($$UPDATE scoring_policy SET status='approved', proposed_by=(SELECT id FROM fx WHERE k='cisoA'), approved_by=(SELECT id FROM fx WHERE k='cisoA'), approved_at=now(), effective_from=now() - interval '1 day' WHERE policy_id=(SELECT id FROM fx WHERE k='pol1')$$,
  'cannot approve their own', 'the CISO cannot approve their own policy proposal');
SELECT pg_temp.fails($$UPDATE scoring_policy SET status='approved', proposed_by=(SELECT id FROM fx WHERE k='cisoA'), approved_by=(SELECT id FROM fx WHERE k='cxoB'), approved_at=now(), effective_from=now() - interval '1 day' WHERE policy_id=(SELECT id FROM fx WHERE k='pol1')$$,
  'same organization', 'an approver from another tenant is rejected');
UPDATE scoring_policy SET status='approved', proposed_by=pg_temp.f('cisoA'), approved_by=pg_temp.f('boardA'), approved_at=now(), effective_from=now() - interval '30 days' WHERE policy_id=pg_temp.f('pol1');
SELECT pg_temp.ok(fn_active_policy(pg_temp.f('orgA')) = pg_temp.f('pol1'), 'policy v1 proposed by CISO, approved by Board, and active');
SELECT pg_temp.fails($$UPDATE scoring_policy SET band_high_min = 50 WHERE policy_id=(SELECT id FROM fx WHERE k='pol1')$$, 'immutable', 'approved policy is immutable');
SELECT pg_temp.fails($$UPDATE policy_category_weights SET weight = 1 WHERE policy_id=(SELECT id FROM fx WHERE k='pol1')$$, 'frozen', 'approved policy weights are frozen');
SELECT pg_temp.fails($$INSERT INTO policy_sla(policy_id, org_id, severity, days) SELECT policy_id, org_id, 'critical', 1 FROM scoring_policy WHERE policy_id=(SELECT id FROM fx WHERE k='pol1')$$, 'frozen', 'approved policy SLAs are frozen');
INSERT INTO scoring_policy(org_id, version, proposed_by) VALUES (pg_temp.f('orgA'), 2, pg_temp.f('cisoA'));
SELECT pg_temp.fails($$UPDATE scoring_policy SET status='approved', proposed_by=(SELECT id FROM fx WHERE k='cisoA'), approved_by=(SELECT id FROM fx WHERE k='boardA'), approved_at=now(), effective_from=now() WHERE org_id=(SELECT id FROM fx WHERE k='orgA') AND version=2$$,
  'ex_policy_no_overlap', 'two approved policies cannot have overlapping effective windows');
SELECT pg_temp.ok(fn_band(54.99, pg_temp.f('pol1')) = 'medium' AND fn_band(55, pg_temp.f('pol1')) = 'high' AND fn_band(70, pg_temp.f('pol1')) = 'critical' AND fn_band(34.99, pg_temp.f('pol1')) = 'low',
  'band thresholds: <35 low, 35-54 medium, 55-69 high, >=70 critical');

-- appetite (CISO proposes, Board approves)
SELECT pg_temp.fails($$INSERT INTO risk_appetite(org_id, risk_domain_id, max_score, proposed_by, approved_by, review_date) VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT risk_domain_id FROM risk_domains WHERE code='soc_mdr'), 45, (SELECT id FROM fx WHERE k='cisoA'), (SELECT id FROM fx WHERE k='anA'), CURRENT_DATE + 180)$$,
  'lacks capability', 'an analyst cannot approve board appetite');
SELECT pg_temp.fails($$INSERT INTO risk_appetite(org_id, risk_domain_id, max_score, proposed_by, approved_by, review_date) VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT risk_domain_id FROM risk_domains WHERE code='soc_mdr'), 45, (SELECT id FROM fx WHERE k='cisoA'), (SELECT id FROM fx WHERE k='cisoA'), CURRENT_DATE + 180)$$,
  'cannot approve their own', 'the CISO cannot approve their own appetite proposal');
INSERT INTO risk_appetite(org_id, risk_domain_id, max_score, proposed_by, approved_by, effective_from, review_date) VALUES
  (pg_temp.f('orgA'), pg_temp.d('soc_mdr'), 45, pg_temp.f('cisoA'), pg_temp.f('boardA'), '2026-01-01', '2027-01-01'),
  (pg_temp.f('orgA'), NULL, 50, pg_temp.f('cisoA'), pg_temp.f('boardA'), '2026-01-01', '2027-01-01');
SELECT pg_temp.ok(true, 'board approves a domain appetite and an enterprise-level appetite proposed by CISO');
SELECT pg_temp.fails($$INSERT INTO risk_appetite(org_id, risk_domain_id, max_score, proposed_by, approved_by, effective_from, review_date) VALUES ((SELECT id FROM fx WHERE k='orgA'), NULL, 40, (SELECT id FROM fx WHERE k='cisoA'), (SELECT id FROM fx WHERE k='boardA'), '2026-01-01', '2027-01-01')$$,
  'uq_appetite', 'one enterprise appetite per effective date (NULLS NOT DISTINCT)');

-- ------------------------------------------------- connectors, runs, signals, coverage
INSERT INTO org_connectors(org_id, category_id, product_name, pattern, schedule_minutes, credential_ref)
  SELECT pg_temp.f('orgA'), category_id, 'prod_'||code, 'api_pull', 60, 'vault:secret/a/'||code FROM tool_categories WHERE code IN ('edr_xdr','siem_soar','immutable_backup','dr_testing','cspm');
SELECT pg_temp.fails($$INSERT INTO org_connectors(org_id, category_id, product_name, pattern, schedule_minutes, credential_ref)
  SELECT org_id, category_id, 'bad', 'api_pull', 60, 'Password=Hunter2!' FROM org_connectors LIMIT 1$$, 'ck_credential_is_reference', 'a pasted secret is rejected as credential_ref');
INSERT INTO ingestion_runs(org_id, connector_id, started_at, finished_at, status, rows_in, rows_rejected)
  SELECT org_id, connector_id, now() - interval '10 minutes', now() - interval '9 minutes', 'success', 100, 1 FROM org_connectors;
SELECT pg_temp.ok((SELECT bool_and(rejected_rate = 0.0100) FROM ingestion_runs), 'rejected_rate computed (1/100)');
SELECT pg_temp.fails($$INSERT INTO ingestion_runs(org_id, connector_id, rows_in, rows_rejected) SELECT org_id, connector_id, 5, 9 FROM org_connectors LIMIT 1$$, 'ck_rejected_le_in', 'rejected rows cannot exceed rows in');

-- Ransomware gaps 52/30/50/75 % with weights 25/20/25/30 => raw 54.0 (the deck's worked example); cloud gap 21 %.
INSERT INTO control_signals(org_id, category_id, run_id, observed_at, numerator, denominator)
  SELECT r.org_id, c.category_id, r.run_id, now() - interval '5 minutes',
         CASE t.code WHEN 'edr_xdr' THEN 48 WHEN 'siem_soar' THEN 70 WHEN 'immutable_backup' THEN 50 WHEN 'dr_testing' THEN 25 WHEN 'cspm' THEN 79 END, 100
  FROM ingestion_runs r JOIN org_connectors c USING (connector_id) JOIN tool_categories t ON t.category_id = c.category_id;
SELECT pg_temp.ok((SELECT raw_score FROM fn_domain_raw_score(pg_temp.f('orgA'), pg_temp.d('ransomware_readiness'), pg_temp.f('pol1'))) = 54.00, 'ransomware raw score = 54.0 from control signals');
SELECT pg_temp.ok((SELECT raw_score FROM fn_domain_raw_score(pg_temp.f('orgA'), pg_temp.d('cspm_cnapp'), pg_temp.f('pol1'))) = 21.00, 'cloud raw score = 21.0');
SELECT pg_temp.fails($$INSERT INTO control_signals(org_id, category_id, run_id, observed_at, numerator, denominator) SELECT org_id, category_id, run_id, now(), 11, 10 FROM control_signals LIMIT 1$$,
  'ck_num_le_den', 'numerator above denominator rejected');
SELECT pg_temp.fails($$UPDATE control_signals SET numerator = 0$$, 'append-only', 'control signals are append-only');

INSERT INTO business_units(org_id, name, key_processes, criticality_tier) VALUES (pg_temp.f('orgA'), 'Payments', '{card payments}', 1);
INSERT INTO asset_inventory(org_id, external_ref, name, asset_type, criticality_tier, crown_jewel, internet_facing, business_unit_id)
  SELECT pg_temp.f('orgA'), 'a'||g, 'asset '||g, 'server', CASE WHEN g=1 THEN 1 ELSE 2 END, g=1, g<=2,
         (SELECT business_unit_id FROM business_units WHERE name='Payments') FROM generate_series(1,4) g;
INSERT INTO asset_coverage(asset_id, org_id, category_id, in_scope, last_seen_at)
  SELECT a.asset_id, a.org_id, t.category_id, true, CASE WHEN t.code='cspm' AND a.external_ref='a4' THEN NULL ELSE now() - interval '1 hour' END
  FROM asset_inventory a CROSS JOIN tool_categories t WHERE t.code IN ('edr_xdr','siem_soar','immutable_backup','dr_testing','cspm');
SELECT pg_temp.ok((SELECT coverage FROM v_category_coverage WHERE category_id = pg_temp.c('cspm')) = 0.750, 'cloud coverage = 0.75 (3 of 4 assets seen)');

-- ------------------------------------------------------------------ domain scores
SELECT sp_score_domain(pg_temp.f('orgA'), pg_temp.d('cspm_cnapp'), pg_temp.f('pol1'), now());
SELECT pg_temp.ok((SELECT adjusted_score FROM domain_scores WHERE org_id = pg_temp.f('orgA') AND risk_domain_id = pg_temp.d('cspm_cnapp')) = 30.75, 'cloud adjusted = 0.75 x 21 + 0.25 x 60 = 30.75');
SELECT pg_temp.ok((SELECT band FROM domain_scores WHERE org_id = pg_temp.f('orgA') AND risk_domain_id = pg_temp.d('cspm_cnapp')) = 'low', 'cloud band = low');
SELECT pg_temp.ok((SELECT confidence FROM domain_scores WHERE org_id = pg_temp.f('orgA') AND risk_domain_id = pg_temp.d('cspm_cnapp')) = round(1 * 0.75 * (1 - 0.01), 3), 'confidence = fresh/total x coverage x (1 - rejected)');
SELECT sp_score_domain(pg_temp.f('orgA'), pg_temp.d('ransomware_readiness'), pg_temp.f('pol1'), now(), 'Only 7 of 28 recovery tests met target');
SELECT pg_temp.ok((SELECT adjusted_score FROM domain_scores WHERE org_id = pg_temp.f('orgA') AND risk_domain_id = pg_temp.d('ransomware_readiness')) = 54.00, 'ransomware at full coverage: adjusted = raw = 54.0');
SELECT pg_temp.ok((SELECT band FROM domain_scores WHERE org_id = pg_temp.f('orgA') AND risk_domain_id = pg_temp.d('ransomware_readiness')) = 'medium', 'ransomware 54.0 = medium');
SELECT pg_temp.ok((SELECT count(*) = 4 AND sum(points) = 54.00 FROM domain_score_components c JOIN domain_scores s USING (score_id) WHERE s.org_id = pg_temp.f('orgA') AND s.risk_domain_id = pg_temp.d('ransomware_readiness')),
  'score explanation: 4 components whose points sum to the raw score');
SELECT pg_temp.ok((SELECT max(points) FROM domain_score_components c JOIN domain_scores s USING (score_id) WHERE s.org_id = pg_temp.f('orgA') AND s.risk_domain_id = pg_temp.d('ransomware_readiness')) = 22.50,
  'largest driver is DR / recovery testing (30 x 75% = 22.5 points)');
SELECT pg_temp.fails($$SELECT sp_score_domain((SELECT id FROM fx WHERE k='orgA'), (SELECT risk_domain_id FROM risk_domains WHERE code='iam_pam'), (SELECT id FROM fx WHERE k='pol1'))$$,
  'refusing to score silently', 'a domain with no signals is not silently scored');
SELECT pg_temp.fails($$SELECT sp_score_domain((SELECT id FROM fx WHERE k='orgB'), (SELECT risk_domain_id FROM risk_domains WHERE code='cspm_cnapp'), (SELECT id FROM fx WHERE k='pol1'))$$,
  'does not belong', 'a tenant cannot be scored under another tenant''s policy');
SELECT pg_temp.fails($$UPDATE domain_scores SET raw_score = 1$$, 'append-only', 'domain score snapshots cannot be edited');
SELECT pg_temp.fails($$INSERT INTO domain_scores(org_id,risk_domain_id,policy_id,snapshot_at,raw_score,coverage,unobserved_default,adjusted_score,feeds_total,feeds_fresh,confidence,band)
  SELECT org_id, risk_domain_id, policy_id, now() + interval '1 day', 50, 1.5, 60, 0, 1, 1, 0, 'low' FROM domain_scores LIMIT 1$$, 'coverage', 'coverage above 1 rejected');

-- ------------------------------------------------------------------ enterprise headline and floor rule
DELETE FROM domain_scores WHERE org_id = pg_temp.f('orgA');   -- fixture org only; seed rows untouched outside this txn
INSERT INTO domain_scores(org_id,risk_domain_id,policy_id,snapshot_at,raw_score,coverage,unobserved_default,adjusted_score,feeds_total,feeds_fresh,confidence,band)
  SELECT pg_temp.f('orgA'), d.risk_domain_id, pg_temp.f('pol1'), TIMESTAMPTZ '2026-10-01 00:00:00+00',
         (ARRAY[75,72,60,58,45,40,38,36,20,18,15,10])[row_number() over (order by d.code)], 1, 60, 0, 2, 2, 0, 'low'
  FROM risk_domains d;
SELECT pg_temp.ok((SELECT n_critical + n_high + n_medium + n_low FROM fn_enterprise_headline(pg_temp.f('orgA'), TIMESTAMPTZ '2026-10-01 00:00:00+00')) = 12, '12 subscribed domains roll up');
UPDATE org_domain_subscriptions SET is_active = false WHERE org_id = pg_temp.f('orgA') AND risk_domain_id = pg_temp.d('ot_ics');
SELECT pg_temp.ok((SELECT n_critical + n_high + n_medium + n_low FROM fn_enterprise_headline(pg_temp.f('orgA'), TIMESTAMPTZ '2026-10-01 00:00:00+00')) = 11, 'an unsubscribed domain drops out of the enterprise roll-up');
UPDATE org_domain_subscriptions SET is_active = true WHERE org_id = pg_temp.f('orgA') AND risk_domain_id = pg_temp.d('ot_ics');
SELECT sp_snapshot_enterprise(pg_temp.f('orgA'), TIMESTAMPTZ '2026-10-01 00:00:00+00', 'Driven by attack surface and SOC');
INSERT INTO fx SELECT 'snap1', snapshot_id FROM enterprise_scores WHERE org_id = pg_temp.f('orgA') AND snapshot_at = TIMESTAMPTZ '2026-10-01 00:00:00+00';
SELECT pg_temp.ok((SELECT arithmetic_score FROM enterprise_scores WHERE snapshot_id = pg_temp.f('snap1')) = 40.58, 'enterprise arithmetic score = weighted mean (40.58)');
SELECT pg_temp.ok((SELECT arithmetic_band FROM enterprise_scores WHERE snapshot_id = pg_temp.f('snap1')) = 'medium', 'arithmetic band = medium');
SELECT pg_temp.ok((SELECT displayed_band FROM enterprise_scores WHERE snapshot_id = pg_temp.f('snap1')) = 'high', 'displayed band = high (floor rule: a Critical domain exists)');
SELECT pg_temp.ok((SELECT floor_applied FROM enterprise_scores WHERE snapshot_id = pg_temp.f('snap1')), 'floor_applied is flagged');
SELECT pg_temp.ok((SELECT (n_critical, n_high, n_medium, n_low) FROM enterprise_scores WHERE snapshot_id = pg_temp.f('snap1')) = ROW(2,2,4,4), 'spread by band = 2 / 2 / 4 / 4');
SELECT pg_temp.ok((SELECT n_outside_appetite FROM enterprise_scores WHERE snapshot_id = pg_temp.f('snap1')) = 1, 'SOC (75) is outside its appetite (45): 1 domain outside');
SELECT pg_temp.fails($$UPDATE enterprise_scores SET displayed_band = 'low' WHERE snapshot_id=(SELECT id FROM fx WHERE k='snap1')$$, 'append-only', 'enterprise snapshots cannot be edited');
SELECT pg_temp.fails($$INSERT INTO enterprise_scores(org_id,policy_id,snapshot_at,arithmetic_score,arithmetic_band,displayed_band,floor_applied,n_critical,n_high,n_medium,n_low,confidence)
  VALUES ((SELECT id FROM fx WHERE k='orgA'),(SELECT id FROM fx WHERE k='pol1'),now(),60,'high','medium',true,0,1,0,0,.5)$$, 'ck_floor_never_lowers', 'the displayed band can never be below the arithmetic band');
SELECT pg_temp.fails($$INSERT INTO enterprise_scores(org_id,policy_id,snapshot_at,arithmetic_score,arithmetic_band,displayed_band,floor_applied,n_critical,n_high,n_medium,n_low,confidence)
  VALUES ((SELECT id FROM fx WHERE k='orgA'),(SELECT id FROM fx WHERE k='pol1'),now(),40,'medium','high',false,1,0,0,0,.5)$$, 'ck_floor_consistent', 'floor_applied must match the band difference');
INSERT INTO enterprise_loss_estimates(snapshot_id, org_id, ale_expected, ale_p90, ale_p95) VALUES (pg_temp.f('snap1'), pg_temp.f('orgA'), 2890000, 10070000, 14940000);
SELECT pg_temp.ok((SELECT currency FROM enterprise_loss_estimates WHERE snapshot_id = pg_temp.f('snap1')) = 'AED', 'currency defaults to the organisation''s reporting currency');
SELECT pg_temp.fails($$INSERT INTO enterprise_loss_estimates(snapshot_id, org_id, ale_expected, ale_p90, ale_p95) VALUES ((SELECT id FROM fx WHERE k='snap1'), (SELECT id FROM fx WHERE k='orgA'), 1, 5, 9)$$,
  'enterprise_loss_estimates_pkey', 'one loss estimate per enterprise snapshot');
SELECT pg_temp.ok((SELECT displayed_band = 'high' AND ale_expected = 2890000 FROM v_enterprise_headline WHERE org_id = pg_temp.f('orgA')), 'headline view joins band and money');

-- second snapshot one week later: SOC +2, ransomware -2.4 (same policy)
-- Use explicit timestamptz bounds so movers are timezone-stable (date casts vary by session TZ).
INSERT INTO domain_scores(org_id,risk_domain_id,policy_id,snapshot_at,raw_score,coverage,unobserved_default,adjusted_score,feeds_total,feeds_fresh,confidence,band)
  SELECT org_id, risk_domain_id, policy_id, TIMESTAMPTZ '2026-10-08 00:00:00+00',
         raw_score + CASE WHEN risk_domain_id = pg_temp.d('soc_mdr') THEN 2 WHEN risk_domain_id = pg_temp.d('ransomware_readiness') THEN -2.4 ELSE 0 END,
         1, 60, 0, 2, 2, 0, 'low'
  FROM domain_scores WHERE org_id = pg_temp.f('orgA') AND snapshot_at = TIMESTAMPTZ '2026-10-01 00:00:00+00';
SELECT pg_temp.ok((SELECT delta FROM fn_domain_movers(pg_temp.f('orgA'), TIMESTAMPTZ '2026-10-01 00:00:00+00', TIMESTAMPTZ '2026-10-08 00:00:00+00') WHERE domain_code='ransomware_readiness') = -2.40
  AND (SELECT bool_and(same_policy) FROM fn_domain_movers(pg_temp.f('orgA'), TIMESTAMPTZ '2026-10-01 00:00:00+00', TIMESTAMPTZ '2026-10-08 00:00:00+00')), 'what changed: movers computed under the same policy');

-- ------------------------------------------------------------------ findings, priority, SLA, dedup
INSERT INTO risk_findings(org_id, risk_domain_id, title, severity, asset_id, cve_id, kev_listed, epss, owner_user_id, source_category_id, external_ref)
  SELECT pg_temp.f('orgA'), pg_temp.d('vapt_asm'), 'KEV on tier-1 internet-facing gateway', 'critical', asset_id, 'CVE-2026-1234', true, 0.84, pg_temp.f('anA'), pg_temp.c('vuln_management'), 'VM-1001'
  FROM asset_inventory WHERE external_ref='a1';
INSERT INTO fx SELECT 'kev', finding_id FROM risk_findings WHERE cve_id='CVE-2026-1234';
SELECT pg_temp.ok((SELECT priority_score FROM risk_findings WHERE finding_id = pg_temp.f('kev')) = 1.000, 'priority = KEV(1.0) x crown jewel(1.0) x internet(1.0) = 1.000');
INSERT INTO risk_findings(org_id, risk_domain_id, title, severity, asset_id, cve_id, epss)
  SELECT pg_temp.f('orgA'), pg_temp.d('vapt_asm'), 'Low EPSS on internal tier-2', 'medium', asset_id, 'CVE-2026-9999', 0.05 FROM asset_inventory WHERE external_ref='a3';
SELECT pg_temp.ok((SELECT priority_score FROM risk_findings WHERE cve_id='CVE-2026-9999') = round(0.1*0.6*0.5, 3), 'priority = max(EPSS,0.1) x tier-2(0.6) x internal(0.5) = 0.030');
SELECT pg_temp.ok((SELECT sla_due_at - detected_at FROM risk_findings WHERE finding_id = pg_temp.f('kev')) = interval '7 days', 'critical SLA = detected + 7 days from the active policy');
SELECT pg_temp.fails($$INSERT INTO risk_findings(org_id, risk_domain_id, title, severity, source_category_id, external_ref) SELECT org_id, risk_domain_id, 'dup', 'low', source_category_id, external_ref FROM risk_findings WHERE external_ref='VM-1001'$$,
  'uq_finding_dedup', 'the same upstream finding cannot be ingested twice');
SELECT pg_temp.fails($$INSERT INTO risk_findings(org_id, risk_domain_id, title, severity, cve_id) SELECT org_id, risk_domain_id, 't', 'low', 'CVE-26-1' FROM risk_findings LIMIT 1$$, 'ck_cve_format', 'malformed CVE id rejected');
SELECT pg_temp.fails($$INSERT INTO risk_findings(org_id, risk_domain_id, title, severity, status) SELECT org_id, risk_domain_id, 't', 'low', 'verified_closed' FROM risk_findings LIMIT 1$$,
  'cannot start as', 'a new finding cannot start closed');
SELECT pg_temp.fails($$INSERT INTO risk_findings(org_id, risk_domain_id, title, severity, owner_user_id) VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT risk_domain_id FROM risk_domains WHERE code='vapt_asm'), 'x', 'low', (SELECT id FROM fx WHERE k='cxoB'))$$,
  'foreign key', 'a finding cannot be owned by a user from another tenant');

-- ------------------------------------------------------------------ closed loop
INSERT INTO treatment_plans(org_id, treatment, finding_id, owner_user_id, description) VALUES (pg_temp.f('orgA'), 'mitigate', pg_temp.f('kev'), pg_temp.f('anA'), 'Emergency patch window');
INSERT INTO remediation_actions(org_id, plan_id, finding_id, title, owner_user_id, due_at)
  SELECT pg_temp.f('orgA'), plan_id, pg_temp.f('kev'), 'Apply vendor patch', pg_temp.f('anA'), now() + interval '7 days' FROM treatment_plans;
UPDATE remediation_actions SET status = 'done';
SELECT pg_temp.ok((SELECT status FROM risk_findings WHERE finding_id = pg_temp.f('kev')) = 'fix_reported', 'finishing the action reports a fix; it does not close the finding');
SELECT pg_temp.ok((SELECT completed_at IS NOT NULL FROM remediation_actions), 'action completion is stamped');
SELECT pg_temp.fails($$UPDATE risk_findings SET status='verified_closed' WHERE cve_id='CVE-2026-1234'$$, 'no passing verification', 'a finding cannot close without a passing verification');
SELECT pg_temp.ok(sp_verify_finding(pg_temp.f('kev'), 'fail', '{"scan":"still vulnerable"}') = 'reopened', 'failed re-scan reopens the finding');
UPDATE risk_findings SET status='fix_reported' WHERE finding_id = pg_temp.f('kev');
SELECT pg_temp.ok(sp_verify_finding(pg_temp.f('kev'), 'pass', '{"scan":"clean"}') = 'verified_closed', 'passing re-scan closes the finding');
SELECT pg_temp.ok((SELECT verified_at IS NOT NULL AND resolved_at IS NOT NULL FROM risk_findings WHERE finding_id = pg_temp.f('kev')), 'verified_at and resolved_at stamped');
SELECT pg_temp.fails($$UPDATE risk_findings SET status='open' WHERE cve_id='CVE-2026-1234'$$, 'only move to reopened', 'a verified-closed finding can only be reopened');
SELECT pg_temp.ok((SELECT count(*) FROM finding_verifications) = 2, 'both verifications are kept as evidence');
SELECT pg_temp.fails($$UPDATE finding_verifications SET result='pass'$$, 'append-only', 'verification evidence cannot be edited');
SELECT pg_temp.ok((SELECT mean_days_to_remediate FROM v_mttr_by_domain WHERE domain_code='vapt_asm') IS NOT NULL, 'MTTR view reports verified closures');
SELECT pg_temp.ok((SELECT count(*) FROM command_center_activity WHERE activity_type='verification_completed') = 2, 'each verification outcome lands in the activity feed');
UPDATE risk_findings SET status='reopened' WHERE finding_id = pg_temp.f('kev');
UPDATE risk_findings SET status='fix_reported' WHERE finding_id = pg_temp.f('kev');
SELECT pg_temp.fails($$UPDATE risk_findings SET status='verified_closed' WHERE cve_id='CVE-2026-1234'$$, 'since the fix was reported', 'an old pass does not close a newly reported fix');
SELECT pg_temp.fails($$INSERT INTO finding_verifications(org_id, finding_id, result, verified_by) VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT id FROM fx WHERE k='kev'), 'pass', (SELECT id FROM fx WHERE k='boardA'))$$,
  'lacks capability verify_findings', 'a board member cannot record a manual verification');

-- ------------------------------------------------------------------ risk acceptance
INSERT INTO risk_findings(org_id, risk_domain_id, title, severity, owner_user_id)
  VALUES (pg_temp.f('orgA'), pg_temp.d('iam_pam'), 'Legacy admin accounts', 'critical', pg_temp.f('cxoA'));
INSERT INTO fx SELECT 'legacy', finding_id FROM risk_findings WHERE title='Legacy admin accounts';
SELECT pg_temp.fails($$UPDATE risk_findings SET status='accepted_risk' WHERE title='Legacy admin accounts'$$, 'no active risk acceptance', 'cannot mark accepted without a register entry');
SELECT pg_temp.fails($$INSERT INTO risk_acceptances(org_id, finding_id, reason, reason_category, approver_user_id, expires_at)
  VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT id FROM fx WHERE k='legacy'), 'Vendor migration pending until Q1', 'business_need', (SELECT id FROM fx WHERE k='anA'), now() + interval '30 days')$$,
  'lacks capability accept_risk', 'an analyst cannot approve a risk acceptance');
SELECT pg_temp.fails($$INSERT INTO risk_acceptances(org_id, finding_id, reason, reason_category, approver_user_id, expires_at)
  VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT id FROM fx WHERE k='legacy'), 'Vendor migration pending until Q1', 'business_need', (SELECT id FROM fx WHERE k='boardA'), now() + interval '30 days')$$,
  'lacks capability accept_risk', 'a board member cannot sign an acceptance (view and comment only)');
SELECT pg_temp.fails($$INSERT INTO risk_acceptances(org_id, finding_id, reason, reason_category, approver_user_id, expires_at)
  VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT id FROM fx WHERE k='legacy'), 'Vendor migration pending until Q1', 'business_need', (SELECT id FROM fx WHERE k='cisoA'), now() + interval '30 days')$$,
  'lacks capability accept_risk', 'a CISO cannot sign an acceptance');
SELECT pg_temp.fails($$INSERT INTO risk_acceptances(org_id, finding_id, reason, reason_category, approver_user_id, expires_at)
  VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT id FROM fx WHERE k='legacy'), 'Vendor migration pending until Q1', 'business_need', (SELECT id FROM fx WHERE k='cxoA'), now() + interval '30 days')$$,
  'cannot approve their own', 'the finding owner cannot approve their own acceptance');
SELECT pg_temp.fails($$INSERT INTO risk_acceptances(org_id, finding_id, reason, reason_category, approver_user_id, expires_at)
  VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT id FROM fx WHERE k='legacy'), 'Vendor migration pending until Q1', 'business_need', (SELECT id FROM fx WHERE k='cfoA'), now() + interval '120 days')$$,
  '90 day limit', 'a Critical finding cannot be accepted for more than 90 days');
SELECT pg_temp.fails($$INSERT INTO risk_acceptances(org_id, finding_id, reason, reason_category, approver_user_id, expires_at)
  VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT id FROM fx WHERE k='legacy'), 'short', 'cost', (SELECT id FROM fx WHERE k='cfoA'), now() + interval '30 days')$$,
  'reason', 'a one-word reason is rejected');
-- Risk Lead may accept (product decision) when not the finding owner
INSERT INTO risk_acceptances(org_id, finding_id, reason, reason_category, approver_user_id, expires_at)
  VALUES (pg_temp.f('orgA'), pg_temp.f('legacy'), 'Vendor migration pending until Q1', 'business_need', pg_temp.f('riskA'), now() + interval '60 days');
UPDATE risk_findings SET status='accepted_risk' WHERE finding_id = pg_temp.f('legacy');
SELECT pg_temp.ok((SELECT status FROM risk_findings WHERE finding_id = pg_temp.f('legacy')) = 'accepted_risk'
  AND (SELECT approver_user_id FROM risk_acceptances WHERE finding_id = pg_temp.f('legacy') AND status='active') = pg_temp.f('riskA'),
  'risk lead can accept a finding they do not own');
SELECT pg_temp.fails($$INSERT INTO risk_acceptances(org_id, finding_id, reason, reason_category, approver_user_id, expires_at)
  VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT id FROM fx WHERE k='legacy'), 'Second acceptance attempt here', 'cost', (SELECT id FROM fx WHERE k='cfoA'), now() + interval '30 days')$$,
  'uq_one_active_acceptance', 'only one active acceptance per finding');
SELECT pg_temp.fails($$UPDATE risk_acceptances SET reason = 'edited after approval, so rejected'$$, 'immutable', 'acceptance reason cannot be rewritten');
SELECT pg_temp.fails($$UPDATE risk_acceptances SET expires_at = now() + interval '200 days'$$, 'renewal exceeds', 'a renewal obeys the same 90-day limit for Critical');
UPDATE risk_acceptances SET expires_at = now() + interval '80 days';
SELECT pg_temp.ok((SELECT renewal_count FROM risk_acceptances) = 1, 'renewal counted');
SELECT pg_temp.ok(sp_expire_acceptances(now() + interval '81 days') = 1, 'expiry job expires 1 acceptance after its date');
SELECT pg_temp.ok((SELECT status FROM risk_findings WHERE finding_id = pg_temp.f('legacy')) = 'reopened', 'expired acceptance reopens the finding');
SELECT pg_temp.ok((SELECT count(*) FROM v_decision_queue WHERE decision_type='renew_acceptance' AND finding_id = pg_temp.f('legacy')) = 1, 'expiry puts a renewal decision back on the agenda');
-- CxO can also accept (second finding)
INSERT INTO risk_findings(org_id, risk_domain_id, title, severity, owner_user_id)
  VALUES (pg_temp.f('orgA'), pg_temp.d('phishing_bec'), 'Legacy mail gateway relay', 'high', pg_temp.f('anA'));
INSERT INTO fx SELECT 'relay', finding_id FROM risk_findings WHERE title='Legacy mail gateway relay';
INSERT INTO risk_acceptances(org_id, finding_id, reason, reason_category, approver_user_id, expires_at)
  VALUES (pg_temp.f('orgA'), pg_temp.f('relay'), 'Compensating controls until gateway cutover', 'cost', pg_temp.f('cxoA'), now() + interval '90 days');
SELECT pg_temp.ok((SELECT approver_user_id FROM risk_acceptances WHERE finding_id = pg_temp.f('relay')) = pg_temp.f('cxoA'),
  'cxo can accept a finding they do not own');

-- ------------------------------------------------------------------ decisions
INSERT INTO executive_decisions(org_id, decision_type, title, priority, risk_summary, impact_summary, recommended_action, finding_id)
  VALUES (pg_temp.f('orgA'), 'approve_fix', 'Patch the payment gateway', 'critical', 'r', 'i', 'Emergency patch window', pg_temp.f('kev'));
INSERT INTO fx SELECT 'dec1', decision_id FROM executive_decisions WHERE title='Patch the payment gateway';
SELECT pg_temp.fails($$UPDATE executive_decisions SET status='approved', decided_by=(SELECT id FROM fx WHERE k='anA') WHERE decision_id=(SELECT id FROM fx WHERE k='dec1')$$,
  'lacks capability approve_decisions', 'an analyst cannot approve a decision');
SELECT pg_temp.fails($$UPDATE executive_decisions SET status='approved', decided_by=(SELECT id FROM fx WHERE k='boardA') WHERE decision_id=(SELECT id FROM fx WHERE k='dec1')$$,
  'lacks capability approve_decisions', 'a board member cannot approve a decision');
UPDATE executive_decisions SET status='approved', decided_by=pg_temp.f('cxoA'), decision_notes='Go' WHERE decision_id=pg_temp.f('dec1');
SELECT pg_temp.ok((SELECT decided_at IS NOT NULL FROM executive_decisions WHERE decision_id=pg_temp.f('dec1')), 'decided_at stamped');
SELECT pg_temp.ok((SELECT array_agg(new_status::text ORDER BY acted_at) FROM decision_action_log WHERE decision_id=pg_temp.f('dec1')) = '{awaiting_decision,approved}'
  AND (SELECT actor_user_id FROM decision_action_log WHERE decision_id=pg_temp.f('dec1') AND new_status='approved') = pg_temp.f('cxoA'), 'decision log records each status change and the actor');
SELECT pg_temp.fails($$UPDATE decision_action_log SET notes='x'$$, 'append-only', 'decision log is append-only');
SELECT pg_temp.fails($$INSERT INTO executive_decisions(org_id, decision_type, title, priority, risk_summary, impact_summary, recommended_action, status, decided_by)
  VALUES ((SELECT id FROM fx WHERE k='orgA'), 'accept_risk', 'Accept without register', 'high', 'r', 'i', 'a', 'approved', (SELECT id FROM fx WHERE k='cxoA'))$$,
  'must reference its risk_acceptances', 'an approved accept-risk decision must point at its register entry');

-- ------------------------------------------------------------------ scenarios, impact, loss, what-if
INSERT INTO risk_scenarios(org_id, title, primary_domain_id, likelihood, impact, rationale)
  VALUES (pg_temp.f('orgA'), 'Payment gateway compromise', pg_temp.d('vapt_asm'), 4, 5, 'KEV-listed CVE on an internet-facing crown jewel');
INSERT INTO fx SELECT 'scen', scenario_id FROM risk_scenarios;
INSERT INTO scenario_findings(scenario_id, finding_id, org_id) VALUES (pg_temp.f('scen'), pg_temp.f('kev'), pg_temp.f('orgA')), (pg_temp.f('scen'), pg_temp.f('legacy'), pg_temp.f('orgA'));
SELECT pg_temp.ok((SELECT risk_rating FROM risk_scenarios) = 20, 'scenario rating = likelihood x impact (explainable)');
SELECT pg_temp.ok((SELECT count(DISTINCT f.risk_domain_id) FROM scenario_findings s JOIN risk_findings f USING (finding_id)) = 2, 'a scenario correlates findings across domains');
SELECT pg_temp.fails($$INSERT INTO business_impact_assessments(org_id, scenario_id, financial_exposure_amount, basis) VALUES ((SELECT id FROM fx WHERE k='orgA'), (SELECT id FROM fx WHERE k='scen'), 2100000, '')$$,
  'ck_basis_present', 'an amount without a stated basis is rejected (no invented money)');
SELECT pg_temp.fails($$INSERT INTO business_impact_assessments(org_id, basis) VALUES ((SELECT id FROM fx WHERE k='orgA'), 'finance estimate')$$,
  'ck_impact_subject', 'an impact must be about a finding or a scenario');
INSERT INTO business_impact_assessments(org_id, scenario_id, financial_exposure_amount, downtime_cost_per_hour, regulatory_impact, basis, assessed_by)
  VALUES (pg_temp.f('orgA'), pg_temp.f('scen'), 2100000, 85000, 'PCI DSS scope', 'Finance BIA 2026, payments line', pg_temp.f('cfoA'));
INSERT INTO business_impact_assessments(org_id, finding_id, basis) VALUES (pg_temp.f('orgA'), pg_temp.f('legacy'), 'Not yet assessed by finance');
SELECT pg_temp.ok((SELECT count(*) FROM business_impact_assessments WHERE financial_exposure_amount IS NULL) = 1, 'unknown money stays NULL');
SELECT pg_temp.fails($$INSERT INTO loss_models(org_id, scenario_name, model_version, lef_min, lef_mode, lef_max, vuln_min, vuln_mode, vuln_max, mag_min, mag_mode, mag_max, draws, seed, input_source)
  VALUES ((SELECT id FROM fx WHERE k='orgA'), 'bad', 'v1', 0.5, 0.2, 1, .1, .2, .3, 1, 2, 3, 10000, 42, 'x')$$, 'ck_lef_order', 'PERT inputs must satisfy min <= mode <= max');
SELECT pg_temp.fails($$INSERT INTO loss_models(org_id, scenario_name, model_version, lef_min, lef_mode, lef_max, vuln_min, vuln_mode, vuln_max, mag_min, mag_mode, mag_max, draws, seed, input_source)
  VALUES ((SELECT id FROM fx WHERE k='orgA'), 'few', 'v1', 0.1, 0.2, 1, .1, .2, .3, 1, 2, 3, 100, 42, 'x')$$, 'draws', 'a simulation needs at least 1000 draws');
INSERT INTO loss_models(org_id, scenario_id, finding_id, risk_domain_id, scenario_name, model_version, lef_min, lef_mode, lef_max, vuln_min, vuln_mode, vuln_max,
                        mag_min, mag_mode, mag_max, draws, seed, ale_mean, annual_p90, annual_p95, input_source)
  VALUES (pg_temp.f('orgA'), pg_temp.f('scen'), pg_temp.f('kev'), pg_temp.d('vapt_asm'), 'Payment gateway compromise', 'v1', 0.1, 0.3, 1, 0.2, 0.4, 0.7,
          500000, 2000000, 9000000, 200000, 42, 610000, 2750000, 4220000, 'Workshop with Payments and Finance, Sep 2026');
INSERT INTO whatif_scenarios(org_id, name, policy_id, base_snapshot_id, changes, score_before, score_after, band_before, band_after, headline_after, ale_before, ale_after, cost_estimate, created_by)
  VALUES (pg_temp.f('orgA'), 'C. Immutable backup + recovery testing', pg_temp.f('pol1'), pg_temp.f('snap1'), '{"immutable_backup":{"gap":0.10},"dr_testing":{"gap":0.35}}',
          55.2, 37.6, 'high', 'medium', 'high', 1780000, 1210000, 1500000, pg_temp.f('cxoA'));
INSERT INTO executive_decisions(org_id, decision_type, title, priority, risk_summary, impact_summary, recommended_action, whatif_id)
  SELECT pg_temp.f('orgA'), 'fund_scenario', 'Fund recovery uplift', 'high', 'r', 'i', 'a', whatif_id FROM whatif_scenarios;
SELECT pg_temp.ok((SELECT count(*) FROM v_decision_queue WHERE decision_type='fund_scenario') = 1, 'a funding decision links to its what-if');
SELECT pg_temp.ok((SELECT ale_mean FROM v_decision_queue WHERE finding_id = pg_temp.f('kev')) IS NULL, 'approved decisions leave the queue');

-- ------------------------------------------------------------------ compliance
INSERT INTO framework_controls(framework_id, control_ref, title, risk_domain_id)
  SELECT framework_id, '11.3.2', 'External vulnerability scans', pg_temp.d('vapt_asm') FROM compliance_frameworks WHERE code='pci_dss_v4';
INSERT INTO control_assessments(org_id, control_id, status, finding_id, assessed_by)
  SELECT pg_temp.f('orgA'), control_id, 'partial', pg_temp.f('kev'), pg_temp.f('cisoA') FROM framework_controls;
INSERT INTO org_compliance_status(org_id, framework_id, coverage_pct, controls_total, controls_evidenced)
  SELECT pg_temp.f('orgA'), framework_id, 92, 250, 230 FROM compliance_frameworks WHERE code='pci_dss_v4';
SELECT pg_temp.ok((SELECT coverage_pct FROM v_compliance_posture WHERE code='pci_dss_v4') = 92, 'compliance posture view');
SELECT pg_temp.fails($$INSERT INTO org_compliance_status(org_id, framework_id, coverage_pct, controls_total, controls_evidenced) SELECT (SELECT id FROM fx WHERE k='orgA'), framework_id, 90, 10, 11 FROM compliance_frameworks LIMIT 1$$,
  'ck_evidenced_le_total', 'evidenced controls cannot exceed the total');

-- ------------------------------------------------------------------ board pack
INSERT INTO board_packs(org_id, period_start, period_end, enterprise_snapshot_id, content)
  VALUES (pg_temp.f('orgA'), '2026-07-01', '2026-09-30', pg_temp.f('snap1'), '{"headline":{"text":"Cyber risk is High","source":"enterprise_scores"}}');
SELECT pg_temp.fails($$UPDATE board_packs SET status='reviewed', reviewed_by=(SELECT id FROM fx WHERE k='anA'), reviewed_at=now()$$, 'lacks capability review_board_pack', 'an analyst cannot review the board pack');
UPDATE board_packs SET status='reviewed', reviewed_by=pg_temp.f('cisoA'), reviewed_at=now();
SELECT pg_temp.fails($$UPDATE board_packs SET status='approved', approved_by=(SELECT id FROM fx WHERE k='cisoA'), approved_at=now()$$, 'different people', 'the reviewer cannot also approve');
UPDATE board_packs SET status='approved', approved_by=pg_temp.f('cxoA'), approved_at=now();
SELECT pg_temp.fails($$UPDATE board_packs SET content='{"headline":"Low"}'$$, 'frozen', 'an approved board pack is frozen');
INSERT INTO report_exports(org_id, pack_id, report_type, file_uri, sha256, generated_by)
  SELECT pg_temp.f('orgA'), pack_id, 'board_pack', 's3://packs/q3.pdf', encode(digest('pdf','sha256'),'hex'), pg_temp.f('cxoA') FROM board_packs;
SELECT pg_temp.ok((SELECT count(*) FROM report_exports) = 1, 'export recorded with its checksum');

-- ------------------------------------------------------------------ audit chain
SELECT pg_temp.ok((SELECT count(*) FROM audit_log WHERE entity_type='scoring_policy') >= 2, 'policy changes were audited');
SELECT pg_temp.ok((SELECT count(*) FROM audit_log WHERE entity_type='users') >= 6, 'user creation and role changes are audited');
SELECT pg_temp.ok((SELECT count(*) FROM fn_verify_audit_chain()) = 0, 'audit chain verifies intact');
SELECT pg_temp.fails($$UPDATE audit_log SET action = 'x'$$, 'append-only', 'audit rows cannot be updated');
SELECT pg_temp.fails($$DELETE FROM audit_log$$, 'append-only', 'audit rows cannot be deleted');
SELECT pg_temp.fails($$TRUNCATE audit_log$$, 'append-only', 'audit log cannot be truncated');
SAVEPOINT before_tamper;
ALTER TABLE audit_log DISABLE TRIGGER trg_audit_no_update;
UPDATE audit_log SET new_value = '{"forged":true}' WHERE log_id = (SELECT min(log_id) FROM audit_log WHERE org_id = (SELECT id FROM fx WHERE k='orgA'));
ALTER TABLE audit_log ENABLE TRIGGER trg_audit_no_update;
SELECT pg_temp.ok((SELECT bad_log_id FROM fn_verify_audit_chain(pg_temp.f('orgA'))) = (SELECT min(log_id) FROM audit_log WHERE org_id = pg_temp.f('orgA')), 'a tampered audit row is detected at the exact row');
ROLLBACK TO SAVEPOINT before_tamper;

-- ------------------------------------------------------------------ RLS, RBAC masking, privileges
SELECT pg_temp.ok((SELECT count(*) FROM rls_audit()) = 0, 'every tenant table has RLS enabled, forced and a policy: ' || COALESCE((SELECT string_agg(table_name||' '||problem, ', ') FROM rls_audit()), 'none'));
GRANT SELECT ON fx TO ccc_app, ccc_engine;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text), pg_temp.fails(text, text, text), pg_temp.f(text), pg_temp.d(text), pg_temp.c(text) TO ccc_app, ccc_engine;

SET LOCAL ROLE ccc_app;
SELECT set_config('app.current_org_id', '', true);
SELECT pg_temp.ok((SELECT count(*) FROM risk_findings) = 0 AND (SELECT count(*) FROM scoring_policy) = 0 AND (SELECT count(*) FROM organizations) = 0, 'no tenant set => no rows visible anywhere');
SELECT set_config('app.current_org_id', (SELECT id::text FROM fx WHERE k='orgB'), true);
SELECT pg_temp.ok((SELECT count(*) FROM risk_findings) = 0 AND (SELECT count(*) FROM domain_scores) = 0 AND (SELECT count(*) FROM audit_log WHERE org_id IS DISTINCT FROM (SELECT id FROM fx WHERE k='orgB')) = 0
  AND (SELECT count(*) FROM executive_decisions) = 0 AND (SELECT count(*) FROM decision_action_log) = 0 AND (SELECT count(*) FROM risk_scenarios) = 0, 'tenant B sees none of tenant A''s data');
SELECT pg_temp.ok((SELECT count(*) FROM organizations) = 1, 'tenant B sees only its own organization row');
SELECT pg_temp.fails($$INSERT INTO asset_inventory(org_id, external_ref, name, asset_type) VALUES ((SELECT id FROM fx WHERE k='orgA'), 'x', 'x', 'server')$$, 'row-level security', 'tenant B cannot insert rows into tenant A');
SELECT pg_temp.fails($$UPDATE audit_log SET action='x'$$, 'permission denied', 'the app role has no UPDATE on audit_log');
SELECT pg_temp.fails($$DELETE FROM domain_scores$$, 'permission denied', 'the app role cannot delete score snapshots');
SELECT pg_temp.fails($$INSERT INTO enterprise_scores(org_id,policy_id,snapshot_at,arithmetic_score,arithmetic_band,displayed_band,floor_applied,n_critical,n_high,n_medium,n_low,confidence) VALUES (NULL,NULL,now(),1,'low','low',false,0,0,0,0,0)$$,
  'permission denied', 'only the engine writes scores');
SELECT pg_temp.fails($$INSERT INTO tool_categories(code,name) VALUES ('evil','evil')$$, 'permission denied', 'reference data is read-only for the app');
SELECT pg_temp.fails($$UPDATE role_capabilities SET approve_decisions = true$$, 'permission denied', 'the app cannot grant itself capabilities');

-- tenant A: an analyst sees findings and scores but no money; the CXO sees money
SELECT set_config('app.current_org_id', (SELECT id::text FROM fx WHERE k='orgA'), true);
SELECT set_config('app.current_user_id', (SELECT id::text FROM fx WHERE k='anA'), true);
SELECT pg_temp.ok((SELECT count(*) FROM risk_findings) = 4, 'tenant A sees its 4 findings');
SELECT pg_temp.ok((SELECT count(*) FROM v_domain_posture) = 12, 'domain posture view returns 12 subscribed domains');
SELECT pg_temp.ok((SELECT appetite_state FROM v_domain_posture WHERE domain_code='soc_mdr') = 'outside_appetite', 'SOC shows outside appetite');
SELECT pg_temp.ok((SELECT count(*) FROM business_impact_assessments) = 0 AND (SELECT count(*) FROM loss_models) = 0 AND (SELECT count(*) FROM whatif_scenarios) = 0,
  'an analyst cannot read financial tables');
SELECT pg_temp.ok((SELECT displayed_band = 'high' AND ale_expected IS NULL FROM v_enterprise_headline), 'an analyst sees the headline band but the money is masked');
SELECT set_config('app.current_user_id', (SELECT id::text FROM fx WHERE k='cxoA'), true);
SELECT pg_temp.ok((SELECT count(*) FROM business_impact_assessments) = 2 AND (SELECT ale_expected FROM v_enterprise_headline) = 2890000, 'the CXO sees exposure and loss');
SELECT set_config('app.current_user_id', (SELECT id::text FROM fx WHERE k='cxoB'), true);
SELECT pg_temp.ok((SELECT count(*) FROM business_impact_assessments) = 0, 'a user of another tenant gets no financial rows even with the capability');
SELECT pg_temp.ok((SELECT count(*) FROM audit_log) > 0, 'tenant A can read its audit chain');
RESET ROLE;

-- the engine reads money to compute, whoever the session user is
SET LOCAL ROLE ccc_engine;
SELECT set_config('app.current_user_id', '', true);
SELECT pg_temp.ok((SELECT count(*) FROM loss_models) = 1, 'the engine role reads loss models for computation');
RESET ROLE;

-- an app-role change is audited in tenant B's own chain
SET LOCAL ROLE ccc_app;
SELECT set_config('app.current_org_id', (SELECT id::text FROM fx WHERE k='orgB'), true);
SELECT set_config('app.current_user_id', (SELECT id::text FROM fx WHERE k='cxoB'), true);
SELECT pg_temp.ok((SELECT count(*) FROM v_domain_posture) = 0, 'posture view returns nothing to tenant B');
INSERT INTO risk_appetite(org_id, risk_domain_id, max_score, approved_by, review_date) VALUES (pg_temp.f('orgB'), pg_temp.d('iam_pam'), 40, pg_temp.f('cxoB'), CURRENT_DATE + 180);
SELECT pg_temp.ok((SELECT count(*) FROM audit_log WHERE entity_type='risk_appetite') = 1 AND (SELECT user_id FROM audit_log WHERE entity_type='risk_appetite') = pg_temp.f('cxoB'),
  'app-role change is audited in tenant B''s chain with the acting user');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM fn_verify_audit_chain(pg_temp.f('orgB'))) = 0, 'tenant B audit chain verifies');
ROLLBACK;
