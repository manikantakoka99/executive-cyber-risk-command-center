# PRD — Executive Cyber Risk Command Center (YVI #14)

## 1. Problem

CXOs receive many technical dashboards (SOC, cloud, identity, vuln, GRC) but lack a **single business-context view** of risk, compliance, threats, and response. Board packs are assembled manually, late, and in technical language.

## 2. Solution

**YVI Executive Dashboard** — a command center that:

1. Ingests signals from every other YVI use case (and external tools).
2. Scores risk across **business, application, identity, cloud, and threat**.
3. Produces a **board-ready narrative** (editable, evidence-linked, exportable).

## 3. Goals & KPIs

| KPI | Definition | Target (pilot) |
|-----|------------|----------------|
| Time to executive insight | Elapsed time from “need a board view” to approved narrative | &lt; 15 minutes (vs multi-hour/day baseline) |
| Recurring managed-security relationship | Client retains monthly insight / board-pack service | Retainer attached to ≥ 70% of pilots |

Secondary: board pack on-time rate, narrative edit distance (trust), drill-down to evidence click-through.

## 4. Non-goals (MVP)

- Full FAIR Monte Carlo / enterprise CRQ platform
- Automated remediation / SOAR replacement
- Replacing SIEM, EDR, or GRC systems of record
- Regulator filing automation (SEC 8-K, etc.)

## 5. Personas

| Persona | Primary job |
|---------|-------------|
| Board / Audit Committee | Oversee cyber as enterprise risk; decide appetite & investment |
| CEO / COO | Understand material business impact |
| CISO | Own narrative accuracy; drill to evidence |
| CFO / CRO | Align $ exposure, insurance, ROI |
| MSSP delivery lead | Produce recurring client insight packs |

## 6. User stories (MVP)

1. As a **CISO**, I can open one home view and see domain scores vs risk appetite.
2. As a **CISO**, I can generate a board narrative draft from current scores and top findings, then edit before export.
3. As a **board member**, I can read a 2-page brief: top scenarios, trends, decisions needed.
4. As an **analyst**, I can click any score and reach underlying findings (mock feeds OK in MVP).
5. As an **MSSP**, I can switch tenant/demo profiles and export a branded PDF pack.

## 7. Functional requirements

### 7.1 Command home
- Overall residual risk vs appetite (clear breach state)
- Five domain tiles: Business, Application, Identity, Cloud, Threat
- Compliance & Response as supporting panels
- QoQ / MoM trend sparklines

### 7.2 Board narrative
- Structured sections: Situation → Material exposure → Progress → Decisions
- AI-assisted draft from metrics + top findings (human-in-the-loop edit)
- Export: Markdown → PDF (MVP); PPTX (phase 1.1)

### 7.3 Feeds
- Internal `RiskFinding` schema + OCSF-friendly JSON adapters
- Demo dataset simulating ≥ 3 upstream use cases
- Freshness timestamp per feed; stale-data warning

### 7.4 Access
- Role views: Board (summary), CISO (full), Analyst (findings)
- Audit log of narrative exports and edits

## 8. Alignment to NACD 2026

Support:

- Standing cyber-risk brief (memo + dashboard)
- Material-incident one-pager mode (template)
- Consistent metrics quarter-over-quarter
- Business language (impact, appetite, remediation), not raw alert volume

## 9. Success for client delivery

1. Interactive demo that feels board-ready in a 30-minute walkthrough.
2. Clear map of which YVI use cases feed which domain scores.
3. Commercial story: license + managed monthly insight retainer.
4. Documented path from MVP → pilot live feeds → FAIR-lite quantification.

## 10. Open questions for client workshop

1. Live vs planned upstream modules?
2. Frameworks / regs in scope?
3. Documented risk appetite owner and thresholds?
4. Current board-pack process (owner, hours, format)?
5. Need for $ risk in v1 vs narrative + trends first?
