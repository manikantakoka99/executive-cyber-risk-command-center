# ECC Manager Demo — Reset, Seed, Click Path

Synthetic demonstration only. Do **not** claim live Sentinel / Splunk / CrowdStrike / Wazuh integrations or production deployment.

## Hero scenario

**Title:** Potential compromise of externally exposed payment infrastructure  

**Org (default):** Al Dhabi Holdings (`2accc7de-f693-4b19-8fe8-6db501be05e2`)  
**Actor:** CXO (Danielle Johnson)  
**Demo as-of:** `2026-10-07T09:00:00.000Z`  
**Action due (DEMO):** `2026-10-21`  
**Owner label:** Security Engineering  

Hero ID is deterministic per org (printed by prepare).  
Al Dhabi hero ID: `b08b8689-df6c-433a-a976-08a83bec8389`  
Path: `/scenarios/b08b8689-df6c-433a-a976-08a83bec8389`

---

## Commands

From repo root (Postgres on `:5433` via `docker compose up -d`):

```bash
# 1) Database
docker compose up -d

# 2) Prepare demo (reset → seed → verify) — Al Dhabi by default
cd server && npm run demo:prepare

# Optional discrete steps:
# npm run demo:reset
# npm run demo:seed
# npm run demo:verify

# 3) API
cd server && npm run dev
# → http://localhost:4000

# 4) UI
cd web && npm run dev
# → http://localhost:5173
```

HTTP equivalents (CXO / CISO / program_office headers):

```bash
curl -X POST http://localhost:4000/api/ecc/demo/prepare \
  -H "X-Org-Id: 2accc7de-f693-4b19-8fe8-6db501be05e2" \
  -H "X-User-Id: 192e41a4-7898-40c2-ac05-7efae6bc0504"
```

UI: **Risk Scenarios → Prepare Manager Demo**

---

## Exact click path (12 steps)

1. **Overview** (`/`) — enterprise score, outside tolerance, top scenarios, executive queue.  
   *Say:* “ECC begins with the enterprise view rather than raw telemetry.”

2. Open **Hero** from queue or **Risk Scenarios → Open Hero Scenario**.

3. Show **WHAT / WHY / BUSINESS IMPACT / RISK / CONFIDENCE / TOLERANCE**.

4. Show **Correlated inputs** (domains, signals, finding, asset, process, controls, evidence).  
   *Say:* “These inputs are correlated into one business-risk scenario.”

5. Show **Risk calculation** (L · I · Inherent · Control · Residual). Deterministic.

6. Show **Treatment Recommendation** (mitigate).

7. Click **Approve · Mitigate** (creates action for Security Engineering, due DEMO 2026-10-21).

8. Show **Actions** — status open, owner, deadline.

9. **Start** → **Mark completed**.  
   *Say:* “Completing the action alone does not change the risk.”

10. **Verify (success)** — evidence + notes.

11. Confirm **before → after residual** and recalculation message.

12. Show **Risk History** — prior assessment preserved.

Then open **Intelligence** (`/intelligence`) — portfolio, hotspots, decisions, compliance, control posture, material changes, report. Trends may say *Insufficient historical data* (preferred over fake series).

---

## Safety

- Only `is_demo` scenarios + `ecc-demo-*` / `demo_seed` / `source=ecc-demo` rows are reset.
- No invented AED amounts.
- Connector catalog remains vendor-neutral.

## Caveats

- Import-count validators may fail after demo seeds (expected vs workbook baselines).
- Do not run **closed-loop demos** before the live path if you need a clean hero decision flow — `demo:prepare` leaves the hero undecided on purpose.
- Prefer Al Dhabi org; switching orgs mid-demo will change tenant data.
