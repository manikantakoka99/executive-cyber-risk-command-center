#!/usr/bin/env python3
"""Idempotent importer: CyberCommandCenter_Sample_Data.xlsx → PostgreSQL.

Usage:
  .venv-ecc/bin/python db/import_sample_data.py [--xlsx PATH] [--database-url URL] [--reset]

--reset truncates all ECC tables before load (safe reload).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import openpyxl
import psycopg2
import psycopg2.extras

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = ROOT / "reference" / "CyberCommandCenter_Sample_Data.xlsx"
DEFAULT_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center",
)

# Load order respects FKs. risk_domains / compliance_frameworks come from workbook
# (UUIDs must match sample), so we clear schema seed rows on reset.
TABLE_ORDER = [
    "audit_log",
    "decision_action_log",
    "executive_decisions",
    "business_impact_assessments",
    "risk_findings",
    "domain_risk_snapshots",
    "enterprise_risk_score_snapshots",
    "org_compliance_status",
    "command_center_activity",
    "generated_reports",
    "org_domain_subscriptions",
    "users",
    "organizations",
    "risk_domains",
    "compliance_frameworks",
]

SHEET_LOAD_ORDER = [
    "organizations",
    "users",
    "risk_domains",
    "compliance_frameworks",
    "org_domain_subscriptions",
    "domain_risk_snapshots",
    "enterprise_risk_score_snapshots",
    "risk_findings",
    "business_impact_assessments",
    "executive_decisions",
    "decision_action_log",
    "org_compliance_status",
    "command_center_activity",
    "generated_reports",
    # audit_log intentionally skipped if empty
]


def sheet_rows(wb: openpyxl.Workbook, name: str) -> tuple[list[str], list[dict[str, Any]]]:
    if name not in wb.sheetnames:
        raise SystemExit(f"Missing worksheet: {name}")
    ws = wb[name]
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header = next(rows_iter)
    except StopIteration:
        return [], []
    # Guard against placeholder empty sheets
    if header is None or header[0] is None or str(header[0]).startswith("("):
        return [], []
    cols = [str(c) for c in header]
    out: list[dict[str, Any]] = []
    for r in rows_iter:
        if r is None or all(c is None for c in r):
            continue
        row = dict(zip(cols, r))
        out.append(row)
    return cols, out


def coerce(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return value
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        s = value.strip()
        if s == "":
            return None
        if s.startswith("{") or s.startswith("["):
            try:
                return psycopg2.extras.Json(json.loads(s))
            except json.JSONDecodeError:
                return s
        return s
    return value


def reset_tables(cur) -> None:
    tables = ", ".join(TABLE_ORDER)
    cur.execute(f"TRUNCATE {tables} RESTART IDENTITY CASCADE;")


def upsert_rows(cur, table: str, cols: list[str], rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    # conflict target: PK columns
    pk_map = {
        "organizations": ["org_id"],
        "users": ["user_id"],
        "risk_domains": ["risk_domain_id"],
        "compliance_frameworks": ["framework_id"],
        "org_domain_subscriptions": ["org_id", "risk_domain_id"],
        "domain_risk_snapshots": ["snapshot_id"],
        "enterprise_risk_score_snapshots": ["snapshot_id"],
        "risk_findings": ["finding_id"],
        "business_impact_assessments": ["impact_id"],
        "executive_decisions": ["decision_id"],
        "decision_action_log": ["action_log_id"],
        "org_compliance_status": ["status_id"],
        "command_center_activity": ["activity_id"],
        "generated_reports": ["report_id"],
        "audit_log": ["log_id"],
    }
    pks = pk_map[table]
    col_sql = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))
    updates = ", ".join(f"{c}=EXCLUDED.{c}" for c in cols if c not in pks)
    if updates:
        sql = (
            f"INSERT INTO {table} ({col_sql}) VALUES ({placeholders}) "
            f"ON CONFLICT ({', '.join(pks)}) DO UPDATE SET {updates}"
        )
    else:
        sql = (
            f"INSERT INTO {table} ({col_sql}) VALUES ({placeholders}) "
            f"ON CONFLICT ({', '.join(pks)}) DO NOTHING"
        )

    count = 0
    for row in rows:
        values = [coerce(row.get(c)) for c in cols]
        # Skip rows missing PK
        if any(values[cols.index(pk)] is None for pk in pks if pk in cols):
            continue
        cur.execute(sql, values)
        count += 1
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="Import ECC sample workbook into Postgres")
    parser.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX)
    parser.add_argument("--database-url", default=DEFAULT_URL)
    parser.add_argument("--reset", action="store_true", help="Truncate ECC tables before import")
    args = parser.parse_args()

    if not args.xlsx.exists():
        print(f"Workbook not found: {args.xlsx}", file=sys.stderr)
        return 1

    wb = openpyxl.load_workbook(args.xlsx, data_only=True)
    conn = psycopg2.connect(args.database_url)
    conn.autocommit = False
    summary: dict[str, int] = {}

    try:
        with conn.cursor() as cur:
            if args.reset:
                print("Resetting tables…")
                reset_tables(cur)

            for sheet in SHEET_LOAD_ORDER:
                cols, rows = sheet_rows(wb, sheet)
                if not cols:
                    print(f"  {sheet}: skipped (empty)")
                    summary[sheet] = 0
                    continue
                # Only use columns that exist on the table — filter unknown
                n = upsert_rows(cur, sheet, cols, rows)
                summary[sheet] = n
                print(f"  {sheet}: upserted {n}")

            # audit_log sheet may be placeholder
            if "audit_log" in wb.sheetnames:
                cols, rows = sheet_rows(wb, "audit_log")
                if cols and rows:
                    summary["audit_log"] = upsert_rows(cur, "audit_log", cols, rows)
                    print(f"  audit_log: upserted {summary['audit_log']}")
                else:
                    summary["audit_log"] = 0
                    print("  audit_log: 0 rows")

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print("\nImport complete:")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    print("\nNext: .venv-ecc/bin/python db/validate_import.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
