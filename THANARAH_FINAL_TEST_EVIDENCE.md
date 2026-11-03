# Thanarah Migration Test Evidence

**Updated:** 2026-11-03

## Verified in this continuation

- TypeScript check: `npm run type-check` passed after the candidate adapter changes.
- Nest application build: `npx nest build` passed.
- Regular repository suite: `npx vitest run` passed **952 tests**, with **21 skipped** across 107 passing test files and 2 skipped test files.
- Replica-set integration: `bash scripts/test-phase65-replica-set.sh` passed **15/15 tests** against a disposable three-member MongoDB 7.0.17 replica set.
- The suite covered authorization reads and transaction snapshots, references and sanitized failures, stepdown recovery, feature and plan candidates, entitlement/quota reads, atomic failed-login updates, generic document repositories, and transaction-boundary commit/abort.
- The fixture script creates named test containers, uses loopback ports 45271–45273 without publishing ports, uses a unique synthetic database, and removes only containers it created.
- Security scans completed: dependency audit reported 2 critical, 2 high, and 11 moderate findings; SAST and HoundDog reported no findings. See `THANARAH_SECURITY_SCAN_REPORT.md`.
- The configured application workflow restarted successfully, remained RUNNING, and served HTTP 200 on the development domain. Logs confirm the database resolver remains safely blocked as `not-mysql`; Mongo candidates remain unregistered.
- No production database access, migration, data transfer, deployment, Git staging, or commit occurred.

## Not yet evidenced

- No disposable MySQL-vs-Mongo semantic differential tests ran.
- No end-to-end service tests ran with candidate adapters registered; they intentionally remain unregistered.
- Transaction parity for the 12 other inventoried SQL workflows and encounter cross-store coordination is not proven.
- No production readiness, cutover, rollback, or data-reconciliation evidence exists.

The integration run is not evidence of application activation or migration readiness.
