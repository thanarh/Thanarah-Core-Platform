# Phase 66B — Typed Persistence Ports

**Date:** 2026-11-02
**Status:** Incremental port migration implemented for catalogs, audit, and platform identity/authentication. Prisma remains the sole active adapter.

## Implemented ports

| Port | Operations | Active adapter | Migrated consumers |
|---|---|---|---|
| `FeaturePersistencePort` | Create, lookup by ID/key, paginated list, expected-status update and status transition | `FeatureRepository` | `FeatureService`, `PlanService` |
| `PlanPersistencePort` | Create, lookup by ID/key, paginated list, expected-status update and status transition; plan-feature lookup/list/attach/configuration update/detach | `PlanRepository` | `PlanService` |
| `PlatformAuditPersistencePort` | Create/find audit log, create security event, resolve an open security event conditionally | `PlatformAuditRepository` | `PlatformAuditService` |
| `PlatformUserPersistencePort` | Auth identity lookup, login lookup, transactional failed-login tracking, reset | `PlatformUserRepository` | `AuthenticationService`, `PlatformAuthGuard` |
| `PlatformSessionPersistencePort` | Session CRUD/list/revocation, refresh-token rotation and reuse detection | `PlatformSessionRepository` | `PlatformSessionService`, `RefreshTokenService`, `PlatformAuthGuard` |
| `PlatformAuthorizationPersistencePort` | Role, role-ID, and permission lookup | `PlatformAuthorizationRepository` | `PlatformAuthorizationService` |

The interfaces and runtime injection tokens live in `src/persistence/platform-persistence.ports.ts`. The contract types are application-owned and do not expose Prisma or MongoDB types. Plan-feature `quotaLimits` is intentionally `unknown` at the storage boundary; the existing domain schema validates it before interpreting it.

## NestJS bindings

- `FEATURE_PERSISTENCE` resolves to the existing `FeatureRepository`.
- `PLAN_PERSISTENCE` resolves to the existing `PlanRepository`.
- `PLATFORM_AUDIT_PERSISTENCE` resolves to the existing `PlatformAuditRepository`.
- `PLATFORM_USER_PERSISTENCE`, `PLATFORM_SESSION_PERSISTENCE`, and `PLATFORM_AUTHORIZATION_PERSISTENCE` resolve to the corresponding Prisma repositories.
- Each is registered with `useExisting`, so there is one Prisma repository instance per class.
- No MongoDB adapter is registered or selected. Missing bindings fail through Nest dependency resolution.

## Behavior retained

- Catalog reads keep their existing filters, ordering and pagination.
- Catalog updates retain status compare-and-set predicates.
- Audit resolution remains conditional on the event still being OPEN.
- Login lockout remains one Prisma transaction; refresh history, row locking, rotation, and reuse compromise remain in the existing session repository transactions.
- Role and permission filters, session listing order, and token claims remain unchanged.
- The existing transactions remain where they were; no transaction ownership moved.
- Existing controllers and public HTTP behavior were not changed.

## Scope not yet covered

This is deliberately incremental, not a completed port layer for the central domain. Six of the 22 central Prisma-backed repository classes now implement ports; 16 remain unported. Tenant/member/role/staff authorization, subscriptions, entitlements, quotas, scheduling, storage activation and encounter operation persistence are not ported. Their transaction/concurrency guarantees remain as recorded in the Phase 66 reports.

The 3 migrated boundaries do not establish MongoDB compatibility, migration readiness, or transaction parity. The Prisma/MySQL repositories remain the only runtime implementations.
