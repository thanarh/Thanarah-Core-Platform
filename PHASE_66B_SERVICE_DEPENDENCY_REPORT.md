# Phase 66B — Service Dependency Report

**Date:** 2026-11-01
**Scope:** Current service-to-persistence dependencies after the incremental Phase 66B change.

## Services migrated to ports

| Service | Port dependency | Provider |
|---|---|---|
| `FeatureService` | `FeaturePersistencePort` | `FEATURE_PERSISTENCE` → `FeatureRepository` |
| `PlanService` | `PlanPersistencePort`, `FeaturePersistencePort` | `PLAN_PERSISTENCE` → `PlanRepository`; `FEATURE_PERSISTENCE` → `FeatureRepository` |
| `PlatformAuditService` | `PlatformAuditPersistencePort` | `PLATFORM_AUDIT_PERSISTENCE` → `PlatformAuditRepository` |

These consumers use explicit Nest injection tokens and interface-typed constructor parameters. Plan, feature and audit domain behavior stays in the services; Prisma query mechanics remain in their adapters.

## Remaining concrete repository dependencies

The following 19 of 22 central Prisma-backed repositories remain concrete application dependencies and are not covered by the Phase 66B ports:

- `PlatformUserRepository`
- `PlatformSessionRepository`
- `PlatformAuthorizationRepository`
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

These remaining services must keep their current Prisma providers until an individual port, adapter binding and regression slice is implemented. Transaction-bearing workflows must not be mechanically converted.

## Remaining direct Prisma use outside repositories

- `AppController` calls `PrismaService.isReady()` for application readiness.
- `EncounterService` coordinates the central encounter operation ledger with tenant encounter storage and audit; preserve its recovery protocol before extracting a port.
- `TenantStorageActivationService` owns Prisma transactions that coordinate target readiness and registry-primary changes.
- Catalog services still inspect Prisma `P2002` errors; generated Prisma enum values also remain in catalog/audit service logic.

`TenantWorkspaceController` directly injects `TenantMembershipRepository`; it is not a direct `PrismaService` dependency, but it still bypasses an application service boundary and remains to be addressed.

## Provider safety

Only Prisma adapter providers are registered for the three new tokens. `PlatformMongoRepositories` remains unused by these services. No circular dependency was observed in the focused Nest module compilation test. The other module graphs were not individually refactored or revalidated for new ports because they were not changed.
