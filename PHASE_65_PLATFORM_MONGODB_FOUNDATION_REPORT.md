# Phase 65 — Central Platform MongoDB Foundation

**Date:** 2026-10-31  
**Result:** An isolated platform MongoDB persistence foundation is implemented. This is not migrated application functionality and does not establish MySQL retirement readiness.

## Summary

Added a separate, opt-in central platform MongoDB connection with its own configuration, client lifecycle, neutral readiness check, shutdown handling, typed document/repository contracts, validation, duplicate conflict mapping, and explicit index provision/verification.

The platform connection cannot be chosen by tenant context and does not reuse the tenant Mongo connection or tenant registry. It is lazy and disabled unless both `PLATFORM_MONGO_URI` and `PLATFORM_MONGO_DATABASE` are deliberately configured. It does not connect on boot, modify SQL data, create indexes at startup, or change authentication/authorization behavior when disabled.

## Implemented scope

- Platform identity: the existing `User` fields and state needed for credentials, lockout, and token version.
- Tenant/organization metadata: existing `Tenant` data. The Prisma schema has no separate `Organization` model.
- Tenant memberships: existing fields with tenant-scoped repository read/update operations.
- Platform role and permission catalogs plus their two assignment collections.
- Session metadata and refresh-token history metadata. Only token hashes are stored; no TTL index or token-retention deletion is introduced.
- Explicit unique and query indexes, including email collation and membership uniqueness, with a post-provision exact-definition verification function.
- Strict persistence-boundary document validation and generic sanitized handling for database errors.
- Optional application readiness check and graceful Nest lifecycle shutdown for the platform manager.

Detailed fields, index contract, limitations, and safety boundary are in `PHASE_65_PLATFORM_DATA_MODEL_IMPLEMENTATION.md`.

## Compatibility and safety

- Existing Prisma/MySQL repositories and routes remain unchanged and continue to serve all application requests.
- No login, authorization, tenant activation, subscription, audit, or session workflow reads/writes the new collections.
- No dual write, migration, backfill, or production database access occurred.
- Platform storage is separate from tenant healthcare databases. The implementation adds no automatic sharding, tenant fan-out, rebalancing, or cross-database transaction assumption.
- The platform Mongo settings are optional. When the URI is explicitly configured in production, TLS certificate/hostname validation is required. No production configuration was changed or inspected.
- Integration-test safety guard permits only the fixed local three-member `rs0` fixture and `phase65_platform_` test databases; cleanup drops only that synthetic test database.

## Verification

Fill in the verified commands/results for the completed Phase 65 test run below. A skipped integration test is not a pass.

| Check | Result |
|---|---|
| Phase 65 replica-set integration | Pending |
| Focused existing Mongo manager/readiness/storage suites | Pending |
| Relevant full unit suite | Pending |
| TypeScript check | Pending |
| ESLint | Pending |
| Prettier | Pending |
| Nest build | Pending |
| `git diff --check` | Pending |

## Remaining limitations and NO-GO decisions

1. This foundation does not preserve cross-document invariants by itself. No safe transaction/session propagation API was approved or implemented. Refresh rotation/reuse, role permission replacement, owner uniqueness, and tenant status/authorization races are not implemented here.
2. The basic role-assignment and session-history repositories do not enforce MongoDB foreign keys. There is no relational FK enforcement; a future workflow must define transaction-scoped reference validation or an equivalent reviewed protocol before use.
3. MySQL `utf8mb4_unicode_ci` and MongoDB `en` strength-1 email collation are not proven equivalent for all Unicode strings. Do not switch identity lookup until source/target parity is measured and accepted.
4. No TTL deletion is enabled; retention and audit obligations remain owner decisions.
5. The provider, production topology, database roles, secret names/ownership, residency/compliance, backup and restore, RPO/RTO, monitoring, transaction/write-concern policy, and operating owner remain unresolved.
6. Appointment/Encounter compatibility, all 13 SQL transaction-bearing repositories, production suitability, and data-transfer acceptance gates remain unverified.

**Decision:** The platform MongoDB layer is a tested technical foundation only. It is not a replacement for any production feature, not a data migration, and not authorization to activate MongoDB for platform traffic. Migration readiness remains **NO-GO**.
