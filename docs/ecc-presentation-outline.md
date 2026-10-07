# ECC Presentation Outline

**Deliverable:** `ECC_R&D_and_Implementation_Presentation.pptx`  
**Audience:** Product / delivery / CXO stakeholders  
**Tone:** Executive, evidence-based, implementation-complete for MVP  

---

## Slide map

| # | Title | Purpose | Visual |
|---|-------|---------|--------|
| 1 | Title | Product identity | Brand only |
| 2 | Agenda | Navigation | None |
| 3 | Problem | Why ECC exists | None |
| 4 | Product principle | Aggregation layer + R→I→D→A | Flow bullets |
| 5 | Source materials | What drove the build | File list |
| 6 | Reference UI baseline | HTML / preview intent | `reference-preview.jpg` |
| 7 | Implemented Command Center | Live data-backed UI | `chrome-overview.png` |
| 8 | Architecture | Smallest viable stack | Diagram bullets |
| 9 | Data model | Schema entities | Entity groups |
| 10 | Sample data | Import + validation | Counts |
| 11 | KPI model | How numbers are derived | Table |
| 12 | Executive journeys | J1–J4 | Numbered |
| 13 | Decision workflow | Approve / request info / audit | States |
| 14 | Security & tenancy | Org isolation + roles | Checklist |
| 15 | What we shipped | MUST-HAVE + hardening | Two columns |
| 16 | Test evidence | Validation gates | Pass list |
| 17 | Limitations | Honest scope | Bullets |
| 18 | Next phase | Recommended roadmap | Phased |
| 19 | How to run | Local demo | Commands |
| 20 | Close | Ask / summary | One line |

---

## Key messages (must appear)

1. ECC aggregates 12 domain solutions — it does **not** replace SOC/IAM/CSPM/etc.
2. Operating chain: **Risk → Impact → Decision → Action → Closed Loop**.
3. Dashboard values come from **PostgreSQL + sample workbook**, not hardcoded HTML mockup numbers.
4. Overview decision queue is the primary CXO interaction (inline Approve / Request More Information).
5. Multi-tenant org scoping is enforced **server-side**.
6. MVP is demonstrable today; SSO/RLS/live feeds are next.

---

## Verified facts to cite

- Stack: PostgreSQL 16 · Fastify · React + Vite  
- Sample: 5 orgs · 12 domains · 15 findings · 15 decisions  
- Al Dhabi awaiting CXO = 0 (valid empty); Falcon = 2 (actionable demo)  
- Tests: overview/security unit tests, E2E decision flow, import validation, TypeScript build  

---

## Asset plan

| Asset | Use |
|-------|-----|
| `docs/presentation-assets/reference-preview.jpg` | Reference mockup slide |
| `docs/presentation-assets/chrome-overview.png` | Implemented overview slide |
| Fallback: `reference/preview.jpg` | If presentation-assets copy missing |

No new browser capture required for this deliverable.
