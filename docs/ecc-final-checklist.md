# ECC Final Implementation Checklist

**Review date:** 2026-10-05  
**Against:** HTML mockup, High-Level Flow, ERD, `schema.sql`, sample XLSX, current codebase.

---

## 1. Review of R&D vs source materials

### Contradictions

| Issue | Source truth | What we introduced | Resolution |
|-------|--------------|--------------------|------------|
| Hero KPI numbers | HTML shows 62 / AED 4.2M / 81% / 3 | Sample Al Dhabi is ~42.83 / ~5.1M / 80% / **0 awaiting** | Keep DB-derived values (correct). Do not hardcode HTML. |
| “Decisions Awaiting CXO” vs list | HTML list count = KPI count (3 open) | API KPI = `awaiting_decision` only, but overview list also included `info_requested` | **Contradiction.** Queue for “Awaiting Executive Action” must match awaiting KPI; show `info_requested` separately or under Decisions module. |
| Default tenant demos the core flow | HTML brands Al Dhabi with 3 pending actions | Sample Al Dhabi has **zero** `awaiting_decision` | Keep Al Dhabi as default brand, but E2E MUST work when switching to Falcon/Meridian/Burj; overview empty-state must point to Decisions / other orgs. |
| Action buttons on overview | HTML: **Approve &lt;recommended&gt;** + **Request More Detail** inline | UI only links “Review & Act” | Missing mockup fidelity for the primary executive action surface. |
| Decline / Close | Schema `decision_status` includes declined/closed; HTML shows only Approve + Request More Detail | We put all four on detail page | Correct vs schema. Overview SHOULD mirror HTML (2 buttons); Decline/Close on detail is fine. |
| “Incidents” nav | HTML topnav includes Incidents | We omitted dedicated module | Correct — Flow says ECC is not SOC/IR. Map critical findings under Findings. |
| “Live” | Mockup says Live · Updated 2 min ago | We poll + show relative `asOf` | Acceptable; must not fake Live if API down. |
| Compliance scope on impacts | Schema has `compliance_scope_impact` | Sample rows often `NULL` | Not a product bug; UI must tolerate empty compliance scope. |
| Enterprise score math | Flow: Likelihood × Impact; sample enterprise ≈ mean of domain snapshots | We display snapshots + documented Track B formula | Correct for MVP: do not recompute over sample. |

### Missing functionality (for complete R→I→D→A)

1. **Inline executive actions on Overview** (Approve recommended action / Request more info) with immediate refresh of queue, activity, KPI.
2. **Explicit chain UI** on Decision/Finding: Finding (Risk) → Impact (AED/BU/scope) → Decision → Action history (closed loop visible).
3. **Post-action closed loop**: activity feed + action log + status change verified in UI without manual reload gymnastics.
4. **Queue/KPI consistency**: awaiting list ≡ awaiting count.
5. **Infra reliability**: compose/import must be the documented path; Postgres was down during review — runbook must be one-command recoverable.

### Unnecessary complexity (defer / avoid deepening)

- Track B live score recomputation engine
- Full RBAC matrix beyond decision mutate checks
- Separate `/activity` page (overview panel enough)
- Report file filesystem + content route polish
- Rate limiting / RLS session vars as day-one blockers
- Persona toggles from old demo
- FAIR / AI narrative
- Dedicated Incidents module
- WebSockets

### Assumptions we introduced (flag explicitly)

1. Demo auth via `X-Org-Id` / `X-User-Id` (not in source files; required to run multi-tenant locally).
2. Default risk appetite = 50 (not in schema/sample).
3. Open exposure = sum of impacts for findings in `open|acknowledged|in_remediation`.
4. Compliance posture = average of latest per-framework `coverage_pct`.
5. Board briefing = Markdown assembled from overview aggregates (schema has `file_url`, not content column).
6. `program_office` may request-info/close; only `cxo` approve/decline.

---

## 2. Checklist

### MUST HAVE (implement now — blocks R→I→D→A)

- [x] Postgres up + sample data loaded + validation green
- [x] Overview KPIs entirely query-derived (no hardcoded mockup numbers)
- [x] Risk by Domain from latest snapshots; drill to domain → findings
- [x] Finding detail shows **Risk + Business Impact** (AED, downtime/hr, BU, compliance scope if present)
- [x] Decision detail shows **Risk → Impact → Recommended** chips + linked finding/impact
- [x] Overview “Decisions Awaiting Executive Action” lists **only** `awaiting_decision` (count matches KPI)
- [x] Overview inline actions: **Approve** (label from `recommended_action`) + **Request More Information**
- [x] Decision mutations persist: status, `decision_action_log`, `command_center_activity`, `audit_log`
- [x] After action, overview/decision UI refresh shows updated status / removed from awaiting queue / new activity
- [x] Org switcher works across sample tenants (so Falcon awaiting decisions are actionable)
- [x] Tenant isolation on decision read/mutate

**Verified:** `db/e2e_must_have_flow.py` + `server/src/overview.test.ts` (Falcon queue ≡ KPI).

### SHOULD HAVE (after MUST flow works)

- [ ] Decline / Close on decision detail (schema-complete; already partially present — harden + test)
- [ ] Compliance page + overview bars
- [ ] 6-month risk trend chart from enterprise snapshots
- [ ] Board briefing generate/export from live aggregates
- [ ] Audit log page
- [ ] Loading / empty / error states polished
- [ ] Polling + honest last-updated timestamp
- [ ] Role gating visible in UI (disable Approve for non-cxo)

### NICE TO HAVE

- [ ] Dedicated `/activity` page
- [ ] Incidents nav alias → filtered critical findings
- [ ] Decision aging / SLA badges
- [ ] “What changed” score delta explainer panel
- [ ] PDF export
- [ ] Real SSO + Postgres RLS session (`app.current_org_id`)
- [ ] Risk appetite config table
- [ ] Live score regeneration engine (Track B)
- [ ] WebSockets / SSE

### OUT OF SCOPE

- Replacing SOC/MDR, IAM, CSPM, VAPT, etc.
- Live domain feed adapters / SOAR remediation
- FAIR Monte Carlo / AI-invented scores
- Regulator e-filing
- Kubernetes / microservices rewrite
- Hardcoding HTML mockup KPI values

---

## 3. Definition of done for MUST HAVE

A CXO can:

1. Open Overview for an org with awaiting decisions (e.g. Falcon).
2. See Risk domain elevated → open finding → see Impact AED.
3. From Overview (or Decision detail), Approve or Request More Information.
4. Observe decision leave awaiting queue, action history entry, activity feed update, audit row.

That is the complete **Risk → Impact → Decision → Action** loop with supplied sample data.
