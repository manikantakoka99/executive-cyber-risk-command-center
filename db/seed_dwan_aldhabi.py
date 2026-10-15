#!/usr/bin/env python3
"""Seed the DWAN consolidated schema with Al Dhabi Holdings demo data.

Sources:
  - reference/dwan/CyberCommandCenter_Tool_To_Risk_Domain_Solution.xlsx (Normalized Signals)
  - Design notes / product context personas
  - Reference HTML snapshot date 5 Sep 2026
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import openpyxl
import psycopg2
import psycopg2.extras

ROOT = Path(__file__).resolve().parents[1]
XLSX = next(
    (
        p
        for p in [
            ROOT / "reference/dwan/CyberCommandCenter_Tool_To_Risk_Domain_Solution.xlsx",
            ROOT / "reference/dwan/CyberCommandCenter_Tool_To_Risk_Domain_Solution_af39.xlsx",
        ]
        if p.exists()
    ),
    ROOT / "reference/dwan/CyberCommandCenter_Tool_To_Risk_Domain_Solution.xlsx",
)
ORG_ID = "2accc7de-f693-4b19-8fe8-6db501be05e2"
SNAP = datetime(2026, 9, 5, 0, 0, tzinfo=timezone.utc)
BOARD = datetime(2026, 6, 5, 0, 0, tzinfo=timezone.utc)

# Persona user ids kept stable for the existing UI demo directory.
PERSONAS = [
    ("c1500001-a090-41a0-8ecc-000000000001", "Layla", "Al Hashimi", "layla.hashimi@aldhabi.demo", "ciso"),
    ("c1500001-a090-41a0-8ecc-000000000002", "Omar", "Al Mansoori", "omar.mansoori@aldhabi.demo", "cxo"),
    ("c1500001-a090-41a0-8ecc-000000000003", "Fatima", "Al Nuaimi", "fatima.nuaimi@aldhabi.demo", "cxo"),
    ("c1500001-a090-41a0-8ecc-000000000004", "Khalid", "Al Suwaidi", "khalid.suwaidi@aldhabi.demo", "cxo"),
    ("c1500001-a090-41a0-8ecc-000000000005", "Mariam", "Al Dhaheri", "mariam.dhaheri@aldhabi.demo", "cxo"),
    ("c1500001-a090-41a0-8ecc-000000000006", "Hessa", "Al Ketbi", "hessa.ketbi@aldhabi.demo", "board_member"),
    ("c1500001-a090-41a0-8ecc-000000000007", "Yusuf", "Rahman", "yusuf.rahman@aldhabi.demo", "domain_analyst"),
    ("c1500001-a090-41a0-8ecc-000000000008", "Aisha", "Khan", "aisha.khan@aldhabi.demo", "domain_analyst"),
    ("c1500001-a090-41a0-8ecc-000000000009", "Nadia", "Farouk", "nadia.farouk@aldhabi.demo", "admin"),
    ("c1500001-a090-41a0-8ecc-00000000000a", "Rashid", "Al Maktoum", "rashid.maktoum@aldhabi.demo", "risk_lead"),
    ("c1500001-a090-41a0-8ecc-00000000000b", "Sara", "Ibrahim", "sara.ibrahim@aldhabi.demo", "program_office"),
    ("c1500001-a090-41a0-8ecc-00000000000c", "James", "Okoye", "james.okoye@aldhabi.demo", "auditor"),
]

# Board appetite limits (aligned with reference HTML / command model)
APPETITE = {
    "vapt_asm": 40,
    "soc_mdr": 45,
    "third_party_risk": 50,
    "ransomware_readiness": 40,
    "pci_dss": 35,
    "ai_governance": 55,
    "iam_pam": 45,
    "phishing_bec": 40,
    "vciso": 45,
    "cspm_cnapp": 40,
    "compliance_engine": 40,
    "ot_ics": 50,
}

# Map excel tool category names → schema tool_categories.code (best effort)
CAT_MAP = {
    "External attack surface management": "external_asm",
    "External Attack Surface Management": "external_asm",
    "Vulnerability management": "vuln_management",
    "Vulnerability Management": "vuln_management",
    "Penetration test findings": "pentest",
    "Penetration Testing": "pentest",
    "MDR alert handling": "mdr_alerting",
    "MDR / Managed Detection": "mdr_alerting",
    "NDR / UEBA sensors": "ndr_ueba",
    "SOC case management": "soc_case_mgmt",
    "Vendor security assessments": "vendor_assessment",
    "TPRM / GRC": "vendor_assessment",
    "Vendor security ratings": "vendor_ratings",
    "EDR / XDR": "edr_xdr",
    "SIEM / SOAR": "siem_soar",
    "Immutable backup": "immutable_backup",
    "DR / recovery testing": "dr_testing",
    "Data loss prevention": "dlp",
    "DLP / Data Controls": "dlp",
    "Card data discovery": "card_data_discovery",
    "AI system inventory": "ai_inventory",
    "AI Security / AI-SPM": "ai_inventory",
    "GenAI guardrails and monitoring": "ai_guardrails",
    "LLM Security": "ai_guardrails",
    "AI Governance": "ai_inventory",
    "Identity provider and MFA": "idp_mfa",
    "Privileged access vault": "pam_vault",
    "Identity governance": "identity_governance",
    "Email security gateway": "email_security",
    "Secure Email Gateway": "email_security",
    "Phishing simulation": "phishing_simulation",
    "Phishing Simulation": "phishing_simulation",
    "Security governance programme": "governance_program",
    "Cloud posture (CSPM)": "cspm",
    "Cloud workload protection": "cwpp",
    "GRC control testing": "grc_controls",
    "OT network monitoring": "ot_monitoring",
    "Industrial Firewall / Segmentation": "ot_monitoring",
}


def connect():
    url = os.environ.get("DWAN_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        url = "postgresql://ecc:ecc_dev_password@localhost:5433/dwan"
    # Prefer superuser peer for FORCE RLS seed when available
    try:
        return psycopg2.connect("dbname=dwan user=postgres host=/var/run/postgresql port=5433")
    except Exception:
        return psycopg2.connect(url)


def load_signals():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    ws = wb["Normalized Signals"]
    rows = []
    for row in ws.iter_rows(min_row=5, values_only=True):
        if not row or not row[0]:
            continue
        metric_id, domain, domain_code, tool_cat, metric, num, den, comp, gap, weight, points = row[:11]
        if domain_code is None:
            continue
        rows.append(
            {
                "domain_code": str(domain_code).strip(),
                "tool_cat": str(tool_cat).strip(),
                "metric": str(metric or ""),
                "numerator": int(num or 0),
                "denominator": int(den or 1),
                "gap": float(gap or 0),
                "weight": int(weight or 0),
            }
        )
    return rows


def main():
    signals = load_signals()
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print("Seeding DWAN demo into database…")

    # Wipe prior Al Dhabi seed (CASCADE via org FK). Truncate score components first if needed.
    cur.execute("DELETE FROM domain_score_components WHERE org_id = %s", (ORG_ID,))
    cur.execute("DELETE FROM organizations WHERE org_id = %s OR name = %s", (ORG_ID, "Al Dhabi Holdings"))

    cur.execute(
        """
        INSERT INTO organizations(org_id, name, industry, hq_country, reporting_currency)
        VALUES (%s, 'Al Dhabi Holdings', 'Conglomerate', 'UAE', 'AED')
        """,
        (ORG_ID,),
    )

    for uid, first, last, email, role in PERSONAS:
        cur.execute(
            """
            INSERT INTO users(user_id, org_id, first_name, last_name, email, role)
            VALUES (%s, %s, %s, %s, %s, %s::user_role_name)
            """,
            (uid, ORG_ID, first, last, email, role),
        )

    cur.execute(
        """
        INSERT INTO business_units(org_id, name, key_processes, criticality_tier)
        VALUES (%s, 'Payments', ARRAY['card payments','treasury'], 1)
        RETURNING business_unit_id
        """,
        (ORG_ID,),
    )
    bu_id = cur.fetchone()["business_unit_id"]

    # Subscribe all domains
    cur.execute(
        """
        INSERT INTO org_domain_subscriptions(org_id, risk_domain_id)
        SELECT %s, risk_domain_id FROM risk_domains
        """,
        (ORG_ID,),
    )

    # Scoring policy — CISO proposes; Board approves (proposer ≠ approver)
    ciso = "c1500001-a090-41a0-8ecc-000000000001"
    board = "c1500001-a090-41a0-8ecc-000000000006"
    cur.execute(
        """
        INSERT INTO scoring_policy(org_id, version, status, unobserved_default, floor_enabled, floor_band,
                                   coverage_window_days, freshness_factor, max_rejected_rate, proposed_by)
        VALUES (%s, 1, 'draft', 60, true, 'high', 7, 2.0, 0.05, %s)
        RETURNING policy_id
        """,
        (ORG_ID, ciso),
    )
    policy_id = cur.fetchone()["policy_id"]

    # Domain weights = 1 each
    cur.execute(
        """
        INSERT INTO policy_domain_weights(policy_id, org_id, risk_domain_id, weight)
        SELECT %s, %s, risk_domain_id, 1 FROM risk_domains
        """,
        (policy_id, ORG_ID),
    )

    # Category weights from excel (owning categories)
    cur.execute("SELECT category_id, code FROM tool_categories")
    cats = {r["code"]: r["category_id"] for r in cur.fetchall()}
    cur.execute("SELECT risk_domain_id, code FROM risk_domains")
    domains = {r["code"]: r["risk_domain_id"] for r in cur.fetchall()}

    seen_weights = set()
    for s in signals:
        code = CAT_MAP.get(s["tool_cat"])
        if not code or code not in cats or s["weight"] <= 0:
            continue
        key = (policy_id, cats[code])
        if key in seen_weights:
            continue
        # Only owning categories for the domain
        cur.execute(
            """
            SELECT 1 FROM signal_domain_map
            WHERE category_id = %s AND risk_domain_id = %s AND role = 'owning'
            """,
            (cats[code], domains[s["domain_code"]]),
        )
        if not cur.fetchone():
            continue
        cur.execute(
            """
            INSERT INTO policy_category_weights(policy_id, org_id, category_id, weight)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (policy_id, ORG_ID, cats[code], s["weight"]),
        )
        seen_weights.add(key)

    # Ensure ransomware classic weights if missing
    for code, w in [("edr_xdr", 25), ("siem_soar", 20), ("immutable_backup", 25), ("dr_testing", 30)]:
        cur.execute(
            """
            INSERT INTO policy_category_weights(policy_id, org_id, category_id, weight)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (policy_id, ORG_ID, cats[code], w),
        )

    cur.execute(
        """
        INSERT INTO policy_sla(policy_id, org_id, severity, days) VALUES
          (%s, %s, 'critical', 7), (%s, %s, 'high', 30),
          (%s, %s, 'medium', 60), (%s, %s, 'low', 90)
        """,
        (policy_id, ORG_ID, policy_id, ORG_ID, policy_id, ORG_ID, policy_id, ORG_ID),
    )

    # Board locks the CISO-proposed policy
    cur.execute("SELECT set_config('app.current_org_id', %s, true)", (ORG_ID,))
    cur.execute("SELECT set_config('app.current_user_id', %s, true)", (board,))
    cur.execute(
        """
        UPDATE scoring_policy
        SET status='approved', proposed_by=%s, approved_by=%s, approved_at=%s, effective_from=%s
        WHERE policy_id=%s
        """,
        (ciso, board, SNAP - timedelta(days=30), SNAP - timedelta(days=30), policy_id),
    )

    for code, max_score in APPETITE.items():
        cur.execute(
            """
            INSERT INTO risk_appetite(org_id, risk_domain_id, max_score, proposed_by, approved_by, effective_from, review_date)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (ORG_ID, domains[code], max_score, ciso, board, date(2026, 1, 1), date(2027, 1, 1)),
        )
    cur.execute(
        """
        INSERT INTO risk_appetite(org_id, risk_domain_id, max_score, proposed_by, approved_by, effective_from, review_date)
        VALUES (%s, NULL, 50, %s, %s, %s, %s)
        """,
        (ORG_ID, ciso, board, date(2026, 1, 1), date(2027, 1, 1)),
    )

    # Assets + connectors + coverage + signals
    analyst = "c1500001-a090-41a0-8ecc-000000000007"
    cur.execute("SELECT set_config('app.current_user_id', %s, true)", (ciso,))

    asset_ids = []
    for i in range(1, 9):
        cur.execute(
            """
            INSERT INTO asset_inventory(org_id, external_ref, name, asset_type, criticality_tier,
                                        crown_jewel, internet_facing, business_unit_id)
            VALUES (%s, %s, %s, 'server', %s, %s, %s, %s)
            RETURNING asset_id
            """,
            (
                ORG_ID,
                f"adh-a{i}",
                f"Asset {i}",
                1 if i <= 2 else 2,
                i == 1,
                i <= 3,
                bu_id,
            ),
        )
        asset_ids.append(cur.fetchone()["asset_id"])

    # One connector per owning category that has a signal
    connector_for_cat = {}
    used_cats = set()
    for s in signals:
        code = CAT_MAP.get(s["tool_cat"])
        if not code or code not in cats or code in used_cats:
            continue
        used_cats.add(code)
        cur.execute(
            """
            INSERT INTO org_connectors(org_id, category_id, product_name, pattern, schedule_minutes, credential_ref)
            VALUES (%s, %s, %s, 'api_pull', 60, %s)
            RETURNING connector_id
            """,
            (ORG_ID, cats[code], f"{code} connector", f"vault:secret/aldhabi/{code}"),
        )
        cid = cur.fetchone()["connector_id"]
        connector_for_cat[code] = cid
        cur.execute(
            """
            INSERT INTO ingestion_runs(org_id, connector_id, started_at, finished_at, status, rows_in, rows_rejected)
            VALUES (%s, %s, %s, %s, 'success', 100, 1)
            RETURNING run_id
            """,
            (ORG_ID, cid, SNAP - timedelta(hours=2), SNAP - timedelta(hours=1)),
        )
        run_id = cur.fetchone()["run_id"]
        for aid in asset_ids:
            cur.execute(
                """
                INSERT INTO asset_coverage(asset_id, org_id, category_id, in_scope, last_seen_at)
                VALUES (%s, %s, %s, true, %s)
                ON CONFLICT DO NOTHING
                """,
                (aid, ORG_ID, cats[code], SNAP - timedelta(hours=1)),
            )
        cur.execute(
            """
            INSERT INTO control_signals(org_id, category_id, run_id, observed_at, numerator, denominator)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                ORG_ID,
                cats[code],
                run_id,
                SNAP,
                min(s["numerator"], max(s["denominator"], 1)),
                max(s["denominator"], 1),
            ),
        )

    # Ensure every owning category with a policy weight has at least one signal
    # (excel mapping may miss some; synthesize so enterprise scoring can run).
    cur.execute(
        """
        SELECT DISTINCT c.code, c.category_id, m.risk_domain_id
        FROM policy_category_weights w
        JOIN tool_categories c ON c.category_id = w.category_id
        JOIN signal_domain_map m ON m.category_id = c.category_id AND m.role = 'owning'
        WHERE w.policy_id = %s AND w.weight > 0
          AND NOT EXISTS (
            SELECT 1 FROM control_signals s
            WHERE s.org_id = %s AND s.category_id = c.category_id
          )
        """,
        (policy_id, ORG_ID),
    )
    for row in cur.fetchall():
        code = row["code"]
        cur.execute(
            """
            INSERT INTO org_connectors(org_id, category_id, product_name, pattern, schedule_minutes, credential_ref)
            VALUES (%s, %s, %s, 'api_pull', 60, %s)
            ON CONFLICT DO NOTHING
            RETURNING connector_id
            """,
            (ORG_ID, row["category_id"], f"{code} seed", f"vault:secret/aldhabi/{code}"),
        )
        got = cur.fetchone()
        if got:
            cid = got["connector_id"]
        else:
            cur.execute(
                "SELECT connector_id FROM org_connectors WHERE org_id=%s AND category_id=%s LIMIT 1",
                (ORG_ID, row["category_id"]),
            )
            cid = cur.fetchone()["connector_id"]
        cur.execute(
            """
            INSERT INTO ingestion_runs(org_id, connector_id, started_at, finished_at, status, rows_in, rows_rejected)
            VALUES (%s, %s, %s, %s, 'success', 50, 0)
            RETURNING run_id
            """,
            (ORG_ID, cid, SNAP - timedelta(hours=3), SNAP - timedelta(hours=2)),
        )
        run_id = cur.fetchone()["run_id"]
        # Synthetic gap by domain family so posture is not flat.
        den, num = 100, 55
        if code in ("edr_xdr", "siem_soar", "immutable_backup", "dr_testing"):
            num = 40
        elif code in ("cspm", "external_asm", "vuln_management"):
            num = 30
        cur.execute(
            """
            INSERT INTO control_signals(org_id, category_id, run_id, observed_at, numerator, denominator)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (ORG_ID, row["category_id"], run_id, SNAP, num, den),
        )

    # Score domains — use SAVEPOINT so a miss does not wipe the seed transaction
    cur.execute("SELECT set_config('app.current_user_id', %s, true)", (ciso,))
    cur.execute("SET ROLE ccc_engine")
    scored = 0
    for code, did in domains.items():
        cur.execute("SAVEPOINT score_domain")
        try:
            cur.execute(
                "SELECT sp_score_domain(%s, %s, %s, %s, %s)",
                (ORG_ID, did, policy_id, SNAP, f"{code} snapshot"),
            )
            cur.execute("RELEASE SAVEPOINT score_domain")
            scored += 1
        except Exception as exc:
            cur.execute("ROLLBACK TO SAVEPOINT score_domain")
            print(f"  skip score {code}: {exc}")
    print(f"  scored domains: {scored}")
    if scored == 0:
        raise RuntimeError("no domains scored — check signals and category weights")

    cur.execute(
        "SELECT sp_snapshot_enterprise(%s, %s, %s)",
        (ORG_ID, SNAP, "Driven by attack surface, SOC and third-party risk"),
    )
    snap_id = cur.fetchone()["sp_snapshot_enterprise"]

    # Prior board snapshot (trigger fills adjusted_score / confidence / band)
    cur.execute(
        """
        INSERT INTO domain_scores(org_id, risk_domain_id, policy_id, snapshot_at, raw_score, coverage,
          unobserved_default, adjusted_score, feeds_total, feeds_fresh, rejected_rate, confidence, band, headline_detail)
        SELECT org_id, risk_domain_id, policy_id, %s, GREATEST(raw_score - 1.5, 0), coverage,
          unobserved_default, 0, feeds_total, feeds_fresh, rejected_rate, 0, 'low', 'Board meeting baseline'
        FROM domain_scores WHERE org_id=%s AND snapshot_at=%s
        """,
        (BOARD, ORG_ID, SNAP),
    )
    cur.execute(
        "SELECT sp_snapshot_enterprise(%s, %s, %s)",
        (ORG_ID, BOARD, "June board baseline"),
    )

    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('app.current_user_id', %s, true)", (ciso,))
    cur.execute(
        """
        INSERT INTO enterprise_loss_estimates(snapshot_id, org_id, ale_expected, ale_p90, ale_p95, currency)
        VALUES (%s, %s, 2890000, 10070000, 14940000, 'AED')
        """,
        (snap_id, ORG_ID),
    )

    # Findings + queue material
    cur.execute("SELECT set_config('app.current_user_id', %s, true)", (analyst,))
    cur.execute(
        """
        INSERT INTO risk_findings(org_id, risk_domain_id, title, severity, asset_id, cve_id, kev_listed, epss,
                                  owner_user_id, source_category_id, external_ref, status)
        VALUES
          (%s, %s, 'Two critical internet-facing CVEs on the payment gateway', 'critical', %s,
           'CVE-2026-4412', true, 0.91, %s, %s, 'VM-ADH-1001', 'open'),
          (%s, %s, 'Recovery tests missed RTO for crown-jewel finance systems', 'high', %s,
           NULL, false, NULL, %s, %s, 'DR-ADH-88', 'open'),
          (%s, %s, 'Critical vendor assessment overdue >12 months', 'high', %s,
           NULL, false, NULL, %s, %s, 'TPR-ADH-12', 'open'),
          (%s, %s, 'Immutable backup coverage gap on tier-1 file services', 'high', %s,
           NULL, false, NULL, %s, %s, 'BK-ADH-03', 'fix_reported')
        RETURNING finding_id, title
        """,
        (
            ORG_ID,
            domains["vapt_asm"],
            asset_ids[0],
            analyst,
            cats["vuln_management"],
            ORG_ID,
            domains["ransomware_readiness"],
            asset_ids[1],
            analyst,
            cats["dr_testing"],
            ORG_ID,
            domains["third_party_risk"],
            asset_ids[2],
            analyst,
            cats["vendor_assessment"],
            ORG_ID,
            domains["ransomware_readiness"],
            asset_ids[0],
            analyst,
            cats["immutable_backup"],
        ),
    )
    findings = cur.fetchall()
    f_by_title = {r["title"]: r["finding_id"] for r in findings}

    cur.execute(
        """
        INSERT INTO business_impact_assessments(org_id, finding_id, financial_exposure_amount, currency,
          downtime_hours_estimate, affected_business_unit_id, basis, regulatory_impact, reputational_impact, assessed_by)
        VALUES
          (%s, %s, 1200000, 'AED', 24, %s, 'Payment outage scenario from sample workbook', 'PCI DSS scope', 'high', %s),
          (%s, %s, 900000, 'AED', 48, %s, 'Ransomware recovery delay', NULL, 'medium', %s),
          (%s, %s, 600000, 'AED', 8, %s, 'Vendor concentration risk', NULL, NULL, %s)
        """,
        (
            ORG_ID,
            f_by_title["Two critical internet-facing CVEs on the payment gateway"],
            bu_id,
            ciso,
            ORG_ID,
            f_by_title["Recovery tests missed RTO for crown-jewel finance systems"],
            bu_id,
            ciso,
            ORG_ID,
            f_by_title["Critical vendor assessment overdue >12 months"],
            bu_id,
            ciso,
        ),
    )

    cxo = "c1500001-a090-41a0-8ecc-000000000002"
    cur.execute("SELECT set_config('app.current_user_id', %s, true)", (cxo,))
    for title, rec in [
        (
            "Two critical internet-facing CVEs on the payment gateway",
            "Approve emergency patch window this week",
        ),
        (
            "Recovery tests missed RTO for crown-jewel finance systems",
            "Fund quarterly recovery testing and fix RTO gaps",
        ),
        (
            "Critical vendor assessment overdue >12 months",
            "Commission independent assessment within 30 days",
        ),
    ]:
        cur.execute(
            """
            INSERT INTO executive_decisions(org_id, decision_type, title, priority, risk_summary, impact_summary,
              recommended_action, finding_id, status)
            VALUES (%s, 'approve_fix', %s, 'critical', %s, 'Material AED exposure on Payments BU',
              %s, %s, 'awaiting_decision')
            """,
            (ORG_ID, title, title, rec, f_by_title[title]),
        )

    # Closure path: treatment + action done on backup finding (already fix_reported)
    cur.execute("SELECT set_config('app.current_user_id', %s, true)", (analyst,))
    fix_id = f_by_title["Immutable backup coverage gap on tier-1 file services"]
    cur.execute(
        """
        INSERT INTO treatment_plans(org_id, treatment, finding_id, owner_user_id, description)
        VALUES (%s, 'mitigate', %s, %s, 'Extend immutable backup to tier-1 file services')
        RETURNING plan_id
        """,
        (ORG_ID, fix_id, analyst),
    )
    plan_id = cur.fetchone()["plan_id"]
    cur.execute(
        """
        INSERT INTO remediation_actions(org_id, plan_id, finding_id, title, owner_user_id, due_at, status, completed_at)
        VALUES (%s, %s, %s, 'Enable immutable retention policy', %s, %s, 'done', %s)
        """,
        (ORG_ID, plan_id, fix_id, analyst, SNAP + timedelta(days=7), SNAP - timedelta(days=1)),
    )

    # What-if scenario (schema: changes JSON + before/after scores)
    cur.execute("SELECT set_config('app.current_user_id', %s, true)", (cxo,))
    cur.execute(
        """
        INSERT INTO whatif_scenarios(org_id, name, policy_id, base_snapshot_id, changes,
          score_before, score_after, band_before, band_after, headline_after,
          ale_before, ale_after, cost_estimate, currency, created_by)
        VALUES (%s, 'C. Both immutable backup + recovery testing', %s, %s,
          '{"immutable_backup":{"gap":0.10},"dr_testing":{"gap":0.15}}'::jsonb,
          55.2, 28.0, 'high', 'medium', 'high',
          2890000, 1100000, 400000, 'AED', %s)
        """,
        (ORG_ID, policy_id, snap_id, cxo),
    )

    # Compliance
    cur.execute(
        """
        INSERT INTO org_compliance_status(org_id, framework_id, coverage_pct, snapshot_at)
        SELECT %s, framework_id, pct, %s
        FROM compliance_frameworks
        JOIN (VALUES
          ('dubai_isr', 82),('pci_dss_v4', 74),('iso_27001', 88),('nesa_uae_ia', 79),('gdpr', 71),('nist_csf_2', 76)
        ) AS v(code, pct) ON compliance_frameworks.code = v.code
        """,
        (ORG_ID, SNAP),
    )

    # Board pack — CISO/program content; Board reviews/approves later
    board_snap = snap_id
    cur.execute(
        "SELECT snapshot_id FROM enterprise_scores WHERE org_id=%s AND snapshot_at=%s",
        (ORG_ID, BOARD),
    )
    prior = cur.fetchone()
    prior_id = prior["snapshot_id"] if prior else None
    cur.execute("SELECT set_config('app.current_user_id', %s, true)", (cxo,))
    cur.execute(
        """
        INSERT INTO board_packs(org_id, period_start, period_end, enterprise_snapshot_id, prior_snapshot_id,
          status, content)
        VALUES (%s, %s, %s, %s, %s, 'draft',
          jsonb_build_object(
            'title', 'Board cyber risk pack — Sep 2026',
            'summary', 'Two domains are Critical and need decisions this week. Floor rule applied to the headline.',
            'sources', jsonb_build_array('enterprise_scores', 'risk_findings', 'executive_decisions')
          ))
        """,
        (ORG_ID, date(2026, 6, 5), date(2026, 9, 5), board_snap, prior_id),
    )

    cur.execute(
        """
        INSERT INTO command_center_activity(org_id, activity_type, summary, occurred_at)
        VALUES
          (%s, 'finding_created', 'Critical CVEs on payment gateway escalated to decision queue', %s),
          (%s, 'decision_escalated', 'Three decisions awaiting CXO — ranked by exploitability', %s)
        """,
        (ORG_ID, SNAP, ORG_ID, SNAP),
    )

    # Second tenant for cross-tenant isolation (Falcon National Bank)
    TENANT_B = "e5082391-0ae2-4ed1-93d6-c11650b39dbb"
    cur.execute("DELETE FROM organizations WHERE org_id = %s OR name = %s", (TENANT_B, "Falcon National Bank"))
    cur.execute(
        """
        INSERT INTO organizations(org_id, name, industry, hq_country, reporting_currency)
        VALUES (%s, 'Falcon National Bank', 'Banking', 'UAE', 'AED')
        """,
        (TENANT_B,),
    )
    falcon_personas = [
        ("c1500001-a090-41a0-8ecc-0000000000b1", "Nora", "Al Falasi", "nora.falasi@falcon.demo", "ciso"),
        ("c1500001-a090-41a0-8ecc-0000000000b2", "Tariq", "Hassan", "tariq.hassan@falcon.demo", "board_member"),
        ("c1500001-a090-41a0-8ecc-0000000000b3", "Samira", "Qureshi", "samira.qureshi@falcon.demo", "cxo"),
    ]
    for uid, first, last, email, role in falcon_personas:
        cur.execute(
            """
            INSERT INTO users(user_id, org_id, first_name, last_name, email, role)
            VALUES (%s, %s, %s, %s, %s, %s::user_role_name)
            """,
            (uid, TENANT_B, first, last, email, role),
        )
    cur.execute(
        """
        INSERT INTO org_domain_subscriptions(org_id, risk_domain_id)
        SELECT %s, risk_domain_id FROM risk_domains
        """,
        (TENANT_B,),
    )

    conn.commit()
    cur.execute(
        """
        SELECT displayed_band, arithmetic_score, n_critical, n_outside_appetite, confidence
        FROM enterprise_scores WHERE org_id=%s AND snapshot_at=%s
        """,
        (ORG_ID, SNAP),
    )
    ent = cur.fetchone()
    print("Enterprise snapshot:", dict(ent) if ent else None)
    cur.execute("SELECT count(*) AS n FROM domain_scores WHERE org_id=%s AND snapshot_at=%s", (ORG_ID, SNAP))
    print("Domain scores:", cur.fetchone()["n"])
    cur.execute("SELECT count(*) AS n FROM executive_decisions WHERE org_id=%s", (ORG_ID,))
    print("Decisions:", cur.fetchone()["n"])
    cur.execute("SELECT count(*) AS n FROM users WHERE org_id=%s", (TENANT_B,))
    print("Falcon users:", cur.fetchone()["n"])
    cur.close()
    conn.close()
    print("Seed complete.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("SEED FAILED:", e, file=sys.stderr)
        raise
