# Phase 65 — Platform MongoDB Data Model Implementation

**Status:** Isolated foundation only; not connected to authentication, authorization, tenant activation, subscription, or audit writes.  
**Source model:** Phase 59 target proposal and current Prisma models.  
**Data boundary:** Synthetic disposable replica-set data only. No SQL rows were copied.

## Database and lifecycle

- `PLATFORM_MONGO_URI` and `PLATFORM_MONGO_DATABASE` are an explicit, paired configuration. The platform client is distinct from `TENANT_STORAGE_MONGO_URI` and is never selected from a tenant registry record.
- Both settings default to empty. The new provider does not connect, provision indexes, or affect readiness when not configured. Existing MySQL and tenant storage configuration remain unchanged.
- The platform manager owns a separate bounded client/pool, lazy connection lifecycle, readiness ping, and Nest shutdown cleanup. Connection, topology, and driver exceptions are replaced with neutral platform-storage errors.
- Production configuration, when deliberately supplied, requires validated MongoDB TLS. No production URI was read or used in this phase.
- The module never creates indexes automatically at startup. Operators/tests must call the explicit index provisioner; verification compares named indexes, ordered key definitions, uniqueness, collation, and partial-filter expressions.
- A logical tenant ID is independent of its physical tenant MongoDB placement. This platform database only stores control-plane metadata; it does not route tenant healthcare reads or introduce sharding, fan-out, or rebalancing.

## Document contracts implemented

All identifiers are stable UUID strings in `_id` (legacy IDs are retained as-is). All timestamp fields are BSON `Date` values. Mutable root documents carry `schemaVersion: 1`, `createdAt`, and `updatedAt`. Zod contracts reject unknown fields and validate reads, creates, and replacement updates. Raw credentials and raw refresh tokens are never part of the contracts.

| Prisma source | Collection | Implemented contract and repository |
|---|---|---|
| `User` | `platform_users` | Existing identity fields and status/lockout/token-version data; ID lookup, collation-aware email lookup, create and optimistic replacement update. Password hashes are accepted as stored hashes only; no authentication path uses this repository. |
| `Tenant` | `tenants` | Existing slug, legal/display names, status and lifecycle timestamps; ID lookup, create, update. |
| `TenantMembership` | `tenant_memberships` | Existing tenant/user IDs, status and lifecycle timestamps; create plus tenant-scoped ID read/update. The public repository surface does not expose unscoped membership reads or updates. |
| `PlatformRole` | `platform_roles` | Existing ID, code and timestamps; basic create/read/update. |
| `PlatformPermission` | `platform_permissions` | Existing ID, code and timestamps; basic create/read/update. |
| `UserPlatformRole` | `platform_user_roles` | Existing user/role references and deterministic composite `_id`; basic persistence contract. |
| `PlatformRolePermission` | `platform_role_permissions` | Existing role/permission references and deterministic composite `_id`; basic persistence contract. |
| `PlatformSession` | `platform_sessions` | Existing session metadata and refresh-token hash; basic create/read/update. Hashes only; no TTL index and no auth/session workflow integration. |
| `PlatformRefreshTokenHistory` | `platform_refresh_token_history` | Existing historical token hash, family/session references and rotation/reuse timestamps; basic create/read/update. No token-history pruning policy or TTL index. |

There is no `Organization` Prisma model in the approved schema; `Tenant` is the implemented organization/control-plane root. Platform role/permission contracts do not add `TenantRole`, `TenantPermission`, tenant storage target, audit/security, subscription, or encounter-operation repositories. Those require separate policy/atomicity scope.

## Index contract

The provisioner creates and then verifies indexes for stable root IDs (MongoDB `_id`), unique user email, tenant slug, tenant membership uniqueness and query patterns, platform role/permission codes, both role-reference join collections, session refresh-token hash and session queries, and refresh-history token hash and queries.

Email uses an `en` strength-1 collation in both the unique index and email lookup as a conservative case/accent-insensitive baseline. The source MySQL collation is `utf8mb4_unicode_ci`; exact equivalence across all Unicode weights is **not established**. Before any migration or login cutover, compare source and target equality behavior for the accepted email domain and obtain an explicit collation decision.

No TTL index is created. The source schema has expiry query indexes, but no approved deletion-retention policy. Expiry timestamps therefore remain ordinary indexed fields.

## Integrity and consistency boundary

- Database unique indexes, not an application pre-check, arbitrate duplicate user email, tenant slug, tenant/user membership, and role/permission link conflicts.
- Membership operations always include both membership ID and tenant ID in their read/update predicate.
- Composite assignment IDs use length-delimited ordered UUID components and are deterministic for the same tuple.
- Document validation does not implement relational foreign keys. Cross-document reference existence, tenant-reference agreement for role assignments, and delete restrictions remain contract-level work. No delete APIs are provided here.
- Replace updates use the exact previously read document as the write predicate. A concurrently changed document produces a sanitized conflict instead of silently overwriting it. This is not a multi-document transaction.
- Session refresh rotation/reuse detection and any authorization change spanning related documents require an approved transaction/session boundary and failure-injection evidence. The repository contracts intentionally do not claim those guarantees.
- No repository is injected into existing application workflows; no dual writes occur.

## Verification target safety

The Phase 65 integration test accepts only a credential-free URI containing the three fixed loopback replica-set seeds, `rs0`, and a database name prefixed `phase65_platform_`. The test provisions and drops only that database. Test infra must be disposable, bound to loopback, and removed after the run. The test source does not import Prisma or connect to MySQL.
