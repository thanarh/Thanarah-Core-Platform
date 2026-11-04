# Thanarah Migration Test Evidence

**Updated:** 2026-11-04

## Verified in this continuation

- Latest full default suite: **952 passed, 31 skipped, 0 failed**. The 31 skips are the two opt-in replica-set suites, explicitly run separately; type-check, Nest build, format, diff, and lint (0 errors; 1 pre-existing warning) passed.
- Targeted facility repository/service tests: **19/19 passed**.
- Opt-in Mongo integration: `bash scripts/test-phase65-replica-set.sh` passed **25/25 Phase 65 platform tests** and **6/6 Phase 64 tenant-storage/application tests** against a disposable three-member MongoDB 7.0.17 replica set.
- Phase 65 now includes facility reference rejection, tenant isolation, stable ordering, rename, and lifecycle compare-and-set behavior.
- Phase 65 now also covers audit and security event reference checks, duplicate-id conflict/recovery lookup, and single successful security-event resolution.
- Phase 65 also covers department/specialty uniqueness, tenant-active checks, scoped reads, updates, and lifecycle compare-and-set operations.
- Phase 65 also covers service catalog nullable-code behavior, name/code conflicts, counts, tenant-scoped reads, updates, and lifecycle compare-and-set operations.
- Phase 65 also covers subscription period overlap rejection, concurrent serialization, current lookup, and lifecycle transitions.
- Phase 65 also covers tenant-role metadata, permission replacement, system-role protection, and initial owner bootstrap.
- Phase 65 also covers branch parent validation, tenant scoping, list/update behavior, and lifecycle compare-and-set.
- Phase 65 covered authorization snapshots/references/stepdown, feature and plan candidates, entitlement/quota reads, failed-login updates, tenant lifecycle/pagination, session lifecycle and token rotation/reuse, generic document operations, and transaction-boundary commit/abort.
- The session test also covers concurrent presentation of the same refresh token: one rotation succeeds and the competing presentation is treated as reuse, with the session marked compromised.
- Phase 64 covered managed-client readiness, transaction commit/abort, real tenant Patient storage operations, transient insert/transaction retries, and controlled primary stepdown/reconnection.
- TypeScript check, Nest build, and full repository lint completed successfully. ESLint reported one pre-existing warning in `test/encounter-operation-reconciliation.spec.ts`; no lint errors. Prettier and `git diff --check` passed.
- The fixture script creates named test containers, uses loopback ports 45271–45273 without publishing ports, uses a unique synthetic database, and removes only containers it created.
- Fresh security scans: dependency audit reported 2 critical, 2 high, and 11 moderate findings; SAST and HoundDog reported no findings. The 15 advisory/package instances are enumerated in `THANARAH_SECURITY_FINDINGS_AND_REMEDIATION.md`.
- The configured application workflow restarted successfully, remained RUNNING, and served HTTP 200 on the development domain. Logs confirm the database resolver remains safely blocked as `not-mysql`; Mongo candidates remain unregistered.
- A separate TLS MongoDB `ping` to the user-confirmed development-only cluster succeeded using the development secret and a dedicated probe database name. No documents were read or written. The hosted cluster was not used for Phase 65 because that suite deletes its test database and accepts only its credential-free loopback replica set.
- No production database access, migration, data transfer, deployment, Git staging, or commit occurred.

## Not yet evidenced

- The 31 default-run skips are exactly `test/phase65-platform-mongodb.integration.spec.ts` (25 tests) and `test/phase64-mongodb-application.integration.spec.ts` (6 tests), both guarded by opt-in replica-set environment variables. Both suites were explicitly run and passed, for 31/31 integration tests.
- No disposable MySQL-vs-Mongo semantic differential tests ran.
- No end-to-end service tests ran with candidate adapters registered; they intentionally remain unregistered.
- Transaction parity for the remaining inventoried SQL workflows and encounter cross-store coordination is not proven. Candidate-only tests do not establish MySQL parity or uncertain-commit recovery.
- No production readiness, cutover, rollback, or data-reconciliation evidence exists.

The integration run is not evidence of application activation or migration readiness.
