# Thanarah Migration Test Evidence

**Updated:** 2026-11-03

## Verified in this continuation

- TypeScript check: `npm run type-check` passed after the candidate adapter changes.
- Nest application build: `npx nest build` passed.
- Regular repository suite: `npm test -- --reporter=dot` passed **952 tests** across 107 passing test files; 2 opt-in integration suites (24 tests total) were skipped because the default run does not supply the disposable replica-set configuration.
- Opt-in Mongo integration: `bash scripts/test-phase65-replica-set.sh` passed **18/18 platform tests** and **6/6 tenant-storage tests** against a disposable three-member MongoDB 7.0.17 replica set.
- Phase 65 covered authorization snapshots/references/stepdown, feature and plan candidates, entitlement/quota reads, failed-login updates, tenant lifecycle/pagination, session lifecycle and token rotation/reuse, generic document operations, and transaction-boundary commit/abort.
- The session test also covers concurrent presentation of the same refresh token: one rotation succeeds and the competing presentation is treated as reuse, with the session marked compromised.
- Phase 64 covered managed-client readiness, transaction commit/abort, real tenant Patient storage operations, transient insert/transaction retries, and controlled primary stepdown/reconnection.
- TypeScript check, Nest build, and full repository lint completed successfully. ESLint reported one pre-existing warning in `test/encounter-operation-reconciliation.spec.ts`; no lint errors. Prettier and `git diff --check` passed.
- The fixture script creates named test containers, uses loopback ports 45271–45273 without publishing ports, uses a unique synthetic database, and removes only containers it created.
- Security scans completed: dependency audit reported 2 critical, 2 high, and 11 moderate findings; SAST and HoundDog reported no findings. See `THANARAH_SECURITY_SCAN_REPORT.md`.
- The configured application workflow restarted successfully, remained RUNNING, and served HTTP 200 on the development domain. Logs confirm the database resolver remains safely blocked as `not-mysql`; Mongo candidates remain unregistered.
- No production database access, migration, data transfer, deployment, Git staging, or commit occurred.

## Not yet evidenced

- No disposable MySQL-vs-Mongo semantic differential tests ran.
- No end-to-end service tests ran with candidate adapters registered; they intentionally remain unregistered.
- Transaction parity for the remaining inventoried SQL workflows and encounter cross-store coordination is not proven. The two Mongo-only candidates do not establish MySQL parity, session concurrent-rotation behavior, or uncertain-commit recovery.
- No production readiness, cutover, rollback, or data-reconciliation evidence exists.

The integration run is not evidence of application activation or migration readiness.
