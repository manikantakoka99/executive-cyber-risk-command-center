# ECC Risk Scoring

## 1. Design goals

- Explainable to a CXO in one sentence  
- Transparent math (no black-box ML)  
- Compatible with existing snapshot tables  
- Configurable thresholds  
- Supports “why did the number change?”

## 2. SOURCE REQUIREMENTS

Schema stores:

- Domain score `0–100` + `severity` + `headline_detail`  
- Enterprise score `0–100` + `severity` + `driver_summary`  
- Findings with `severity_level`  
- Impacts with AED exposure / downtime  

High-level flow: Likelihood × Impact, prioritize, escalate if exceeds tolerance.

## 3. EXTERNAL RESEARCH (summary)

- Boards prefer residual risk vs appetite + trends (NACD 2026).  
- FAIR is rigorous but heavy; MVP should use transparent ordinal scoring + financial exposure as parallel dimensions (not a single false-precision ALE).  

## 4. RECOMMENDATION — dual-track model

### Track A — Display (MVP authoritative)

**Use persisted snapshots as the system of record for dashboard scores.**

Rationale: sample dataset already contains coherent time-series; recomputing differently would disagree with supplied data and confuse demos.

### Track B — Explain & future generation (documented engine)

When generating *new* snapshots (post-MVP feeds), use:

#### Severity weights

| severity | w |
|----------|---|
| low | 1 |
| medium | 2 |
| high | 4 |
| critical | 8 |

#### Finding risk points (per open finding)

```
points = w(severity)
        × exposureFactor
        × ageFactor
        × statusFactor
```

Where:

- `exposureFactor` = 1.0 default; 1.25 if impact has financial_exposure_aed ≥ 1,000,000; 1.5 if compliance_scope_impact is non-null  
- `ageFactor` = 1.0 if ageDays < 7; 1.15 if < 30; 1.3 if ≥ 30  
- `statusFactor` = 1.0 open/acknowledged; 0.7 in_remediation; 0 accepted_risk/resolved  

#### Domain score (0–100)

```
raw = Σ points for findings in domain (open-ish)
domainScore = min(100, round(20 + raw × 6))  # calibrated band; config later
```

If no open findings: use operational headline heuristics from feed (or hold last score decaying 5%/month) — **out of scope while using snapshots**.

Severity band mapping (configurable):

| score | severity |
|------:|----------|
| 0–24 | low |
| 25–49 | medium |
| 50–74 | high |
| 75–100 | critical |

#### Enterprise score

```
enterpriseScore = average(latest domainScore for active subscriptions)
```

Matches sample behavior (“Composite of 12 monitored risk domains”).

Optional Phase 2 weights: boost `soc_mdr`, `vapt_asm`, `ransomware_readiness` during active critical findings (×1.15 before average).

### Financial exposure (parallel KPI — not mixed into score blindly)

```
businessImpactExposureAed =
  SUM(financial_exposure_aed)
  FOR impacts whose finding.status IN ('open','acknowledged','in_remediation')
  AND org_id = current
```

Showing AED separately avoids implying the 0–100 score *is* money.

### Compliance posture

```
compliancePosturePct = AVG(latest coverage_pct per framework for org)
```

### Decisions awaiting CXO

```
COUNT(*) FROM executive_decisions
WHERE org_id = current AND status = 'awaiting_decision'
```

## 5. Change explanation template

When prior enterprise snapshot exists:

```
Enterprise risk {prior} → {current} ({delta:+d} pts).
Drivers: {driver_summary}.
Top domain movements: {domain deltas}.
Open critical findings: {n}. Exposure: AED {sum}.
```

## 6. Risk tolerance (config)

Default enterprise appetite = **50** (configurable per org in future table; not in schema yet → env `DEFAULT_RISK_APPETITE=50`).

`appetiteBreach = enterpriseScore > appetite`.

## 7. What we will NOT do in MVP

- Invent scores that contradict imported snapshots  
- Hide formula constants  
- Claim FAIR-grade loss expectancy from severity weights  

## 8. ENGINEERING INFERENCE

Sample enterprise scores ≈ mean of domain scores at each month — validating Track B’s simple average for future generation.
