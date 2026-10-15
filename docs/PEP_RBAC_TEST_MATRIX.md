# Pep: RBAC test matrix (authoritative after product decisions)

Source of truth: `db/dwan_schema.sql` `role_capabilities` + server `command/rbac.ts`.

| Role | Financials | Technical evidence | Decide | Accept risk | Approve policy | Verify | Board pack review | Manage users |
|---|---|---|---|---|---|---|---|---|
| board_member | Y | N | N | N | Y | N | Y | N |
| cxo | Y | N | Y | Y | Y | N | Y | N |
| ciso | Y | Y | Y | N | N (proposes) | Y | Y | N |
| risk_lead | Y | Y | N | Y | N | Y | Y | N |
| domain_analyst | N | Y | N | N | N | Y | N | N |
| program_office | N | N | N | N | N | N | Y | N |
| auditor | Y | Y | N | N | N | N | N | N |
| admin | N | N | N | N | N | N | N | Y |

## Product decisions locked
1. **Accept risk:** CxO **and** Risk Lead (`accept_risk=true`). Enforced in DB triggers and API (`canAcceptRisk` / `command.queue.accept`).
2. **Scoring policy & appetite:** CISO proposes (`proposed_by`); Board and CxO (`approve_policy`) may lock. Proposer ≠ approver. Approval freezes that version.
3. CISO has `approve_policy=false` and server enforces approver ≠ proposer, so they cannot self-approve.

## Tests per role (server + data, not only UI)
1. Money: roles without financials get NULL money from the API.
2. Technical: board_member, cxo, program_office, admin cannot open CVEs / raw payloads / connector runs.
3. Accept risk: only cxo and risk_lead succeed; everyone else gets a server error.
4. Policy/appetite: only `approve_policy` roles approve; approved versions are immutable; CISO cannot approve own proposal.
5. Board pack: reviewer ≠ approver; both need `review_board_pack`; pack locks after approval.
6. Admin: users only; no risk data or money.
7. Tenant isolation: org A cannot read org B (RLS).
8. Audit: role/user changes, policy changes, and acceptances write `audit_log`.
9. Run `db/dwan_tests.sql` against the preview DB; all must pass.
