#!/usr/bin/env python3
"""Apply pending ECC SQL migrations in order.

Usage:
  .venv-ecc/bin/python db/apply_migrations.py
  .venv-ecc/bin/python db/apply_migrations.py --only 002_ecc_connector_signal_framework
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "db" / "migrations"
DEFAULT_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center",
)

# Ordered list — keep apply_migration_v2.py as thin wrapper for 001
MIGRATIONS = [
    "001_ecc_v2_foundation.sql",
    "002_ecc_connector_signal_framework.sql",
    "003_ecc_correlation_risk_engine.sql",
    "004_ecc_executive_closed_loop.sql",
    "005_ecc_enterprise_intelligence.sql",
    "006_ecc_sample_ingestion_proof.sql",
]


def version_of(filename: str) -> str:
    return filename.replace(".sql", "")


def strip_role_backfill_if_needed(cur, sql: str) -> str:
    cur.execute(
        """
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users' AND column_name='role'
        """
    )
    if cur.fetchone():
        return sql
    marker = "-- Backfill user_roles from users.role"
    end = "-- Compatibility view for primary role code"
    if marker in sql and end in sql:
        pre, rest = sql.split(marker, 1)
        _, post = rest.split(end, 1)
        print("Note: users.role already dropped — skipping role backfill block.")
        return pre + end + post
    return sql


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=DEFAULT_URL)
    parser.add_argument("--only", help="Apply a single migration version prefix")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    files = MIGRATIONS
    if args.only:
        files = [f for f in MIGRATIONS if f.startswith(args.only) or version_of(f) == args.only]
        if not files:
            print(f"No migration matching {args.only}", file=sys.stderr)
            return 1

    conn = psycopg2.connect(args.database_url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                  version TEXT PRIMARY KEY,
                  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  description TEXT
                )
                """
            )
            for fname in files:
                ver = version_of(fname)
                path = MIGRATIONS_DIR / fname
                if not path.exists():
                    print(f"Missing {path}", file=sys.stderr)
                    return 1
                cur.execute("SELECT 1 FROM schema_migrations WHERE version = %s", (ver,))
                if cur.fetchone() and not args.force:
                    print(f"Migration {ver} already applied — skipping.")
                    continue
                sql = path.read_text(encoding="utf-8")
                if ver.startswith("001"):
                    sql = strip_role_backfill_if_needed(cur, sql)
                print(f"Applying {fname} …")
                marker = "-- >>> ENUMS_COMMIT_POINT <<<"
                if marker in sql:
                    part1, part2 = sql.split(marker, 1)
                    cur.execute(part1)
                    print(f"  committed enum extensions for {ver}")
                    cur.execute(part2)
                else:
                    cur.execute(sql)
                print(f"Applied {ver} successfully.")
        return 0
    except Exception as exc:
        print(f"Migration failed: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
