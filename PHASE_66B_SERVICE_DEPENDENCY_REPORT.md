# Phase 66B — Service Dependency Report

**Date:** 2026-11-03
**Scope:** Current service-to-persistence dependencies after all 22 central Prisma-backed repositories received application-owned ports.

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
| `TenantRoleService` | `TenantRolePersistencePort`, `TenantMembershipRolePersistencePort` | Role tokens → Prisma role and membership-role repositories |
| `TenantAuthorizationService` | `TenantMembershipRolePersistencePort` | `TENANT_MEMBERSHIP_ROLE_PERSISTENCE` → `TenantMembershipRoleRepository` |
| `FacilityService` | `FacilityPersistencePort` | `FACILITY_PERSISTENCE` → `FacilityRepository` |
| `BranchService` | `BranchPersistencePort` | `BRANCH_PERSISTENCE` → `BranchRepository` |
| `TenantEntitlementService` | `TenantEntitlementPersistencePort` | `TENANT_ENTITLEMENT_PERSISTENCE` → `TenantEntitlementRepository` |
| `TenantQuotaService` | `TenantQuotaPersistencePort` | `TENANT_QUOTA_PERSISTENCE` → `TenantQuotaRepository` |
| `HealthcareCatalogService` | `HealthcareCatalogPersistencePort` | `HEALTHCARE_CATALOG_PERSISTENCE` → `HealthcareCatalogRepository` |
| `ServiceCatalogService` | `ServiceCatalogPersistencePort` | `SERVICE_CATALOG_PERSISTENCE` → `ServiceCatalogRepository` |
| `SubscriptionService` | `SubscriptionPersistencePort` | `SUBSCRIPTION_PERSISTENCE` → `SubscriptionRepository` |
| `TenantStaffService` | `TenantStaffPersistencePort` | `TENANT_STAFF_PERSISTENCE` → `TenantStaffRepository` |
| `TenantStaffRoleService` | `TenantStaffRolePersistencePort` | `TENANT_STAFF_ROLE_PERSISTENCE` → `TenantStaffRoleRepository` |
| `TenantStaffScopeService` | `TenantStaffScopePersistencePort` | `TENANT_STAFF_SCOPE_PERSISTENCE` → `TenantStaffScopeRepository` |
| `DoctorService` | `DoctorPersistencePort` | `DOCTOR_PERSISTENCE` → `DoctorRepository` |
| `FacilitySchedulingPolicyService` | `FacilitySchedulingPolicyPersistencePort` | `FACILITY_SCHEDULING_POLICY_PERSISTENCE` → `FacilitySchedulingPolicyRepository` |

These consumers use explicit Nest injection tokens and interface-typed constructor parameters. Plan, feature and audit domain behavior stays in the services; Prisma query mechanics remain in their adapters.

## Central repository port coverage

All 22 central Prisma-backed repository classes audited for this increment now implement application-owned ports and are bound to their existing Prisma adapters. No central repository in this audited set remains unported.

This completes the central repository port layer only. One unregistered, read-only authorization candidate exists, but the complete MongoDB adapter set, transaction parity, data migration readiness, and permission to switch runtime storage are not established. Transaction-bearing workflows remain in Prisma.

The `Tenant` model is the organization record; no separate organization or tenant-hostname-resolution repository exists in the audited source.

## Remaining direct Prisma use outside repositories

- `AppController` calls `PrismaService.isReady()` for application readiness.
- `EncounterService` coordinates the central encounter operation ledger with tenant encounter storage and audit; preserve its recovery protocol before extracting a port.
- `TenantStorageActivationService` owns Prisma transactions that coordinate target readiness and registry-primary changes.
- Tenant, membership, and catalog services still inspect Prisma `P2002` errors; generated Prisma enum values also remain in tenant, catalog, and audit service logic. Authorization repository role-code casts remain adapter-local.

## Provider safety

Only Prisma adapter providers are registered for all 22 port groups. `PlatformMongoRepositories` and the isolated authorization candidate remain unused by these services. Persistence providers are registered with `useExisting`; focused DI tests cover the port bindings. No Mongo provider is selected for application traffic.
