# YVI DWAN ECC — Future-State Technical Architecture

**Title:** YVI DWAN Executive Cyber Risk Command Center — Future-State Technical Architecture  
**Subtitle:** From Security Signals → Business Risk → Executive Decision → Closed Loop  

> This document describes the **target / future** architecture that implements the intended ECC concept.  
> It is **not** a diagram of the current MVP (snapshot display + sample import).

## Artifacts

| File | Purpose |
|------|---------|
| [ecc-future-architecture.svg](./ecc-future-architecture.svg) | Presentation-ready vector diagram |
| [ecc-future-architecture.png](./ecc-future-architecture.png) | 16:9 raster (≥1920×1080) |
| [ecc-future-architecture.pdf](./ecc-future-architecture.pdf) | Slide / print export |
| [ecc-future-architecture.mermaid](./ecc-future-architecture.mermaid) | Editable flowchart source |

## Story this diagram tells (≈60 seconds)

1. **Domain solutions** (SOC, IAM, Cloud, VAPT, Compliance, PCI, OT, AI, TPRM, …) produce security and compliance **signals**. ECC aggregates; it does not replace them.  
2. **Ingestion** accepts those signals via connectors/adapters, stores raw evidence, and validates schema/tenant.  
3. **Normalization & correlation** parse into a canonical ECC event, map taxonomy, resolve assets/entities, deduplicate, attach business context, and correlate across domains into one **correlated risk context**.  
4. **Risk / impact engine** computes **Likelihood** (rules/policy model) and **Business Impact** (quantification) in parallel, then **Risk = f(Likelihood, Impact)**. Risks are classified, prioritized, and entered in the enterprise risk register.  
5. **Executive risk tolerance** compares calculated risk vs configured appetite (org / BU / criticality). Above threshold → escalate; else continue monitoring.  
6. **Executive decision** surfaces Risk → Impact → Recommendation → Action on the ECC dashboard; decisions are recorded and owners assigned.  
7. **Action & closed loop**: remediation produces verification evidence → new signals → re-ingest → re-normalize → re-correlate → **recalculate risk**.

## Six pipeline stages (source-aligned)

| # | Stage | Responsibility |
|---|--------|----------------|
| 01 | Data Ingestion | Connectors, raw event store, schema validation |
| 02 | Normalization & Correlation | Taxonomy, entity resolution, dedup, business context, cross-domain correlation |
| 03 | Risk → Impact Translation | Likelihood engine + business impact engine → risk score & prioritization |
| 04 | Executive Decision | Tolerance check, escalation, dashboard, decision record |
| 05 | Action & Closed-Loop | Assignment, remediation, evidence, feedback into scoring |
| — | Data layer | Logical ERD entities supporting the chain Finding → Impact → Decision → Action Log |

*(Diagram swim-lanes expand stage 02–03 of the product flow into dedicated visual columns for clarity.)*

## Accuracy notes

- Exact scoring **weights**, ML algorithms, and vendor product names are **not** claimed as specified by source PDFs/schema.  
- Likelihood and impact internals are labeled **Proposed implementation** / **Policy / Rules-Based** / **Scoring rules / policy engine**.  
- Technology strip lists **representative** categories (PostgreSQL, React, REST, rules/correlation engines) — not a vendor BOM.  
- Optional future tech (Kafka, graph DB, ML/LLM, K8s) is intentionally omitted unless separately marked optional.

## Core formula (conceptual)

```
Risk = f(Likelihood, Impact)
```

Presented as a conceptual product of Likelihood × Business Impact scores (0–100 each → Risk Score 0–100). No fabricated percentage weights.

## Core data relationship

```
Finding → Business Impact → Executive Decision → Decision Action Log
```

## Regenerating the diagram

```bash
python3 scripts/build_ecc_future_architecture.py
```
