#!/usr/bin/env python3
"""Apply ECC base schema + migrations to Supabase (or any Postgres URL).

Usage:
  DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \\
    python3 db/migrate_to_supabase.py [--import-sample] [--reset]

Notes:
  - Use the Supabase *Postgres* URI (Session / Direct), not the REST URL.
  - SSL is enabled automatically for supabase.co hosts.
  - CREATE ROLE statements that need superuser are skipped on managed Postgres.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import psycopg2

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "db" / "schema.sql"
MIGRATIONS_DIR = ROOT / "db" / "migrations"
MIGRATIONS = [
    "001_ecc_v2_foundation.sql",
    "002_ecc_connector_signal_framework.sql",
    "003_ecc_correlation_risk_engine.sql",
    "004_ecc_executive_closed_loop.sql",
    "005_ecc_enterprise_intelligence.sql",
    "006_ecc_sample_ingestion_proof.sql",
    "007_ecc_command_rbac.sql",
]


def with_ssl(url: str) -> str:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if "supabase" not in host and "pooler.supabase.com" not in host:
        return url
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("sslmode", "require")
    return urlunparse(parsed._replace(query=urlencode(query)))


def sanitize_sql(sql: str) -> str:
    """Drop CREATE ROLE / GRANT TO role blocks that fail without superuser."""
    sql = re.sub(
        r"DO\s+\$\$\s+BEGIN\s+CREATE ROLE[\s\S]*?END\s+\$\$\s*;",
        "-- skipped CREATE ROLE (managed Postgres)\n",
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"^GRANT\s+.*\s+TO\s+ccc_app\s*;\s*$",
        "-- skipped GRANT TO ccc_app\n",
        sql,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    return sql


def run_sql(cur, sql: str, label: str) -> None:
    cleaned = sanitize_sql(sql)
    print(f"→ {label}")
    cur.execute(cleaned)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--database-url",
        default=os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL"),
    )
    parser.add_argument("--import-sample", action="store_true")
    parser.add_argument("--reset", action="store_true", help="Passed through to sample import")
    args = parser.parse_args()
    if not args.database_url:
        print("Set DATABASE_URL or SUPABASE_DB_URL to your Supabase Postgres URI.", file=sys.stderr)
        return 1

    url = with_ssl(args.database_url)
    host = urlparse(url).hostname
    print(f"Connecting to {host} …")
    conn = psycopg2.connect(url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), version()")
            db, version = cur.fetchone()
            print(f"Connected: db={db}")
            print(f"Engine: {version.split(',')[0]}")

            run_sql(cur, SCHEMA.read_text(encoding="utf-8"), "base schema (db/schema.sql)")

            for fname in MIGRATIONS:
                path = MIGRATIONS_DIR / fname
                ver = fname.replace(".sql", "")
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS schema_migrations (
                      version TEXT PRIMARY KEY,
                      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                      description TEXT
                    )
                    """
                )
                cur.execute("SELECT 1 FROM schema_migrations WHERE version = %s", (ver,))
                if cur.fetchone():
                    print(f"  skip {ver} (already applied)")
                    continue
                sql = path.read_text(encoding="utf-8")
                marker = "-- >>> ENUMS_COMMIT_POINT <<<"
                if marker in sql:
                    part1, part2 = sql.split(marker, 1)
                    run_sql(cur, part1, f"{fname} enums")
                    run_sql(cur, part2, f"{fname} body")
                else:
                    run_sql(cur, sql, fname)

            # Demo imports need owner-like access without RLS blocking seed rows
            cur.execute(
                """
                DO $$
                DECLARE r record;
                BEGIN
                  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
                    BEGIN
                      EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', r.tablename);
                    EXCEPTION WHEN OTHERS THEN NULL;
                    END;
                  END LOOP;
                END $$;
                """
            )
            cur.execute("SELECT count(*) FROM schema_migrations")
            print(f"schema_migrations rows: {cur.fetchone()[0]}")
            cur.execute(
                "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
            )
            print(f"public tables: {cur.fetchone()[0]}")
    finally:
        conn.close()

    if args.import_sample:
        from subprocess import check_call

        cmd = [
            sys.executable,
            str(ROOT / "db" / "import_sample_data.py"),
            "--database-url",
            url,
        ]
        if args.reset:
            cmd.append("--reset")
        print("Importing sample workbook …")
        check_call(cmd, cwd=str(ROOT))

    print("Done. Point the API at this URL:\n  DATABASE_URL=<your-supabase-uri>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
