# ECC Compliance Intelligence (Phase 5)

Compliance posture ≠ cyber safety.

## Sources

- `org_compliance_status` (framework coverage)
- `compliance_assessments` / `framework_controls` (gaps)
- `scenario_controls` (effectiveness)

## Views

- Framework coverage %, evidenced vs missing controls, renewal dates, freshness
- Control posture: effective / partial / ineffective / unknown
- Relationship chain when data exists: compliance gap → control → scenario

## API

`GET /api/ecc/compliance/posture`  
`GET /api/ecc/controls/posture`
