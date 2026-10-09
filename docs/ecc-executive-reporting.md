# ECC Executive Reporting (Phase 5)

## Immutable snapshots

`generated_reports` stores:

- `snapshot_payload` (JSON facts at generation time)
- `content_markdown`
- `content_hash` (SHA-256 of payload)
- `data_as_of`, `generation_version`, `status`

Later DB changes **do not** alter published snapshots.

## Report sections

1. Executive Summary (briefing facts)
2. Enterprise Risk Posture (scenario portfolio)
3. Top Risks
4. Business Impact (known vs unknown)
5. Risk Trend
6. Decisions Required
7. Remediation Progress
8. Compliance Posture (not a safety score)
9. Material Changes
10. Key Recommendations
11. Methodology appendix

## API

`POST /api/ecc/reports/generate` → immutable executive snapshot (default)  
`snapshot: false` → legacy live markdown path  
`GET /api/ecc/reports/:id` → stored snapshot  
`GET /api/ecc/reports/snapshots`

## Briefing

`GET /api/ecc/executive-briefing` — CURRENT POSTURE / WHAT CHANGED / WHAT MATTERS / WHAT NEEDS DECISION / WHAT TO WATCH — each with evidence objects. No LLM scoring.
