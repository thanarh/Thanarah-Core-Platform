# Thanarah MySQL–MongoDB Semantics Report

**Updated:** 2026-11-03  
**Decision:** NO-GO — no cross-engine semantic parity has been established.

## Test availability

The configured development `MYSQL_DATABASE_URL` was inspected only through sanitized diagnostics: it parses but has scheme `other`, and the resolver classifies it as `not-mysql`. The secret value was not read, printed, guessed, or changed. No differential MySQL/MongoDB tests ran.

The opt-in Mongo suites passed against a disposable three-member MongoDB 7.0.17 replica set (Phase 64: 6/6; Phase 65: 18/18). These establish candidate behavior on MongoDB only.

## Compatibility matrix

| Semantic area | Source contract / Mongo candidate | Evidence status |
|---|---|---|
| Unicode email, case, accents | MySQL `utf8mb4_unicode_ci` versus Mongo `en` strength-1 collation for platform user lookups | NOT RUN comparatively; equivalence is unproven |
| Slug/key comparisons | Tenant slug, Feature key, Plan key uniqueness and lookup | Mongo uniqueness/lookup candidates tested; MySQL collation and duplicate behavior NOT RUN |
| Nullable unique fields | Prisma nullable fields and unique indexes versus Mongo null/missing/partial-index behavior | NOT RUN comprehensively |
| UUID/ObjectId | Prisma identifiers are UUID strings in `CHAR(36)`; Mongo candidates use UUID strings | Candidate schemas/tests use UUID strings; no migration round-trip corpus |
| Date/time precision | Prisma `DateTime`; facility scheduling uses policy timezone | Mongo BSON dates preserve milliseconds; differential precision, DST, and timezone tests NOT RUN |
| Decimal/money | Per-model Prisma decimal and conversion behavior | Model-by-model inventory and Mongo Decimal128/serialization comparison NOT RUN |
| Null versus missing | SQL nullable values and JSON SQL-NULL/JSON-null distinctions | NOT RUN across all document fields and stored legacy shapes |
| Sorting/pagination | Source repositories define ordered lists and page boundaries | Tenant candidate tests stable ordering/pagination; cross-engine equality and remaining ports NOT RUN |
| Case-insensitive queries | SQL collation/query-specific behavior | Mongo behavior tested for selected user/catalog reads; MySQL corpus NOT RUN |
| Atomic counters | Failed-login lockout and quota/usage operations | Mongo failed-login concurrency tested; MySQL lock-threshold/reset races and quota parity NOT RUN |
| Soft deletion/lifecycle | Prisma enums and transition timestamps | Tenant/session candidate lifecycle paths tested; all lifecycle semantics NOT RUN comparatively |
| Enums | Prisma enum constraints | Candidate schemas validate selected enums; unknown/legacy-value compatibility NOT RUN |

## Required next evidence

1. Restore a valid development-only MySQL connection through the managed secrets/configuration flow. Do not infer or substitute a connection string.
2. Build a reviewed fixture corpus covering Unicode and case comparisons, unique/null/missing values, dates, decimals, ordering/page boundaries, enums, and lifecycle transitions.
3. Run identical repository operations against disposable MySQL and MongoDB fixtures, recording source version/configuration and exact results.
4. Resolve mismatches explicitly before changing service-visible behavior.

No production database was accessed. MySQL runtime dependency removal, production data migration, and cutover remain blocked.
