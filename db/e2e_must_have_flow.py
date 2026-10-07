#!/usr/bin/env python3
"""E2E MUST-HAVE: Risk → Impact → Decision → Action against sample data."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

import psycopg2

DB = "postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center"
API = "http://127.0.0.1:4000"
FALCON = "e5082391-0ae2-4ed1-93d6-c11650b39dbb"


def http(method: str, path: str, org: str, user: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Org-Id": org,
            "X-User-Id": user,
        },
    )
    try:
        with urllib.request.urlopen(req) as res:
            raw = res.read().decode()
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return e.code, payload


def main() -> int:
    conn = psycopg2.connect(DB)
    cur = conn.cursor()
    cur.execute(
        "SELECT user_id FROM users WHERE org_id=%s AND role='cxo' LIMIT 1",
        (FALCON,),
    )
    cxo = cur.fetchone()[0]
    cur.execute(
        """SELECT d.decision_id, d.finding_id, d.impact_id, d.title
           FROM executive_decisions d
           WHERE d.org_id=%s AND d.status='awaiting_decision'
           ORDER BY d.escalated_at LIMIT 1""",
        (FALCON,),
    )
    decision_id, finding_id, impact_id, title = cur.fetchone()
    assert finding_id and impact_id, "Decision must link finding + impact (Risk→Impact)"
    cur.execute(
        "SELECT financial_exposure_aed FROM business_impact_assessments WHERE impact_id=%s",
        (impact_id,),
    )
    exposure = cur.fetchone()[0]
    assert exposure is not None and float(exposure) > 0, "Impact must have AED exposure"
    conn.close()

    status, overview = http("GET", "/api/ecc/overview", FALCON, cxo)
    assert status == 200, overview
    assert overview["decisionsAwaitingCxo"] == len(overview["pendingDecisions"])
    assert overview["decisionsAwaitingCxo"] >= 1
    assert all(d["status"] == "awaiting_decision" for d in overview["pendingDecisions"])

    before = overview["decisionsAwaitingCxo"]
    status, finding = http("GET", f"/api/ecc/findings/{finding_id}", FALCON, cxo)
    assert status == 200, finding
    assert finding["financialExposureAed"] is not None
    assert any(d["decisionId"] == decision_id for d in finding.get("decisions", []))

    status, decision = http("GET", f"/api/ecc/decisions/{decision_id}", FALCON, cxo)
    assert status == 200, decision
    assert decision["riskSummary"]
    assert decision["impactSummary"]
    assert decision["recommendedAction"]

    status, acted = http(
        "POST",
        f"/api/ecc/decisions/{decision_id}/approve",
        FALCON,
        cxo,
        {"notes": "E2E MUST approve"},
    )
    assert status == 200 and acted.get("ok") is True, acted
    assert acted["status"] == "approved"
    assert acted["decision"]["history"], "action log must exist"

    status, after = http("GET", "/api/ecc/overview", FALCON, cxo)
    assert status == 200, after
    assert after["decisionsAwaitingCxo"] == before - 1
    assert all(d["decisionId"] != decision_id for d in after["pendingDecisions"])
    assert any(
        "approved" in a["summary"].lower() or title.split()[0].lower() in a["summary"].lower()
        for a in after["activity"]
    ), after["activity"][:3]

    # tenant isolation
    cur_org = "2accc7de-f693-4b19-8fe8-6db501be05e2"
    conn = psycopg2.connect(DB)
    cur = conn.cursor()
    cur.execute(
        "SELECT user_id FROM users WHERE org_id=%s AND role='cxo' LIMIT 1",
        (cur_org,),
    )
    other = cur.fetchone()[0]
    conn.close()
    status, _ = http("GET", f"/api/ecc/decisions/{decision_id}", cur_org, other)
    assert status == 404, "cross-tenant decision read must 404"

    print("E2E MUST-HAVE PASS")
    print(f"  approved decision: {title}")
    print(f"  awaiting before→after: {before}→{after['decisionsAwaitingCxo']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print("E2E MUST-HAVE FAIL:", e, file=sys.stderr)
        raise SystemExit(1)
