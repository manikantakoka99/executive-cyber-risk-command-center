# ECC Sample Ingestion Proof (Phase 6)

## What this proves

ECC can ingest **heterogeneous synthetic source rows** from:

`reference/CyberCommandCenter_Tool_To_Risk_Domain_Solution.xlsx`

via a vendor-neutral connector contract:

```
Workbook fixture
  → ecc.sample_workbook adapter
  → raw_events (payload preserved)
  → validation
  → canonical security_signals / observations
  → entity resolution
  → deduplication
  → risk-ready data (events → Phase 3 correlation)
```

## What this does NOT prove

- Live Sentinel / Splunk / CrowdStrike / Wazuh / etc. connectivity
- That all 127 listed products are production-ready integrations
- That the workbook’s **Domain Risk Calc** / enterprise composite is ECC’s risk engine

The workbook is a **SOURCE FIXTURE**. After normalization, the **current** Phase 3–5 risk engine remains authoritative (scenario → L/I → inherent → controls → residual). ECC does **not** average the 12 domain scores from the sheet.

## Synthetic

All payloads are labeled synthetic. Adapter vendor metadata includes `synthetic: true`.

## Commands

```bash
docker compose up -d
cd server && npx tsx -e "import('./src/db.js')" # ensure DATABASE_URL
# Apply migration 006 if needed:
../.venv-ecc/bin/python ../db/apply_migrations.py --only 006

cd server && npm run dev
cd web && npm run dev
```

UI: http://localhost:5173/ingestion  

API:

```bash
# headers: X-Org-Id + X-User-Id (CXO)
POST /api/ecc/ingestion/sample-workbook/reset
POST /api/ecc/ingestion/sample-workbook/run
GET  /api/ecc/ingestion/sample-workbook/status
GET  /api/ecc/ingestion/sample-workbook/results
GET  /api/ecc/ingestion/sample-workbook/trace/:signalId
```

Disable outside demo: `ECC_ENABLE_SAMPLE_INGESTION=false`

## Demo flow

1. Open **Ingestion**
2. Show source workbook name
3. **Reset + Run ingestion**
4. Show metrics (received / raw / canonical / posture / duplicates)
5. Open **Trace** on one sample
6. Show original payload vs canonical fields
7. Open **Intelligence** / **Risk Domains**
8. Open a scenario only if an **event** signal correlated — explain separation from workbook scores

## Limitations

- Fixture JSON export of the sheet (xlsx remains the reference source)
- Entity resolution exact-match only; most sample hosts remain unresolved
- Posture metrics do not create scenarios
- Real vendor connectors still need credentials, network, licensing, and sample payload validation
