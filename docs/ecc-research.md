# ECC Research Brief — Executive Cyber Risk Command Center

**Status:** Phase 0 discovery complete  
**Date:** 2026-10-05  
**Scope:** Product R&D prior to implementation of the data-backed ECC against the supplied schema and sample workbook.

This document separates evidence sources explicitly.

---

## 1. SOURCE REQUIREMENTS

Material from the supplied authoritative files (`reference/`).

### 1.1 Product intent (High-Level Flow PDF)

The ECC is an **executive aggregation layer** above 12 YVI domain solutions. It does **not** replace SOC/MDR, IAM/PAM, CSPM/CNAPP, ransomware readiness, VAPT/ASM, phishing/BEC, compliance, PCI DSS, OT/ICS, AI governance, third-party risk, or vCISO.

End-to-end flow:

1. **Data Ingestion** — 12 domain feeds  
2. **Normalization & Correlation** — taxonomy, business context, de-duplication  
3. **Risk → Impact Translation** — likelihood×impact, financial exposure, prioritization, tolerance check  
4. **Executive Decision** — CXO reviews risk/impact/compliance; action required?  
5. **Action & Closed-Loop Reporting** — remediation, compliance evidence, board/regulator reports, feedback to scoring  

Principle chain: **Risk → Impact → Decision → Action → Closed Loop**.

### 1.2 Domain model (schema.sql + ERD PDF)

PostgreSQL 16 model (15 tables, multi-tenant `org_id`, RLS intent):

| Entity | Purpose |
|--------|---------|
| `organizations`, `users` | Tenancy & identity / RBAC roles |
| `risk_domains`, `org_domain_subscriptions` | 12 YVI domains + per-org enablement |
| `domain_risk_snapshots` | Point-in-time per-domain scores |
| `enterprise_risk_score_snapshots` | Headline enterprise score + driver narrative |
| `risk_findings` | Underlying signals |
| `business_impact_assessments` | Financial / downtime / BU / compliance scope |
| `executive_decisions`, `decision_action_log` | Decision workflow + immutable history |
| `compliance_frameworks`, `org_compliance_status` | Framework coverage |
| `command_center_activity` | Activity feed |
| `generated_reports` | Board / regulator artifacts |
| `audit_log` | System-wide audit |

Currency convention: **AED** (`NUMERIC(14,2)`).

### 1.3 UI baseline (HTML mockup + preview.jpg)

Dark enterprise overview with:

- Enterprise Cyber Risk Score, Business Impact Exposure, Compliance Posture, Decisions Awaiting CXO  
- Risk by Domain (12 cards)  
- Decisions Awaiting Executive Action (Risk → Impact → Recommended + Approve / Request More Detail)  
- Compliance bars, 6-month risk trend, recent activity  
- Org switcher, Live indicator, Export Board Briefing  

**Important:** mockup numbers (e.g. score 62, AED 4.2M) are **prototype literals**, not the sample dataset.

### 1.4 Sample workbook (CyberCommandCenter_Sample_Data.xlsx)

Exported 05 Oct 2026 from executed schema. Sheets map 1:1 to tables. Validated: **0 FK violations, 0 duplicate PKs**.

| Sheet | Rows |
|-------|------|
| organizations | 5 |
| users | 25 |
| risk_domains | 12 |
| org_domain_subscriptions | 60 |
| domain_risk_snapshots | 360 |
| enterprise_risk_score_snapshots | 30 |
| risk_findings | 15 |
| business_impact_assessments | 15 |
| executive_decisions | 15 |
| decision_action_log | 11 |
| compliance_frameworks | 5 |
| org_compliance_status | 50 |
| command_center_activity | 34 |
| generated_reports | 10 |
| audit_log | 0 |

Default branded org **Al Dhabi Holdings** latest enterprise score ≈ **42.83** (not 62); open financial exposure ≈ **AED 5.10M**; awaiting_decision = **0** (2 approved, 1 info_requested).

### 1.5 Existing repo docs (PRD / ARCHITECTURE / DELIVERY)

Prior YVI #14 demo framed 5 domains (Business/Application/Identity/Cloud/Threat) + narrative export + persona toggle. That is a **sales demo**, not the schema-backed product.

---

## 2. ENGINEERING INFERENCE

Conclusions from inspecting the repository and data (not stated verbatim in source PDFs).

1. **Current app is frontend-only.** `web/` is React 19 + Vite + Recharts + react-router. Values come from `src/data/demo.ts` (hardcoded Northwind Financial). No API, no Postgres, no auth, no importer.

2. **Schema supersedes the older 5-domain demo model.** Domain codes are the 12 YVI solutions. UI and APIs must pivot to that taxonomy while reusing the React/Vite shell and chart library.

3. **Mockup ≠ sample data.** Dashboard must query DB; empty states (zero awaiting decisions) are valid and preferred over fake CXO queues.

4. **PostgreSQL is not installed on the host.** Docker/Podman are available → smallest setup is `docker compose` Postgres + Node API + existing Vite frontend.

5. **Snapshots already encode scores.** Domain and enterprise scores exist as time-series snapshots; MVP should **read** them for KPIs/trends rather than recompute a second score system on every request. A transparent scoring engine can still explain *how* future snapshots should be produced and can recompute for “what changed” narratives.

6. **Cross-org demo tenancy.** Five UAE orgs exist. Org context header + server-side `org_id` filter (+ RLS when using `ccc_app` role) is mandatory.

7. **`info_requested` is mid-workflow.** Treat as open for workflow UIs; “Awaiting CXO” KPI uses `awaiting_decision` only (strict). Secondary badge can show open `info_requested`.

---

## 3. EXTERNAL RESEARCH

Reputable sources informing recommendations (not requirements).

### 3.1 NACD 2026 Cyber-Risk Oversight

- Boards need **business-aligned** cyber reporting (financial/operational language), not alert volume.  
- Standing **cyber-risk brief**: two-page memo + dashboard, at least quarterly + material-incident updates.  
- Dashboards: residual risk vs appetite, trends, remediation progress, compliance/resilience, escalation thresholds.  
- Example KRIs: critical vuln aging, phish click rate, third-party assurance, MTTD/MTTR.  

Sources: NACD Director’s Handbook on Cyber-Risk Oversight (2026) — Principle 5 (measurement/reporting), board reporting toolkit, board-level metrics toolkit.  
https://www.nacdonline.org/

### 3.2 Quantification approaches

| Approach | Fit for ECC MVP |
|----------|-----------------|
| FAIR / Monte Carlo CRQ | Strong for insurers/quant teams; too heavy for MVP; prior repo already deferred FAIR-lite |
| CVSS / severity-only | Technical; insufficient business language |
| Weighted residual score 0–100 with narrative drivers | Transparent, board-legible, matches schema snapshots |
| Loss scenario language for top N | Good Phase 2 add-on (“AED X exposure if exploited”) without claiming ALE precision |

### 3.3 Executive dashboard UX patterns

- Progressive disclosure: overview → domain → finding → decision  
- Severity-driven color, not decorative chrome  
- Decision queues with aging and owner  
- Explainable score deltas (“+6 pts because…”)  

---

## 4. RECOMMENDATION

### Product

Ship a **schema-faithful, multi-tenant ECC** that answers the ten executive questions (how risky / trend / cause / cost / critical / action / decisions / compliance / what changed / what next) using **live PostgreSQL data**.

### Architecture (smallest change)

```
Excel sample → importer → PostgreSQL (compose)
                         ↓
              Node (Fastify) aggregation API  (+ tenant header)
                         ↓
              React/Vite web (visual language from HTML mockup)
```

Do **not** introduce Kubernetes, microservices, or a second frontend framework.

### Scoring

- **Display** enterprise/domain scores from latest snapshots.  
- **Explain** using `driver_summary` / `headline_detail` + open findings + impacts.  
- Document a simple reproducible formula for future snapshot generation (see `ecc-risk-scoring.md`).  
- Defer FAIR Monte Carlo.

### Decisions

Implement Approve / Request Info / Decline / Close with immutable `decision_action_log` + `audit_log` + activity feed updates.

### Live freshness

Polling every 30–60s on overview + manual refresh. Do not claim “Live” without a real last-updated timestamp from DB max(`snapshot_at` / `occurred_at`).

### AI

No generative AI in MVP. Board briefing is template-assembled from DB facts (human-editable later). Mark any future AI as “recommended insight,” never authoritative score.

---

## 5. Gaps vs prior demo

| Prior demo | Target ECC |
|------------|------------|
| 5 synthetic domains | 12 schema domains |
| Hardcoded Northwind | 5 real sample orgs |
| No decisions workflow | `executive_decisions` + action log |
| Markdown narrative only | Board briefing from live aggregates + `generated_reports` |
| No backend/DB | Postgres + aggregation APIs |
| Persona toggle only | Role-aware API + org tenancy |

---

## 6. Open questions (workshop)

1. Risk appetite thresholds per org (not in sample data) — use configurable defaults.  
2. Whether `info_requested` counts toward CXO queue KPI.  
3. Upstream live feed adapters timeline (out of MVP).  
4. Auth IdP (demo uses trusted org/user headers for local MVP).  
