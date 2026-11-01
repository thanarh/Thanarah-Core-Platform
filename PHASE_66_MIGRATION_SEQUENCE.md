# Phase 66 — Dependency-Aware Migration Sequence

**Date:** 2026-11-01
**Decision:** Planning sequence only. No dual-write, shadow-write, migration, or cutover is authorized.

## Mandatory prerequisites (before repository migration)

1. Obtain named product, data, engineering, security/compliance and operations owners; approve provider/version/topology, residency, compliance terms, access roles, backups, retention, write concern, transaction/retry policy, RPO/RTO, maintenance window and rollback authority.
2. Complete a read-only production inventory through an owner-approved process outside this Replit session. Replit must not connect to production for this phase.
3. Define a typed persistence port for every central repository and bind Prisma as the sole active implementation. Remove direct persistence access from controllers; keep tenant clinical operations behind trusted tenant-scoped contracts.
4. Approve a Mongo document/reference/index contract for every model and map every SQL key, FK action, null/default, enum, decimal, date/time, sort and pagination behavior.
5. Complete the transaction and failure evidence in `PHASE_66_TRANSACTION_COMPATIBILITY_REPORT.md` on approved disposable topology, including uncertain acknowledgement recovery.
6. Approve encounter outbox/saga/reconciliation, email equality behavior, retention and operational recovery design.
7. Implement reusable contract suites before any repository is switched. All data remains synthetic until owners separately authorize a non-production rehearsal.

## Proposed order after prerequisites

| Order | Candidate group | Risk | Dependencies and reason | Exit gate before next group |
|---|---|---|---|---|
| 1 | Independent platform catalog reads/writes: Feature and Plan/PlanFeature | LOW–MEDIUM | Smallest dependency surface, but PlanFeature references two catalogs and conditional state transitions remain relevant. | Index/unique, reference, status-CAS, pagination and error mapping contracts pass. |
| 2 | Tenant-scoped read catalogs: Department, Specialty, Service, Facility and Branch | MEDIUM; Branch HIGH transaction path | Needed by staff/doctor operations; tenant-key uniqueness and active-parent validation must precede assignments. | Tenant isolation, branch parent-state race, uniqueness and scoped-reference tests pass. |
| 3 | Tenant identity/control-plane base: Tenant and Membership | HIGH | Parent of roles, staff, subscription and storage routing; migration only after reference/integrity and status-gate design. | Membership status race, tenant isolation, owner/membership conflicts and repair checks pass. |
| 4 | Tenant role/authorization and staff/scope graph | HIGH | Depends on tenant/membership/catalog base; directly affects authorization and clinical access scopes. | Permission replacement, owner protection, assignment/scope races and fail-closed auth contract pass. |
| 5 | Doctor and scheduling policy/revision state | HIGH | Depends on tenant, staff and healthcare catalogs; policy version and revision must remain atomic. | Cross-reference checks, independent Department/Specialty links, version-CAS and recovery tests pass. |
| 6 | Plans, subscriptions, entitlements and quotas | HIGH | Subscription interval overlap, feature lifecycle and quota decisions affect access and commercial behavior. | Concurrent overlap/transition/quota tests and audit side effects pass. |
| 7 | Tenant storage registry and primary activation | HIGH | Controls physical tenant data routing; wrong switch can expose or orphan healthcare data. | Index preflight, unavailable-target behavior, generation/primary CAS, restore and activation-race tests pass. |
| 8 | Platform users, roles, sessions and refresh history | HIGH / highest security | Must wait for approved email semantics, lockout atomicity, auth parity, session rotation/reuse and uncertain-ack recovery. | Differential email tests, lockout races, full session transaction/failure suite and security review pass. |
| 9 | Platform audit/security events and encounter operation ledger | HIGH | Append-only/audit retention and encounter recovery have cross-model/cross-store semantics. | Outbox/saga, audit retry/reconciliation, ambiguous operation recovery and retention tests pass. |
| 10 | Central legacy Patient disposition and SQL retirement | HIGH / gated | Prisma Patient may be legacy while current patient data is tenant Mongo; cannot be a blind table copy. | Owner-approved source-of-truth reconciliation, all runtime dependencies removed, counts/checksums and recoverable rollback accepted. |

## Rollback and cutover rules

- Before MongoDB accepts production writes, a route reversal is only safe after verifying the unchanged, write-frozen SQL source and current backup.
- After MongoDB accepts production writes, a configuration rollback to stale SQL is unsafe. Require a tested reverse replay/transfer or approved restore and recovery-point decision; maintain one authoritative writer.
- Do not introduce dual-write or shadow-write to reduce a migration window. Any CDC/outbox change needs separate architecture review and idempotency evidence.
- Preserve tenant placement and trusted context. Do not move clinical data or change tenant target routing as an incidental central repository migration.
- SQL retirement requires every model, enum, migration-created record, script, health/readiness path, report and operator tool to be inventoried and dispositioned; then named owner sign-off and an approved observation period.

## Phase 67 decision

Phase 67 may safely begin only as **planning and isolated contract-test/tooling work**, after owners approve the test topology and interface scope. It must not begin live repository replacement, migration execution, shadow traffic or cutover yet. This Phase 66 audit found the central port layer incomplete, Mongo compatibility unproven for all 13 transactional files, and owner/topology/semantic decisions unresolved. Overall migration readiness remains **NO-GO**.
