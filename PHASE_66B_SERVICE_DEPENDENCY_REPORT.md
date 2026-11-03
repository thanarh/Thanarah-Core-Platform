# Phase 66B — Service Dependency Report

**Date:** 2026-11-03
**Scope:** Current service-to-persistence dependencies after the Phase 66B Slice 3 increment.

## Services migrated to ports

| Service | Port dependency | Provider |
|---|---|---|
| `FeatureService` | `FeaturePersistencePort` | `FEATURE_PERSISTENCE` → `FeatureRepository` |
| `PlanService` | `PlanPersistencePort`, `FeaturePersistencePort` | `PLAN_PERSISTENCE` → `PlanRepository`; `FEATURE_PERSISTENCE` → `FeatureRepository` |
| `PlatformAuditService` | `PlatformAuditPersistencePort` | `PLATFORM_AUDIT_PERSISTENCE` → `PlatformAuditRepository` |
| `AuthenticationService`, `PlatformAuthGuard` | `PlatformUserPersistencePort` | `PLATFORM_USER_PERSISTENCE` → `PlatformUserRepository` |
| `PlatformSessionService`, `RefreshTokenService`, `PlatformAuthGuard` | `PlatformSessionPersistencePort` | `PLATFORM_SESSION_PERSISTENCE` → `PlatformSessionRepository` |
| `PlatformAuthorizationService` | `PlatformAuthorizationPersistencePort` | `PLATFORM_AUTHORIZATION_PERSISTENCE` → `PlatformAuthorizationRepository` |
| `TenantService` | `TenantPersistencePort` | `TENANT_PERSISTENCE` → `TenantRepository` |
| `TenantMembershipService` | `TenantMembershipPersistencePort`, `TenantPersistencePort`, `PlatformUserPersistencePort` | Tenant/membership tokens → Prisma repositories; user token → `PlatformUserRepository` |
| `TenantMembershipValidatorService`, `TenantWorkspaceController` | `TenantMembershipPersistencePort` | `TENANT_MEMBERSHIP_PERSISTENCE` → `TenantMembershipRepository` |

These consumers use explicit Nest injection tokens and interface-typed constructor parameters. Plan, feature and audit domain behavior stays in the services; Prisma query mechanics remain in their adapters.

## Remaining concrete repository dependencies

The following 14 of 22 central Prisma-backed repositories remain unported:

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

The `Tenant` model is the organization record; no separate organization or tenant-hostname-resolution repository exists in the audited source.

## Remaining direct Prisma use outside repositories

- `AppController` calls `PrismaService.isReady()` for application readiness.
- `EncounterService` coordinates the central encounter operation ledger with tenant encounter storage and audit; preserve its recovery protocol before extracting a port.
- `TenantStorageActivationService` owns Prisma transactions that coordinate target readiness and registry-primary changes.
- Tenant, membership, and catalog services still inspect Prisma `P2002` errors; generated Prisma enum values also remain in tenant, catalog, and audit service logic. Authorization repository role-code casts remain adapter-local.

## Provider safety

Only Prisma adapter providers are registered for the eight port groups. `PlatformMongoRepositories` remains unused by these services. Auth and tenant persistence providers are registered with `useExisting`. Focused DI tests resolve the tenant/membership, auth, catalog, and audit port tokens to their Prisma repositories.
