# Thanarah Migration Blockers

**Updated:** 2026-11-03

## Immediate blockers

1. **Development MySQL is unavailable through the configured safe resolver.** Sanitized diagnostics show `MYSQL_DATABASE_URL` is present and parses, but its scheme is `other`; it is classified as `not-mysql`. The actual value was not read or printed, and no replacement was guessed. Live MySQL semantic comparisons cannot run until a valid development-only MySQL URL is configured through the approved secrets flow.
2. **Only 15 of 22 persistence ports have Mongo candidate adapters.** The other 7 remain on Prisma/MySQL or have only generic document CRUD.
3. **Transaction parity is unproven.** Failed-login and session-rotation candidates have Mongo-only workflow tests, but no MySQL parity evidence. Session concurrency, failover and uncertain-commit recovery remain untested, as do other transaction-bearing operations and encounter cross-store behavior.
4. **String-collation equivalence is unproven.** Mongo `en` strength-1 indexes are not demonstrated equivalent to the source MySQL `utf8mb4_unicode_ci` collation. Feature, plan, and email behavior must be compared with a reviewed corpus on disposable MySQL and Mongo fixtures.
5. **Service-level error and null semantics are not proven.** Mongo conflict, validation, missing-record, JSON-null, and availability results need to match each existing service's Prisma error behavior before activation.
6. **No adapter is approved or registered.** Prisma/MySQL is still the only active application adapter. No production access, data transfer, or deployment is authorized by this work.
7. **Dependency audit has unresolved critical/high findings.** The two critical and two high findings require major-version dependency updates. No dependency changes were made; review `THANARAH_SECURITY_SCAN_REPORT.md`.
8. **Facility candidate readiness is partial.** Its methods and selected behaviors passed disposable replica-set testing, but reference-race/transaction, facility-specific failover, service error parity, and MySQL differential evidence are missing.
9. **Audit/security candidate readiness is partial.** Replica-set tests cover reference validation, idempotent lookup, security-event creation, and one-time resolution; service-level event delivery, source FK/error semantics, failover, uncertain commit, and MySQL parity remain open.
10. **Healthcare catalog candidate readiness is partial.** Department/specialty behavior passed Mongo tests, but case/accent collation equivalence, tenant-state races, service error mapping, and MySQL parity remain unverified.
11. **Service catalog candidate readiness is partial.** Mongo tests cover nullable code indexes, name/code conflicts, counts, and lifecycle behavior; MySQL null/collation semantics, tenant-state races, and service error mapping remain unverified.
12. **Subscription candidate readiness is partial.** Mongo tests cover serialized overlapping periods and lifecycle rules, but coordination with tenant/plan status writes, SQL isolation behavior, uncertain commits, and MySQL parity remain unverified.
13. **Tenant role candidate readiness is partial.** Mongo tests cover role permissions and owner bootstrap, but collation equivalence, coordination with membership-role and tenant updates, and transactional error parity remain open.
14. **Branch candidate readiness is partial.** Replica-set tests pass, but facility/tenant status can change through other ports without sharing the candidate transaction; MySQL and cross-port race parity remain open.

## Safe development database status

The diagnostic result is sanitized and limited to presence, parse success, scheme, and whether the database name appears development-only. Secret values and credentials were not accessed. The environment must be corrected through the managed secrets/configuration flow; do not infer or substitute a URL.
