# Posture metric signals vs events

## `signal_kind`

| Kind | Meaning | Severity | Correlation |
|------|---------|----------|-------------|
| `event` | Detection / incident-like observation | Only if present in source | Yes (Phase 3) |
| `posture_metric` | Ratio / coverage observation (numerator/denominator) | Not fabricated | No |
| `assessment` | Assessment / governance register observation | Not fabricated | No |
| `compliance_observation` | Compliance / control evidence observation | Not fabricated | No |

## Classification (deterministic)

1. Continuous Compliance / PCI domains → `compliance_observation`
2. AI governance / AI-SPM assessment-style categories → `assessment`
3. Detection categories (EDR/SIEM/sandbox/…) **and** event-like sample fields (`verdict`, `incident`, `malware`, XML `<severity>`, blocked actions) → `event`
4. Else if numerator/denominator present → `posture_metric`

## Posture fields

- `metric_id`
- `numerator` / `denominator`
- `quality_flag` (e.g. `missing_timestamp`, `no_event_severity`, `unmapped_domain`)
- `tool_category`

## Timestamps

`observed_at` comes from source `collected_at` / payload timestamps when present.  
Missing time → `missing_timestamp` quality flag. **Never** silently substitute `now()` as event time.
