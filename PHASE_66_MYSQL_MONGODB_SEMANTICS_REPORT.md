# Phase 66 — MySQL and MongoDB Semantics Report

**Date:** 2026-11-01
**Scope:** Source-level review of current Prisma/MySQL and MongoDB contracts. No source database was queried and no cross-engine equivalence is claimed.

| Semantic area | Current evidence / SQL behavior | MongoDB contract and evidence gap |
|---|---|---|
| Email normalization, case and Unicode collation | `User.email` is unique in MySQL. The source collation is configured by MySQL; runtime and accepted email-domain behavior have not been measured against a production instance. | Phase 65 uses `en` strength-1 collation. This is not proven equivalent to MySQL `utf8mb4_unicode_ci`. Measure a reviewed Unicode corpus against a disposable MySQL fixture and Mongo replica set; decide normalization and accepted domain before identity cutover. |
| Unique and nullable unique constraints | Prisma schema declares unique keys and nullable fields; nullable behavior depends on the concrete MySQL collation/version and index definition. | Mongo unique indexes differ for missing/null values and partial filters. Inventory every unique/compound/nullable key and test null, missing, duplicate, case and concurrent insert behavior. Phase 65 verifies only its implemented platform indexes. |
| Date/time precision and timezone | Prisma `DateTime` values are UTC instants; scheduling also has date-only filters interpreted by facility policy timezone. | BSON Date has millisecond precision. Round-trip values around sub-millisecond boundaries and DST transitions. Preserve date-only semantics and active facility timezone; browser timezone is only a labeled UI fallback. |
| Decimal and monetary precision | Prisma monetary/decimal fields must be checked model-by-model against schema types and service conversions. | No blanket Number conversion is acceptable. Use Decimal128 or a documented integer-minor-unit contract only after comparing existing scale, rounding and serialization behavior. Exact source-model audit/test corpus remains required. |
| Sorting and pagination | Repository methods define order and pagination behavior; some order by timestamps/status and stable IDs. | Compound indexes must match filters plus order, with a deterministic tie-breaker. Test equal timestamps, nulls, collation, page boundaries, and concurrent inserts; no complete cross-adapter pagination suite exists. |
| Case-insensitive searches | Email lookup is explicitly collation-aware in Phase 65; other lookups follow SQL predicates/collations. | Do not apply email collation globally. For every case-insensitive predicate, specify normalization/collation and test indexes and Unicode equivalence. |
| Enums | Prisma enums constrain stored values for 21 declared enums. | Use strict schema validation and explicit supported values; test legacy/unknown values and forward-compatibility policy. MongoDB itself does not enforce the Prisma enum set. |
| UUID versus ObjectId | Central identifiers are UUID strings (`CHAR(36)` in schema). | Keep UUID strings in `_id`/references to avoid rewriting identifiers and breaking existing links. Phase 65 uses UUID strings for its implemented documents. |
| Null versus missing | SQL nullable columns are represented as nullable fields; JSON columns can have separate SQL NULL/JSON null semantics. | BSON missing and explicit null are different query/update states. Define per-field serialization, defaults and migration treatment; test old documents and `$exists`/null filters. |
| Atomic counters | Login failed-attempt state and quota/usage behavior are stateful; no global counter semantics can be inferred from CRUD tests. | Use atomic conditional updates and retry-safe operation IDs where needed. Prove lock threshold, reset races and quota oversubscription under concurrency. |
| Soft deletion/lifecycle | Status enums and nullable lifecycle timestamps express active/suspended/deactivated/removed/revoked states; runtime filters vary by domain. | Preserve exact status transition predicates and hidden/expired behavior. Do not substitute physical deletion or TTL. Phase 65 intentionally has no TTL index; retention remains an owner decision. |
| Referential integrity | MySQL foreign keys, composite tenant-scoped references and `onDelete` rules are encoded in Prisma schema/migrations. | MongoDB does not supply relational foreign keys. Each relation needs transaction-scoped validation, a reviewed serialization protocol, or repair/reconciliation process. Unique indexes alone do not prevent orphan or cross-tenant references. |

## Evidence status

- The repository currently declares MySQL in `prisma/schema.prisma`, with 36 models and 21 enums.
- Phase 65 documents Mongo email collation as a conservative baseline, not parity.
- Existing Mongo tests do not cover all SQL null, decimal, sort, pagination, search, enum, or lifecycle semantics across all repositories.
- Phase 66 did not run semantic differential tests against disposable MySQL and MongoDB fixtures. These test cases are **NOT RUN** in this phase.

**Decision:** No cross-engine semantic compatibility is established. Build model-specific differential tests before adapter replacement and keep migration readiness **NO-GO**.
