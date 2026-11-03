# Phase 66B — Prisma Adapter Mapping

**Date:** 2026-11-03
**Scope:** Mapping for the eight implemented Phase 66B port groups. No MongoDB adapter is registered.

| Port | Prisma adapter | Source models | Query/consistency contract retained |
|---|---|---|---|
| `FeaturePersistencePort` | `FeatureRepository` | `Feature` | Existing selected record fields; find by primary ID or unique key; optional status filter; `createdAt DESC, id DESC` ordering with offset/limit; expected-status conditional updates; uniqueness errors are still translated by `FeatureService`. |
| `PlanPersistencePort` | `PlanRepository` | `Plan`, `PlanFeature`, related `Feature` projection | Existing selected fields; unique key lookup; same deterministic paginated ordering; expected-status conditional updates; plan-feature order is `createdAt ASC, featureId ASC`; quota JSON NULL/write semantics and duplicate behavior remain in Prisma adapter. |
| `PlatformAuditPersistencePort` | `PlatformAuditRepository` | `PlatformAuditLog`, `PlatformSecurityEvent` | Existing create/find behavior; security resolution updates only `id + OPEN` and reports whether exactly one row changed; no transaction was moved or added. |
| `PlatformUserPersistencePort` | `PlatformUserRepository` | `User` | Existing field projections and email lookup retained; failed-login increment and threshold lock continue in the same Prisma transaction; reset remains a single update. |
| `PlatformSessionPersistencePort` | `PlatformSessionRepository` | `PlatformSession`, `PlatformRefreshTokenHistory` | Existing ordering/filter behavior retained; refresh rotation and reuse detection remain atomic in the same transaction with existing row lock/retry policy; revocation remains conditional on ACTIVE state. |
| `PlatformAuthorizationPersistencePort` | `PlatformAuthorizationRepository` | `UserPlatformRole`, `PlatformRole`, `PlatformRolePermission`, `PlatformPermission` | Existing role, role-ID, and permission projections and Set-based permission de-duplication retained. |
| `TenantPersistencePort` | `TenantRepository` | `Tenant` (the organization record) | Existing selected fields, slug lookup, status filters, `createdAt DESC, id DESC` pagination, expected-status conditional update, lifecycle timestamps, and service conflict translation retained. |
| `TenantMembershipPersistencePort` | `TenantMembershipRepository` | `TenantMembership`, related `Tenant`, `User`, and `TenantMembershipRole` projections | Existing tenant/user pair lookup, active tenant/member predicate, workspace/directory projections, tenant-scoped reads/lists, stable ordering, owner protection, parent tenant row lock, and lifecycle transaction retained. |

## Dependency injection

`PlatformCatalogModule` binds catalog tokens; `PlatformSecurityModule` binds the audit token. `AuthPersistenceModule` binds user, session, and authorization tokens. All bindings use `useExisting`.
`TenantPersistenceModule`, imported by `TenantModule`, binds the tenant and membership tokens to their existing Prisma repositories with `useExisting`.

## Remaining Prisma-specific behavior in consumers

- `FeatureService` and `PlanService` still recognize Prisma `P2002` errors to preserve their existing domain conflict responses. This is a remaining implementation leak and should be moved to a neutral adapter error contract in a follow-up increment, with service regression tests updated accordingly.
- Feature/plan status values and platform audit event constants are still imported from Prisma's generated enum exports. The port method signatures use application-owned string unions; a later domain-enum extraction may remove that remaining generated-client dependency without changing API values.
- Tenant status and membership status values remain imported from generated Prisma enums in existing services; the persistence-port signatures use application-owned string unions. The `P2002` collision translation also remains service-side.
- All other repository classes and their consumers are unmigrated. See `PHASE_66B_SERVICE_DEPENDENCY_REPORT.md`.

## Verification boundary

Focused repository tests use the existing Prisma-mocked test suites. Provider tests assert that the port tokens resolve to their intended Prisma repositories. No database or MongoDB connection is made by those tests.
