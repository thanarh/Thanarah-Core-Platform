# Phase 66B — Service Dependency Report

**Date:** 2026-11-02
**Scope:** Current service-to-persistence dependencies after the Phase 66B Slice 2 increment.

## Services migrated to ports

| Service | Port dependency | Provider |
|---|---|---|
| `FeatureService` | `FeaturePersistencePort` | `FEATURE_PERSISTENCE` → `FeatureRepository` |
| `PlanService` | `PlanPersistencePort`, `FeaturePersistencePort` | `PLAN_PERSISTENCE` → `PlanRepository`; `FEATURE_PERSISTENCE` → `FeatureRepository` |
| `PlatformAuditService` | `PlatformAuditPersistencePort` | `PLATFORM_AUDIT_PERSISTENCE` → `PlatformAuditRepository` |
| `AuthenticationService`, `PlatformAuthGuard` | `PlatformUserPersistencePort` | `PLATFORM_USER_PERSISTENCE` → `PlatformUserRepository` |
| `PlatformSessionService`, `RefreshTokenService`, `PlatformAuthGuard` | `PlatformSessionPersistencePort` | `PLATFORM_SESSION_PERSISTENCE` → `PlatformSessionRepository` |
| `PlatformAuthorizationService` | `PlatformAuthorizationPersistencePort` | `PLATFORM_AUTHORIZATION_PERSISTENCE` → `PlatformAuthorizationRepository` |

These consumers use explicit Nest injection tokens and interface-typed constructor parameters. Plan, feature and audit domain behavior stays in the services; Prisma query mechanics remain in their adapters.

## Remaining concrete repository dependencies

The following 16 of 22 central Prisma-backed repositories remain unported:

- `TenantRepository`
- `TenantMembershipRepository`
- `TenantRoleRepository`
- `TenantMembershipRoleRepository`
- `TenantStaffRepository`
- `TenantStaffRoleRepository`
- `TenantStaffScopeRepository`
- `FacilityRepository`
- `BranchRepository`
- `HealthcareCatalogRepository`
- `ServiceCatalogRepository`
- `DoctorRepository`
- `FacilitySchedulingPolicyRepository`
- `TenantEntitlementRepository`
- `TenantQuotaRepository`
- `SubscriptionRepository`

These remaining repositories must keep their current Prisma providers until an individual port, adapter binding and regression slice is implemented. Transaction-bearing workflows must not be mechanically converted.

`TenantMembershipService` still injects `PlatformUserRepository` directly to check user identity. The adapter now implements `PlatformUserPersistencePort`, but this tenant-membership consumer was intentionally not migrated in the auth slice.

## Remaining direct Prisma use outside repositories

- `AppController` calls `PrismaService.isReady()` for application readiness.
- `EncounterService` coordinates the central encounter operation ledger with tenant encounter storage and audit; preserve its recovery protocol before extracting a port.
- `TenantStorageActivationService` owns Prisma transactions that coordinate target readiness and registry-primary changes.
- Catalog services still inspect Prisma `P2002` errors; generated Prisma enum values also remain in catalog/audit service logic. Authorization repository role-code casts remain adapter-local.

`TenantWorkspaceController` directly injects `TenantMembershipRepository`; it is not a direct `PrismaService` dependency, but it still bypasses an application service boundary and remains to be addressed.

## Provider safety

Only Prisma adapter providers are registered for the six port groups. `PlatformMongoRepositories` remains unused by these services. The auth persistence providers are in `AuthPersistenceModule` and registered with `useExisting`. The focused DI test resolves the three auth port tokens to their Prisma repositories.
