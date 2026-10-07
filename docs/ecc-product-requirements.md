# ECC Product Requirements

**Product:** YVI DWAN Executive Cyber Risk Command Center (ECC)  
**Audience:** CXO, Board / Audit Committee, Program Office, Domain Analyst, Auditor  

---

## 1. Problem

Executives receive many domain dashboards but lack one **business-context command view** that translates cyber signals into impact, decisions, and closed-loop actions.

## 2. Solution

An executive aggregation layer that consolidates 12 YVI domain solutions into:

**Risk → Impact → Decision → Action → Closed Loop**

## 3. Non-goals (MVP)

- Replacing any upstream domain tool (SOC, IAM, CSPM, etc.)
- Full FAIR Monte Carlo CRQ
- Automated SOAR remediation
- Live production feed adapters from all 12 domains
- Regulator e-filing automation
- Generative AI score invention

## 4. Personas & permissions

| Role (`user_role_name`) | Primary jobs | Decision actions |
|-------------------------|--------------|------------------|
| `cxo` | Overview, approve/decline decisions | Approve, Request info, Decline, Close |
| `board_member` | Overview, reports (read) | Read-only decisions |
| `program_office` | Reports, activity, compliance | Generate reports; limited decision notes |
| `domain_analyst` | Findings / domains drill-down | Escalate (future); no approve |
| `auditor` | Audit log, compliance evidence | Read-only |

MVP local auth: select org + act-as user (demo). Production: SSO + RLS.

## 5. Information architecture (modules)

| Route | Purpose | Include in MVP? |
|-------|---------|-----------------|
| `/overview` | 30-second enterprise posture | **Yes** |
| `/risk-domains` | All subscribed domains | **Yes** |
| `/risk-domains/:id` | Domain score history + findings | **Yes** |
| `/findings` | Open findings list | **Yes** |
| `/findings/:id` | Finding + impact + linked decision | **Yes** |
| `/decisions` | Decision queue + history | **Yes** |
| `/decisions/:id` | Decision workflow | **Yes** |
| `/compliance` | Framework posture | **Yes** |
| `/reports` | Board / regulator reports | **Yes** |
| `/activity` | Command center activity | Soft — panel on overview + page |
| `/audit` | Audit trail | **Yes** (read) |
| `/incidents` | Alias to critical findings / decisions | Optional label only — do not build separate IR module |
| `/settings` | Org switch / demo user | Minimal |

## 6. Core user journeys

### J1 — CXO posture in <30s
Open overview → see enterprise score, trend delta, exposure AED, compliance %, awaiting decisions → know whether to act.

### J2 — Domain drill-down
Click high/critical domain → see headline, score history, open findings → understand why score is elevated.

### J3 — Finding → impact → compliance
Open finding → financial exposure, downtime/hr, BU, compliance scope → recommended decision if linked.

### J4 — Executive action
On decision: Approve / Request More Information / Decline / Close → action log + decision status + activity + audit.

### J5 — Org historical view
Switch org → historical enterprise snapshots, compliance, unresolved findings, past decisions.

### J6 — Board briefing
Program office generates board briefing from current aggregates → stored in `generated_reports` → downloadable HTML/Markdown (MVP).

## 7. Overview widgets (MVP)

**Must have (from mockup + executive questions):**

1. Enterprise Cyber Risk Score + severity + MoM delta + driver summary  
2. Business Impact Exposure (sum open finding exposures)  
3. Compliance Posture (avg latest coverage %)  
4. Decisions Awaiting CXO (`awaiting_decision`)  
5. Risk by Domain (latest snapshot per subscribed domain)  
6. Decisions queue (awaiting + optionally info_requested)  
7. Compliance bars  
8. 6-month enterprise risk trend  
9. Recent activity  

**Add only if clear executive value (MVP yes):**

- Open critical findings count (answers “what is critical?”)  
- What changed since prior snapshot (score delta explanation)  

**Defer:**

- Action-owner workload heatmap  
- Full severity pie (noise unless filtered to open findings)  
- Risk tolerance gauge until appetite config exists (show configurable default threshold line on trend)

## 8. Functional requirements

### FR-1 Data integrity
All overview KPIs derived from PostgreSQL; no hardcoded hero metrics.

### FR-2 Multi-tenancy
Every query scoped by `org_id`. Cross-tenant leakage is a P0 defect.

### FR-3 Decision immutability
Actions append to `decision_action_log`; prior rows never edited.

### FR-4 Explainability
Score surfaces always show narrative driver text from snapshots / findings.

### FR-5 Freshness
UI shows last-updated timestamp from max relevant DB timestamps; polling supported.

### FR-6 Export
Board briefing generated from live aggregates.

## 9. Success metrics

| KPI | Target |
|-----|--------|
| Time to executive insight | < 30 seconds on overview |
| Decision action latency (demo) | < 3 clicks to record decision |
| Data correctness | Validation report matches workbook row counts |
| Tenant isolation tests | 100% pass |

## 10. Acceptance criteria (MVP)

- [ ] Sample Excel importable idempotently into Postgres  
- [ ] Overview KPIs match SQL aggregates for selected org  
- [ ] Domain / finding / decision drill-downs work  
- [ ] Decision actions persist and appear in action log + audit  
- [ ] Compliance and reports pages use DB data  
- [ ] Visual language aligns with HTML mockup (dark, severity accents) without copying static numbers  
