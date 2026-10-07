# Architecture — Executive Cyber Risk Command Center

## 1. System context

```
[YVI Use Cases / External Tools]
        │  findings, assets, incidents, controls
        ▼
┌───────────────────┐
│  Feed Adapters    │  OCSF / vendor APIs / webhooks
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  Normalize + Graph│  RiskFinding, Asset, Identity, BusinessContext
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  Risk Engine      │  domain scores, appetite, trends, top scenarios
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  Narrative Engine │  template + optional LLM polish
└─────────┬─────────┘
          ▼
[Executive UI] ── export PDF / PPTX / share link
```

**Principle:** systems of record stay upstream. This product is the **insight & narrative control plane**.

## 2. Canonical data model (MVP)

### RiskFinding
| Field | Type | Notes |
|-------|------|-------|
| id | string | Stable ID |
| source | string | Use-case / tool name |
| domain | enum | business \| application \| identity \| cloud \| threat \| compliance \| response |
| severity | 1–5 | Normalized |
| title | string | Executive-readable |
| description | string | |
| assetIds | string[] | |
| businessTags | string[] | revenue-critical, PII, etc. |
| status | open \| mitigating \| accepted \| closed | |
| detectedAt | ISO datetime | |
| evidenceUrl | string? | Drill-down |

### DomainScore
| Field | Type |
|-------|------|
| domain | enum |
| score | 0–100 residual risk |
| appetite | 0–100 |
| trend | delta vs prior period |
| topFindingIds | string[] |

### BoardNarrative
| Field | Type |
|-------|------|
| period | string |
| situation | markdown |
| materialExposure | markdown |
| progress | markdown |
| decisions | markdown |
| generatedAt | ISO datetime |
| editedBy | string |

## 3. Scoring (MVP — transparent, not black box)

```
domainScore = weightedAvg(severity × businessCriticality × exposure)  → 0–100
enterpriseScore = weightedAvg(domainScores) with threat/identity boosted when active incidents
appetiteBreach = score > appetite for domain or enterprise
```

Weights configurable per client. Document assumptions in the narrative footer.

**Phase 2 (FAIR-lite):** top 5 loss scenarios with loss-exceedance style language (“10% chance of &gt;$X in 12 months”), not a single false-precision ALE.

## 4. Feed contracts

Prefer **OCSF**-aligned JSON for interoperability. MVP ships:

- `POST /api/feeds/findings` — push batch
- `GET /api/scores` — domain + enterprise
- `POST /api/narrative/generate` — draft from current scores
- `GET /api/demo/snapshot` — fixed demo tenant

Stale rule: if `max(detectedAt)` for a domain feed older than SLA (e.g. 24h), UI shows stale banner.

## 5. Frontend

- React + TypeScript + Vite
- Routes: `/` command home, `/narrative`, `/findings`, `/incident-brief`
- Persona toggle: Board | CISO | Analyst
- Charts: domain scores, trends, appetite markers

## 6. Security & trust

- Role-based views; board never sees raw PII in titles by default
- Every score must drill to findings (evidence-backed — KeenSafe lesson)
- Narrative exports logged
- LLM calls: no silent score invention; model only rewrites structured facts

## 7. Deployment shapes

| Mode | Description |
|------|-------------|
| Embedded module | Inside YVI suite, SSO, shared tenants |
| Standalone demo | This repo — mock feeds for sales / workshops |
| MSSP multi-tenant | Phase 2 — per-client packs + branding |

## 8. Suggested tech stack (delivery)

| Layer | Choice |
|-------|--------|
| UI | React 19 + Vite + TypeScript |
| API | Node (Hono/Fastify) or Next API routes |
| DB (pilot) | Postgres + JSONB findings |
| Queue (later) | Redis / SQS for feed ingestion |
| LLM | Client-approved model via API; prompt locked to facts blob |
| Export | `@react-pdf/renderer` or headless print CSS |

## 9. Mapping “feeds from every other use case”

| Upstream theme (examples) | Domain |
|---------------------------|--------|
| BIA / critical process inventory | Business |
| AppSec / ASM / vuln mgmt | Application |
| IAM / PAM / IdP | Identity |
| CSPM / CNAPP / cloud inventory | Cloud |
| SIEM / XDR / threat intel / IR | Threat |
| Control assessments / GRC | Compliance |
| SOAR cases / playbook SLAs | Response |

Exact module IDs should be filled in the client workshop.
