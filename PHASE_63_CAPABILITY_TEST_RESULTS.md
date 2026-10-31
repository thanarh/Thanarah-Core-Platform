# Phase 63 — Capability Test Results

**Date:** 2026-10-31
**Environment:** Disposable MongoDB 7.0.17 three-member replica set; loopback-only Docker host networking
**Overall result:** Required local infrastructure and synthetic invariant simulations passed; production readiness and full application parity remain unverified.

## Result counts

- **26 PASS:** 8 database capability checks, 5 failover checks, 6 backup/restore checks, and 7 Thanarah-specific synthetic simulations.
- **3 NOT RUN:** retry after an induced primary interruption, uncertain acknowledgement handling, and in-flight transaction interruption/retry.
- The Docker bridge connectivity candidate **FAILED**; the loopback-only host-network candidate passed after sequential member startup.

## Database capability tests

| Test | Result | Evidence |
|---|---|---|
| Replica-set health | **PASS** | Exactly one primary and two healthy secondaries; all members reported health 1. |
| Multi-document transaction commit | **PASS** | Two documents committed; both independently read back. |
| Multi-document transaction rollback | **PASS** | Two transaction inserts were aborted; neither document persisted. |
| Unique index enforcement | **PASS** | A unique index rejected a concurrent conflicting insert with duplicate-key error 11000. |
| Concurrent conflicting inserts | **PASS** | Corrected asynchronous harness produced one success, one duplicate-key rejection, and one persisted document. |
| Atomic conditional updates | **PASS** | 100 concurrent guarded increments ended at exactly 100. |
| Majority acknowledgement | **PASS** | A synthetic insert returned successfully with `w: "majority"` and was subsequently present on all three members. |
| Retryable write, normal acknowledgement | **PASS** | A retryable write using the test client's `retryWrites=true` setting persisted once. This did not force a transient error or prove retry after an uncertain acknowledgement. |
| Retry after primary interruption | **NOT RUN** | No injected write interruption was used to force the client driver to retry an in-flight operation. |
| Uncertain acknowledgement handling | **NOT RUN** | No reproducible ambiguous-acknowledgement case was induced. |

## Failover tests

| Test | Result | Evidence |
|---|---|---|
| Controlled primary stepdown | **PASS** | `replSetStepDown` returned `ok: 1` from the prior primary. |
| Replacement primary election | **PASS** | Replica-set-aware test client discovered the new primary; the previous primary became secondary. |
| Secondary health after election | **PASS** | All three members reported health 1 after election. |
| Client reconnection | **PASS** | A new replica-set-aware `mongosh` client connected through the seed list after stepdown. |
| No duplicate committed test operations | **PASS, tested subset** | Majority-write and unique-race records remained at one document after failover and were present across all members. This is not an end-to-end application idempotency guarantee. |
| Transaction interruption and safe retry | **NOT RUN** | No in-flight transaction was interrupted by the stepdown. |

## Backup and restore

| Test | Result | Evidence |
|---|---|---|
| Logical backup | **PASS** | `mongodump` 100.11.0 created a gzip-compressed archive outside all MongoDB data volumes; 799 bytes; elapsed time approximately 1 second. |
| Separate restore target | **PASS** | `mongorestore` restored to a separate standalone MongoDB 7.0.17 process with a separate volume and loopback port; restore elapsed time approximately 1 second. |
| Restored collections/documents | **PASS** | Six collections restored, one synthetic document per collection; tool reported 6 documents restored and 0 failures. |
| Index restoration | **PASS** | The unique `key_1` index and ordered key `{key: 1}` were present on the restored collection. |
| Representative data integrity | **PASS** | Collection counts and representative committed, majority-write, retryable-write, counter, and unique-race values matched expectations. |
| Restore independence | **PASS** | A restore-only marker inserted into the target was absent from the source; the source commit record remained present. |

## Thanarah-specific synthetic capability simulations

These tests exercise MongoDB primitives and proposed invariant patterns using synthetic documents. They are not tests of production Thanarah repositories or proof that application workflows have been migrated.

| Simulation | Result | Evidence |
|---|---|---|
| Concurrent authentication lockout | **PASS** | Twenty concurrent failures stopped at threshold five and set the synthetic user to locked. |
| Refresh rotation and reuse detection | **PASS** | One compare-and-set rotation won; the stale version was detectable and marked compromised in the synthetic family document. |
| Membership and permission scope | **PASS** | Tenant/user/role unique index rejected a concurrent duplicate membership. |
| Tenant activation / primary storage selection | **PASS** | A transaction switched the synthetic primary target and left exactly one active primary. |
| Subscription overlap control | **PASS** | Tenant guard, transaction, and retry simulation admitted one period and rejected the overlapping request. |
| Appointment concurrency | **PASS** | A unique tenant/resource/slot key allowed one concurrent reservation and rejected the duplicate. |
| Clinical operation ledger and audit reconciliation | **PASS** | A transaction wrote operation and audit-outbox records once; replay was rejected without duplicate records. |

## Limitations and decision

- Bridge networking still fails even though DNS resolves; only the loopback-only host-network option was usable in this lab.
- The MongoDB shell client was used for driver-level checks. The Thanarah application runtime, its Node driver behavior under failover, and production connection configuration were not tested.
- Write retries during actual failover, ambiguous acknowledgements, interrupted transactions, TLS, production backup controls, and production recovery objectives remain unverified.
- Do not claim application parity or production migration readiness from these infrastructure and synthetic-harness results. Migration readiness remains **NO-GO**.
