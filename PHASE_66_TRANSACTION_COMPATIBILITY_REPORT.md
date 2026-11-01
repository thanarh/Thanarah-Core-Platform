# Phase 66 — Transaction Compatibility Report

**Date:** 2026-11-01
**Status:** Source audit only for this phase. Disposable transaction/failover/uncertain-ack tests were not run in Phase 66. No compatibility is claimed.

## Reconciled scope

Current source search finds transaction-bearing operations in 13 files, matching the earlier Phase 64 inventory. Multiple transactions occur in several files. This is a file/call-site inventory, not 13 independently implemented Mongo repositories. Every listed workflow remains on Prisma/MySQL. Phase 65's central Mongo document repositories are not wired to these workflows.

| Source / operation | Affected records | Existing SQL atomicity and invariant | MongoDB requirement / current status |
|---|---|---|---|
| `src/auth/repositories/platform-user.repository.ts` — `recordFailedLogin` | User | Failed-login threshold and lockout state are updated transactionally | A single-document atomic increment/conditional update may preserve this only after threshold/reset race tests; no adapter or test |
| `src/auth/repositories/platform-session.repository.ts` — rotation/reuse | PlatformSession, PlatformRefreshTokenHistory | Row lock and multi-record transaction for rotation, history and reuse/compromise response | Requires transaction/session propagation or reviewed bounded aggregate protocol; no Mongo adapter |
| `src/tenant/tenant-membership.repository.ts` — `changeStatusIfCurrent` | Tenant, TenantMembership | Tenant lock guards tenant and expected membership-state race | Multi-document transaction or proven versioned tenant gate; no adapter |
| `src/tenant/tenant-role.repository.ts` — permission replacement/bootstrap | Tenant, membership, tenant role/grants | Transaction and tenant lock protect permission replacement and initial-owner uniqueness | Transaction or fully specified serialization protocol; no adapter |
| `src/tenant/tenant-membership-role.repository.ts` — assign/remove | Tenant, TenantMembership, TenantRole, assignment models | Parent/member/role validation and owner protection within transaction | Transaction or serialized command with race proof; no adapter |
| `src/tenant/tenant-staff.repository.ts` — create for active membership | Tenant, TenantMembership, User, Staff | Locks/checks parent state before creating staff record | Transaction or parent-version protocol; no adapter |
| `src/tenant/branch.repository.ts` — create under active facility | Tenant, Facility, Branch | Locks active tenant/facility before creation | Transaction or versioned gate and concurrent status test; no adapter |
| `src/tenant/doctor.repository.ts` — doctor/catalog assignments | Tenant, Staff, Doctor, Department/Specialty assignments | Multiple transactions protect active-parent checks and multi-record changes | Transaction plus reference validation; retain independent Department/Specialty assignments; no adapter |
| `src/tenant/tenant-staff-role.repository.ts` — assign/remove | Tenant, Staff, role/assignment records | Locks and rechecks active actor/tenant/staff/role | Transaction or proven serialized authorization command; no adapter |
| `src/tenant/tenant-staff-scope.repository.ts` — facility/branch scope changes | Tenant, Staff, Facility, Branch, membership and scope assignments | Four transaction blocks use parent locks and assignment checks | Transaction or explicit parent-state protocol; no adapter |
| `src/tenant/appointment-scheduling-policy.repository.ts` — upsert/status | Policy and policy revision | Expected-version change and matching revision are atomic | Transaction over current policy and revision or reviewed append-only command/recovery design; no adapter |
| `src/subscriptions/subscription.repository.ts` — create/transition | Tenant, Plan, Subscription | Tenant/plan locks and conditional transition prevent invalid lifecycle/overlap | Transaction plus tenant serialization; arbitrary interval overlap is not a simple unique-index constraint; no adapter |
| `src/tenant/tenant-storage.activation.service.ts` — activation/primary switch | Tenant, TenantStorageTarget; target index preflight | Index preflight, tenant lock, target recheck and atomic registry switch | Keep DDL preflight outside transaction; transaction over metadata and placement generation; no adapter |

The exact SQL predicates, lock ordering, isolation levels, and affected model fields should be transcribed from each implementation and captured in an adapter-specific acceptance test before replacement. This report does not infer those details from method names.

## Cross-store encounter consistency (additional)

Encounter mutation is not one of the 13 transaction-bearing files, but it coordinates tenant Mongo encounter documents with central SQL `EncounterOperation` and platform audit. Its existing PREPARED/CONFIRMED/NOT_APPLIED/AMBIGUOUS and reconciliation behavior cannot be reproduced by a transaction across separate clusters. Preserve durable prepare-before-write, idempotency, audit retry limits, operation-status recovery and operator review through an explicitly reviewed outbox/saga design.

## Test and failure status

Phase 65 verified generic platform Mongo repository CRUD, indexes, duplicate/concurrent conflicts, tenant-scoped membership operations and recovery after an injected connection close. It did not test any of the 13 workflows above. Prior Phase 63/64 labs show that Mongo transactions and client reconnection can work in specific disposable topologies; they do not prove these application workflows, interrupted transactions, or acknowledgement-lost-after-commit recovery.

Phase 66 did not provision or connect to MongoDB. Commit/abort per workflow, concurrent update races, real primary interruption, uncertain acknowledgement, retry deduplication and reconciliation are **NOT RUN / NOT PROVEN** here. No production topology was probed.

## Required evidence before a replacement

1. Approved disposable replica set matching target version/topology and a documented, safe failure-injection harness.
2. A typed transaction/session boundary in the repository ports, with no hidden global session or implicit retries.
3. Workflow-specific commit/abort tests and concurrent race tests for all rows above.
4. Primary interruption during an active transaction, retryable transient failure and lost acknowledgement after server commit; verify status recovery without duplicate effects.
5. Reference-integrity, duplicate-key mapping, outbox/reconciliation and retry-budget assertions.
6. Owner approval for transaction/write concern, retry classifications, monitoring and recovery procedure.

**Decision:** All 13 transactional workflows and encounter cross-store behavior remain HIGH RISK and NOT VERIFIED for MongoDB migration. Migration readiness remains **NO-GO**.
