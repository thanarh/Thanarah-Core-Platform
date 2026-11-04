# Thanarah MySQL-to-MongoDB Migration Report

**Updated:** 2026-11-04
**Decision:** **NO-GO — migration is incomplete and no adapter may be activated.**

## Current state

- Prisma/MySQL remains the only registered and active application persistence path.
- Sixteen candidate Mongo adapters cover sixteen of 22 central persistence ports, now including tenant membership. All remain candidates, not active repositories.
- The latest disposable three-member replica-set suite passed Phase 65 (26 tests) and Phase 64 (6 tests), including tenant-membership operations and owner protection. There is no MySQL differential evidence and no candidate is registered.
- Six persistence ports do not have a full Mongo port adapter: tenant membership-role, tenant staff, tenant staff-role, tenant staff-scope, facility scheduling policy, and doctor.
- Transaction parity remains unverified for all inventoried workflows. Failed-login and session-rotation candidates have Mongo-only tests, not proven MySQL equivalence; session failover/uncertain-commit recovery and encounter cross-store coordination remain unresolved.
- MySQL development connectivity is blocked: sanitized diagnostics report `MYSQL_DATABASE_URL` parses but uses a non-MySQL scheme.
- A separate TLS ping to the user-confirmed development-only Mongo cluster succeeded using the development secret and a dedicated probe database name. This confirms connectivity only; no data was read or written, and no candidate adapter was activated.
- MySQL string collation, nullable/JSON semantics, pagination, duplicate behavior, transaction isolation, uncertain acknowledgements, recovery, and service-level error mapping are not fully compared.
- Fresh scans report 2 critical, 2 high, and 11 moderate dependency findings. All 15 advisory/package instances are enumerated in the security findings report. Only one finding (`js-yaml` 5.3.0) has a reported non-major fix (5.4.1); no dependency changes were applied pending isolated compatibility checks.
- Latest full default test result: 952 passed, 32 skipped, 0 failed. The 32 skips are the Phase 65/64 opt-in suites, which passed separately (26 + 6). Type-check, Nest build, formatting, and lint (0 errors; 1 pre-existing warning) passed.

## Safety record

Mongo integration tests used only synthetic local fixtures and a disposable loopback replica set. A separate, non-destructive ping was sent to the user-confirmed development-only Mongo cluster; no documents were read or written. No production database was accessed. No data migration, production configuration change, deployment, adapter activation, commit, or staging occurred. No unrelated processes or containers were stopped.

## Required before reconsidering migration

1. Restore safe development-only MySQL connectivity without exposing or guessing credentials.
2. Complete the 22-port implementation and readiness matrices, including the 7 missing adapters and contract tests for every operation.
3. Run MySQL/Mongo differential tests for collation, null/missing values, unique constraints, pagination, and error behavior.
4. Implement and prove all 13 transaction workflows, including concurrency, failover, retry, and uncertain-ack recovery; design and test encounter cross-store reconciliation.
5. Run the full repository suite, build, integration suite, and security audit; publish exact evidence and unresolved risks.
6. Obtain explicit approval for any future production access, data transfer, activation, deployment, or cutover.
