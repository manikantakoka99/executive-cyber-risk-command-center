# ECC Database v2 — Phase 1 Foundation

**Status:** Implemented (additive migration)  
**Non-goals:** risk scoring formulas, live connectors, frontend redesign, fake sample scores

## Purpose

Evolve the MVP PostgreSQL model into an enterprise-ready foundation for:

```
Signals → Normalize → Entity Resolution → Dedup → Correlate
  → Risk Scenario → Likelihood + Impact → Inherent/Residual Risk
  → Prioritization → Tolerance → Decision → Action → Verification → Feedback
```

This phase creates **tables, constraints, RLS, and backfills** only.

---

## A. Current schema (pre-v2) — preserved

| Group | Tables |
|-------|--------|
| Tenancy | `organizations`, `users` |
| Domains | `risk_domains`, `org_domain_subscriptions` |
| Scores | `domain_risk_snapshots`, `enterprise_risk_score_snapshots` |
| Findings / impact | `risk_findings`, `business_impact_assessments` |
| Decisions | `executive_decisions`, `decision_action_log` |
| Compliance | `compliance_frameworks`, `org_compliance_status` |
| Activity / reports / audit | `command_center_activity`, `generated_reports`, `audit_log` |

---

## B. New table groups

### Tenancy / RBAC
| Table | Purpose |
|-------|---------|
| `roles` | System + legacy-compatible role codes |
| `permissions` | Capability codes (foundation seed) |
| `role_permissions` | Role → permission |
| `user_roles` | User ↔ role (multi-role; `is_primary`) |
| `v_user_primary_role` | Compatibility view for API |

### Business context
| Table | Purpose |
|-------|---------|
| `business_units` | Org units |
| `business_processes` | Processes under units |
| `assets` | Canonical assets (first-class) |
| `asset_identifiers` | IP / hostname / cloud id / … (unique per org+type+value) |
| `asset_relationships` | depends_on / connects_to / hosts / … |
| `asset_business_processes` | Asset ↔ process |

### Connector foundation
| Table | Purpose |
|-------|---------|
| `connectors` | Org + domain connector registry (`secret_ref` / `config_ref` only) |
| `connector_sync_runs` | Sync telemetry / checkpoints |

### Ingestion / signals
| Table | Purpose |
|-------|---------|
| `raw_events` | Immutable intake; unique `(org_id, connector_id, source_event_id)` |
| `security_signals` | Canonical normalized events |

### Risk scenarios
| Table | Purpose |
|-------|---------|
| `risk_scenarios` | Central business-risk object |
| `risk_scenario_*` | M2M: domains, findings, signals, assets |

### Controls / assessment / policy
| Table | Purpose |
|-------|---------|
| `controls`, `scenario_controls` | Control inventory + effectiveness placeholders |
| `likelihood_assessments`, `impact_assessments` | Store future likelihood/impact results |
| `risk_assessments`, `risk_assessment_factors` | Inherent/residual + explainability rows |
| `risk_policies`, `risk_policy_factors`, `risk_tolerance_rules` | Versioned policy + tolerance |

### Evidence / actions / verification
| Table | Purpose |
|-------|---------|
| `evidence`, `scenario_evidence` | Why was this calculated / decided |
| `actions` | Remediation tasks (separate from `decision_action_log`) |
| `risk_verifications` | Closed-loop verification |

### Compliance extensions
| Table | Purpose |
|-------|---------|
| `framework_controls` | Framework requirement catalog |
| `compliance_assessments` | Org assessments / gaps linking to evidence/scenarios |

### Meta
| Table | Purpose |
|-------|---------|
| `schema_migrations` | Applied migration versions |

---

## C. Existing tables modified

| Change | Detail |
|--------|--------|
| `users` | **Dropped** `role` column → RBAC via `user_roles` |
| `risk_findings` | Added `asset_id`, `fingerprint`, `first_seen_at`, `last_seen_at`, `source`; kept `affected_asset` text |
| `executive_decisions` | Added nullable `scenario_id` (kept `finding_id` for MVP) |
| `audit_log` | Added `correlation_id`, `request_id` |
| Snapshots / compliance | Added 0–100 CHECK constraints |

---

## D. Intentionally preserved

All MVP tables and sample-compatible columns listed in section A.  
`decision_action_log` remains the **audit trail of decision clicks**; `actions` is the **remediation work item**.

---

## E. Intentionally deprecated

| Item | Status |
|------|--------|
| `users.role` | **Removed** |
| `user_role_name` enum | Unused by users table; retained in DB for now (harmless) |
| Free-text-only asset identity | Deprecated as SoR; `affected_asset` kept as legacy display/backfill source |

---

## F. Tenant / RLS strategy

1. Every tenant entity has `org_id` (directly).
2. Composite FKs `(org_id, asset_id)`, `(org_id, scenario_id)`, etc. prevent cross-tenant links where PostgreSQL allows.
3. Triggers block cross-tenant `risk_scenario_findings` and `actions→decisions`.
4. RLS + FORCE enabled on new tenant tables using `app.current_org_id`.
5. App still filters by `org_id` in SQL (defense in depth). Docker role `ecc` bypasses RLS (owner); production should use `ccc_app`.

---

## G. Index strategy

Prioritized:
- `(org_id, status)`, `(org_id, created_at/observed_at/snapshot_at DESC)`
- `(org_id, asset_id)`, `(org_id, risk_domain_id)`
- Uniques: connector source event id, asset identifiers, role/permission codes, policy versions

No blind “index every column.”

---

## H. Migration strategy

```bash
# 1) Apply v2 foundation (idempotent)
.venv-ecc/bin/python db/apply_migration_v2.py

# 2) Reload sample workbook (maps roles → user_roles, assets from findings)
.venv-ecc/bin/python db/import_sample_data.py --reset

# 3) Validate
.venv-ecc/bin/python db/validate_import.py
.venv-ecc/bin/python db/validate_v2.py
cd server && DATABASE_URL=postgresql://ecc:ecc_dev_password@localhost:5433/cyber_command_center npm test
```

Fresh Docker volumes also mount `db/migrations/001_ecc_v2_foundation.sql` as `02_*.sql` after `schema.sql`.

Backfill behavior:
- `users.role` → `user_roles` (before column drop)
- `risk_findings.affected_asset` → `assets` + `finding.asset_id`

---

## I. Future risk-engine usage (not implemented yet)

| Stage | Tables to write |
|-------|-----------------|
| Ingest | `raw_events` → `security_signals` |
| Correlate | `risk_scenarios` + junction tables |
| Score | `likelihood_*`, `impact_*`, `risk_assessments` + `risk_assessment_factors` |
| Policy | Read `risk_policies` / `risk_policy_factors` / `risk_tolerance_rules` |
| Decide | `executive_decisions.scenario_id` |
| Act / verify | `actions`, `risk_verifications`, `evidence` |

---

## J. Product decisions still needed

1. Exact factor catalogs and weights inside `risk_policy_factors` (must not invent).
2. Whether legacy demo role codes (`cxo`, `domain_analyst`, …) remain long-term vs migrate UI to `CXO` / `SECURITY_ANALYST`.
3. When to make `executive_decisions.scenario_id` NOT NULL and retire finding-centric decisions.
4. Production app DB role (`ccc_app`) vs owner `ecc` for RLS enforcement.
5. Whether `business_impact_assessments` (MVP finding-level AED) merges into `impact_assessments` (scenario-level) later.
