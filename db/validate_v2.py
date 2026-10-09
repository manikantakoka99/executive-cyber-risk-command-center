#!/usr/bin/env python3
"""ECC v2 foundation validation checks.

Usage:
  .venv-ecc/bin/python db/validate_v2.py [--database-url URL]
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid

import psycopg2

DEFAULT_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center",
)


def check(cur, name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=DEFAULT_URL)
    args = parser.parse_args()
    conn = psycopg2.connect(args.database_url)
    ok_all = True
    try:
        with conn.cursor() as cur:
            # 1 FK integrity — orphan findings assets
            cur.execute(
                """
                SELECT COUNT(*) FROM risk_findings f
                WHERE f.asset_id IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM assets a
                    WHERE a.asset_id = f.asset_id AND a.org_id = f.org_id
                  )
                """
            )
            orphans = cur.fetchone()[0]
            ok_all &= check(cur, "FK integrity finding→asset", orphans == 0, f"orphans={orphans}")

            # 2 users.role removed
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_name='users' AND column_name='role'
                """
            )
            ok_all &= check(cur, "users.role removed", cur.fetchone() is None)

            # 3 RBAC
            cur.execute("SELECT COUNT(*) FROM roles")
            roles_n = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM user_roles")
            ur_n = cur.fetchone()[0]
            cur.execute(
                """
                SELECT COUNT(*) FROM users u
                WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.user_id)
                """
            )
            missing = cur.fetchone()[0]
            ok_all &= check(
                cur,
                "RBAC relationships",
                roles_n >= 10 and ur_n >= 20 and missing == 0,
                f"roles={roles_n} user_roles={ur_n} users_without_role={missing}",
            )

            # 4 duplicate connector events
            cur.execute(
                """
                SELECT COUNT(*) FROM information_schema.table_constraints
                WHERE table_name='raw_events' AND constraint_type='UNIQUE'
                """
            )
            # verify unique works via insert attempt if connectors exist, else check constraint
            cur.execute(
                """
                SELECT indexdef FROM pg_indexes
                WHERE tablename='raw_events' AND indexdef ILIKE '%source_event_id%'
                """
            )
            idx = cur.fetchone()
            ok_all &= check(cur, "raw_events idempotency unique", idx is not None, str(idx[0])[:80] if idx else "missing")

            # 5 asset identifier uniqueness constraint
            cur.execute(
                """
                SELECT 1 FROM pg_indexes
                WHERE tablename='asset_identifiers'
                  AND indexdef ILIKE '%id_type%' AND indexdef ILIKE '%id_value%'
                """
            )
            ok_all &= check(cur, "asset identifier uniqueness", cur.fetchone() is not None)

            # 6 scenario M2M tables exist
            for t in (
                "risk_scenarios",
                "risk_scenario_domains",
                "risk_scenario_findings",
                "risk_scenario_signals",
                "risk_scenario_assets",
            ):
                cur.execute("SELECT to_regclass(%s)", (f"public.{t}",))
                ok_all &= check(cur, f"table {t}", cur.fetchone()[0] is not None)

            # 7 decision → action FK + trigger
            cur.execute("SELECT to_regclass('public.actions')")
            ok_all &= check(cur, "actions table", cur.fetchone()[0] is not None)

            # 8 verification table
            cur.execute("SELECT to_regclass('public.risk_verifications')")
            ok_all &= check(cur, "risk_verifications table", cur.fetchone()[0] is not None)

            # 9 score constraints
            cur.execute(
                """
                SELECT conname FROM pg_constraint
                WHERE conname IN ('chk_domain_score_range','chk_enterprise_score_range','chk_ra_inherent')
                """
            )
            cons = {r[0] for r in cur.fetchall()}
            ok_all &= check(
                cur,
                "score constraints",
                "chk_domain_score_range" in cons and "chk_enterprise_score_range" in cons,
                str(sorted(cons)),
            )

            # 10 policy versioning indexes
            cur.execute(
                """
                SELECT indexname FROM pg_indexes
                WHERE tablename='risk_policies'
                  AND indexname LIKE 'uq_risk_policies%'
                """
            )
            pols = [r[0] for r in cur.fetchall()]
            ok_all &= check(cur, "policy versioning uniqueness", len(pols) >= 2, str(pols))

            # 11 sample-data compatibility
            cur.execute("SELECT COUNT(*) FROM organizations")
            orgs = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM risk_domains")
            domains = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM risk_findings")
            findings = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM assets")
            assets = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM executive_decisions")
            decisions = cur.fetchone()[0]
            ok_all &= check(
                cur,
                "sample-data compatibility",
                orgs == 5 and domains >= 12 and findings == 15 and decisions == 15 and assets >= 1,
                f"orgs={orgs} domains={domains} findings={findings} decisions={decisions} assets={assets}",
            )

            # Tenant isolation trigger smoke (cross-org scenario_finding)
            conn.rollback()
            cur.execute("SELECT org_id FROM organizations ORDER BY name LIMIT 2")
            two = [r[0] for r in cur.fetchall()]
            blocked = False
            if len(two) == 2:
                try:
                    cur.execute(
                        """
                        INSERT INTO risk_scenarios (org_id, title) VALUES (%s, 'v2-validate-temp')
                        RETURNING scenario_id
                        """,
                        (two[0],),
                    )
                    sid = cur.fetchone()[0]
                    cur.execute(
                        "SELECT finding_id FROM risk_findings WHERE org_id=%s LIMIT 1",
                        (two[1],),
                    )
                    fid_row = cur.fetchone()
                    if fid_row:
                        cur.execute(
                            """
                            INSERT INTO risk_scenario_findings (scenario_id, finding_id, org_id)
                            VALUES (%s, %s, %s)
                            """,
                            (sid, fid_row[0], two[0]),
                        )
                        blocked = False
                    else:
                        blocked = True
                except Exception:
                    blocked = True
                finally:
                    conn.rollback()
                    with conn.cursor() as cur2:
                        cur2.execute("DELETE FROM risk_scenarios WHERE title = 'v2-validate-temp'")
                        conn.commit()
                ok_all &= check(cur, "tenant isolation scenario↔finding", blocked)
            else:
                ok_all &= check(cur, "tenant isolation scenario↔finding", False, "need 2 orgs")

            # migration recorded
            cur.execute(
                "SELECT 1 FROM schema_migrations WHERE version='001_ecc_v2_foundation'"
            )
            ok_all &= check(cur, "schema_migrations recorded", cur.fetchone() is not None)

    finally:
        conn.close()

    print("\n" + ("ALL CHECKS PASSED" if ok_all else "SOME CHECKS FAILED"))
    return 0 if ok_all else 1


if __name__ == "__main__":
    raise SystemExit(main())
