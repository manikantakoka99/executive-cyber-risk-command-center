#!/usr/bin/env python3
"""Validate imported ECC sample dataset against expected workbook counts + FKs."""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl
import psycopg2

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = ROOT / "reference" / "CyberCommandCenter_Sample_Data.xlsx"
DEFAULT_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center",
)

EXPECTED = {
    "organizations": 5,
    "users": 25,
    "risk_domains": 13,  # 12 YVI sample domains + Phase 2 `unmapped`
    "org_domain_subscriptions": 60,
    "domain_risk_snapshots": 360,
    "enterprise_risk_score_snapshots": 30,
    "risk_findings": 15,
    "business_impact_assessments": 15,
    "executive_decisions": 15,
    "decision_action_log": 11,
    "compliance_frameworks": 5,
    "org_compliance_status": 50,
    "command_center_activity": 34,
    "generated_reports": 10,
}


def count(cur, table: str) -> int:
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    return int(cur.fetchone()[0])


def main() -> int:
    url = os.environ.get("DATABASE_URL", DEFAULT_URL)
    conn = psycopg2.connect(url)
    issues: list[str] = []
    report: list[str] = ["# ECC Import Validation Report", ""]

    with conn.cursor() as cur:
        report.append("## Row counts")
        for table, exp in EXPECTED.items():
            actual = count(cur, table)
            ok = actual == exp
            mark = "OK" if ok else "MISMATCH"
            report.append(f"- {table}: {actual} (expected {exp}) [{mark}]")
            if not ok:
                issues.append(f"{table} count {actual} != {exp}")

        audit = count(cur, "audit_log")
        report.append(f"- audit_log: {audit} (sample may be 0) [INFO]")

        report.append("")
        report.append("## Foreign-key spot checks")
        checks = [
            ("users with missing org", "SELECT COUNT(*) FROM users u LEFT JOIN organizations o ON o.org_id=u.org_id WHERE o.org_id IS NULL"),
            ("findings missing org/domain", "SELECT COUNT(*) FROM risk_findings f LEFT JOIN organizations o ON o.org_id=f.org_id LEFT JOIN risk_domains d ON d.risk_domain_id=f.risk_domain_id WHERE o.org_id IS NULL OR d.risk_domain_id IS NULL"),
            ("impacts missing finding", "SELECT COUNT(*) FROM business_impact_assessments i LEFT JOIN risk_findings f ON f.finding_id=i.finding_id WHERE i.finding_id IS NOT NULL AND f.finding_id IS NULL"),
            ("decisions missing finding/impact", "SELECT COUNT(*) FROM executive_decisions d LEFT JOIN risk_findings f ON f.finding_id=d.finding_id LEFT JOIN business_impact_assessments i ON i.impact_id=d.impact_id WHERE (d.finding_id IS NOT NULL AND f.finding_id IS NULL) OR (d.impact_id IS NOT NULL AND i.impact_id IS NULL)"),
            ("action logs missing decision", "SELECT COUNT(*) FROM decision_action_log l LEFT JOIN executive_decisions d ON d.decision_id=l.decision_id WHERE d.decision_id IS NULL"),
            ("subscriptions missing domain", "SELECT COUNT(*) FROM org_domain_subscriptions s LEFT JOIN risk_domains d ON d.risk_domain_id=s.risk_domain_id WHERE d.risk_domain_id IS NULL"),
        ]
        for label, sql in checks:
            cur.execute(sql)
            n = int(cur.fetchone()[0])
            mark = "OK" if n == 0 else "FAIL"
            report.append(f"- {label}: {n} [{mark}]")
            if n:
                issues.append(f"{label}: {n}")

        report.append("")
        report.append("## Per-org sanity")
        cur.execute(
            """
            SELECT o.name,
                   (SELECT COUNT(*) FROM enterprise_risk_score_snapshots e WHERE e.org_id=o.org_id) AS ent,
                   (SELECT COUNT(*) FROM domain_risk_snapshots d WHERE d.org_id=o.org_id) AS dom,
                   (SELECT COUNT(*) FROM risk_findings f WHERE f.org_id=o.org_id) AS findings,
                   (SELECT COUNT(*) FROM executive_decisions d WHERE d.org_id=o.org_id AND d.status='awaiting_decision') AS awaiting
            FROM organizations o
            ORDER BY o.name
            """
        )
        for name, ent, dom, findings, awaiting in cur.fetchall():
            report.append(
                f"- {name}: enterprise_snaps={ent}, domain_snaps={dom}, findings={findings}, awaiting_decisions={awaiting}"
            )
            if ent < 1 or dom < 1:
                issues.append(f"{name} missing snapshots")

    conn.close()

    # Optional: compare workbook sheet lengths
    if DEFAULT_XLSX.exists():
        wb = openpyxl.load_workbook(DEFAULT_XLSX, data_only=True)
        report.append("")
        report.append("## Workbook sheet presence")
        for sheet in EXPECTED:
            present = sheet in wb.sheetnames
            report.append(f"- {sheet}: {'present' if present else 'MISSING'}")
            if not present:
                issues.append(f"workbook missing {sheet}")

    out = ROOT / "docs" / "ecc-import-validation.md"
    out.write_text("\n".join(report) + "\n")
    print("\n".join(report))
    if issues:
        print("\nVALIDATION FAILED:")
        for i in issues:
            print(" -", i)
        return 1
    print("\nVALIDATION PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
