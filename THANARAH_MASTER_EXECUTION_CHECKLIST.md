# Thanarah Master MongoDB Migration Execution Checklist

**Date:** 2026-11-03  
**Overall codebase migration status:** BLOCKED  
**Production cutover readiness:** BLOCKED — no production access or cutover is authorized or performed.

This is a live status register for the user-provided master execution brief. Statuses are evidence-based. A persistence port is not a MongoDB adapter or migration proof.

## Workstreams

| # | Workstream | Status | Evidence / remaining scope |
|---|---|---|---|
| 1 | Complete persistence port layer | COMPLETE for the audited 22-repository central set | All 22 central repositories now expose application-owned ports with Prisma bindings. Storage activation, application readiness, and encounter coordination remain direct Prisma responsibilities outside that audited repository set. |
| 2 | Transaction compatibility | BLOCKED | Source audit identifies 13 transaction-bearing files plus encounter cross-store coordination. Mongo commit/abort, concurrency, interruption, uncertain acknowledgement, retry, and reconciliation are not verified per workflow. |
| 3 | Complete MongoDB adapters | BLOCKED | The 22-port layer has one isolated, unregistered read-only authorization adapter; the remaining adapters, cross-adapter matrix, and transaction parity are incomplete. No Mongo adapter is registered for application traffic. |
| 4 | MySQL semantic parity | NOT STARTED | Required per-domain differential checks for collation, nullability, date precision, decimals, sorting, enums, counters, and lifecycle semantics remain outstanding. |
| 5 | Complete application migration | NOT STARTED | Prisma/MySQL remains the only active central persistence adapter. No services have switched to MongoDB. |
| 6 | Data migration tooling | NOT STARTED | No approved, repeatable model-by-model transfer utility and synthetic SQL-to-Mongo rehearsal have been completed. |
| 7 | Remove MySQL runtime dependencies | NOT STARTED | Removal is gated on complete Mongo adapter activation and passing application tests; Prisma remains required. |
| 8 | Testing and quality gates | BLOCKED | Full suite: 952 passed, 14 skipped across 107 passed and 2 skipped files. TypeScript/build/format passed; lint has 0 errors and 1 pre-existing warning. Required opt-in Mongo integration matrices remain unrun. |
| 9 | Operational readiness | NOT STARTED | Production owner decisions, target topology, monitoring, backup/restore, retention, RPO/RTO, and operating procedures remain unresolved or unverified. |
| 10 | Final completion audit | NOT STARTED | The final repository, runtime dependency, transaction, test, and migration audit cannot pass while required workstreams remain incomplete. |

## Current verified increment

- 22/22 audited central Prisma repositories implement typed ports and use Prisma bindings. Prisma remains the sole active adapter.
- Migrated port consumers include catalog, audit, identity/authentication, tenants/memberships, roles/assignments, facilities/branches, entitlements/quotas, subscriptions, staff/role/scope, doctors, service catalogs, and scheduling policies.
- The latest full suite passed 952 tests with 14 opt-in tests skipped. TypeScript, Nest build, and formatting passed; lint has 0 errors and 1 pre-existing warning.
- Role, membership-role, branch, and other pre-existing transaction ownership remains in the Prisma repositories.
- No Mongo activation, migration, production access/configuration change, staging, deployment, commit, or data deletion occurred.

## Active blockers

1. No Mongo adapter matrix or per-port cross-adapter contract suite exists; all 22 ports currently resolve to Prisma, despite one unregistered authorization candidate.
2. The Mongo foundation does not provide verified transaction/session semantics for tenant owner bootstrap, role assignment, branch creation, memberships, subscriptions, staff scope, scheduling, storage activation, and other transaction-bearing workflows.
3. MySQL semantic parity, data transfer rehearsal, and migration operational readiness remain unverified.
4. The latest known development database URL is rejected as non-MySQL; live MySQL connectivity, transaction rollback, and real concurrent lifecycle behavior are not verified.
5. Production provider/topology, residency/compliance, ownership, backup/recovery objectives, and cutover approvals are outstanding.
6. Production databases and credentials remain out of scope. Never infer production readiness from local or synthetic test evidence.

## Safety boundary

Keep Prisma/MySQL active until adapter parity and workflow-specific evidence pass. Do not access production databases, change production configuration, run production transfer, deploy, commit, dual-write, or retire SQL under this execution.
