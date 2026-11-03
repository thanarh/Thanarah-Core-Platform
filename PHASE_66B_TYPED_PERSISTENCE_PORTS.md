# Phase 66B — Typed Persistence Ports

**Date:** 2026-11-03
**Status:** Application-owned ports and Prisma bindings are implemented for all 22 central repositories audited in Phase 66B. Prisma remains the sole active adapter.

## Implemented ports

| Port | Operations | Active adapter | Migrated consumers |
|---|---|---|---|
| `FeaturePersistencePort` | Create, lookup by ID/key, paginated list, expected-status update and status transition | `FeatureRepository` | `FeatureService`, `PlanService` |
| `PlanPersistencePort` | Create, lookup by ID/key, paginated list, expected-status update and status transition; plan-feature lookup/list/attach/configuration update/detach | `PlanRepository` | `PlanService` |
| `PlatformAuditPersistencePort` | Create/find audit log, create security event, resolve an open security event conditionally | `PlatformAuditRepository` | `PlatformAuditService` |
| `PlatformUserPersistencePort` | Auth identity lookup, login lookup, transactional failed-login tracking, reset | `PlatformUserRepository` | `AuthenticationService`, `PlatformAuthGuard` |
| `PlatformSessionPersistencePort` | Session CRUD/list/revocation, refresh-token rotation and reuse detection | `PlatformSessionRepository` | `PlatformSessionService`, `RefreshTokenService`, `PlatformAuthGuard` |
| `PlatformAuthorizationPersistencePort` | Role, role-ID, and permission lookup | `PlatformAuthorizationRepository` | `PlatformAuthorizationService` |
| `TenantPersistencePort` | Tenant/organization create, lookup, list, and conditional lifecycle status update | `TenantRepository` | `TenantService`, `TenantMembershipService` |
| `TenantMembershipPersistencePort` | Tenant-scoped membership lookup/list, workspace enumeration, active-pair checks, and conditional lifecycle changes | `TenantMembershipRepository` | `TenantMembershipService`, `TenantMembershipValidatorService`, `TenantWorkspaceController` |
| `TenantRolePersistencePort` | Tenant-scoped role CRUD, permission replacement, and owner bootstrap | `TenantRoleRepository` | `TenantRoleService` |
| `TenantMembershipRolePersistencePort` | Permission/role resolution, assignment listing, assignment, and removal | `TenantMembershipRoleRepository` | `TenantRoleService`, `TenantAuthorizationService` |
| `FacilityPersistencePort` | Tenant-scoped create/read/list/update and conditional lifecycle change | `FacilityRepository` | `FacilityService` |
| `BranchPersistencePort` | Facility-scoped read/list/update/lifecycle and active-parent branch creation | `BranchRepository` | `BranchService` |
| `TenantEntitlementPersistencePort` | Active plan/feature entitlement resolution | `TenantEntitlementRepository` | `TenantEntitlementService` |
| `TenantQuotaPersistencePort` | Active plan-feature quota configuration lookup | `TenantQuotaRepository` | `TenantQuotaService` |
| `HealthcareCatalogPersistencePort` | Tenant-scoped department/specialty CRUD and conditional lifecycle changes | `HealthcareCatalogRepository` | `HealthcareCatalogService` |
| `ServiceCatalogPersistencePort` | Tenant-scoped service CRUD, listing and conditional lifecycle changes | `ServiceCatalogRepository` | `ServiceCatalogService` |
| `SubscriptionPersistencePort` | Tenant/plan-scoped creation, listing, current lookup and lifecycle transition | `SubscriptionRepository` | `SubscriptionService` |
| `TenantStaffPersistencePort` | Eligible-membership staff creation, tenant-scoped read/update/list and lifecycle change | `TenantStaffRepository` | `TenantStaffService` |
| `TenantStaffRolePersistencePort` | Staff role listing, assignment and removal | `TenantStaffRoleRepository` | `TenantStaffRoleService` |
| `TenantStaffScopePersistencePort` | Facility/branch assignment changes and effective staff scope resolution | `TenantStaffScopeRepository` | `TenantStaffScopeService` |
| `DoctorPersistencePort` | Doctor create/read/list/update, lifecycle change, and department/specialty assignments | `DoctorRepository` | `DoctorService` |
| `FacilitySchedulingPolicyPersistencePort` | Facility policy reads, versioned updates/status changes, and revision listing | `FacilitySchedulingPolicyRepository` | `FacilitySchedulingPolicyService` |

The interfaces and runtime injection tokens live in `src/persistence/platform-persistence.ports.ts`. The contract types are application-owned and do not expose Prisma or MongoDB types. Plan-feature `quotaLimits` is intentionally `unknown` at the storage boundary; the existing domain schema validates it before interpreting it.

## NestJS bindings

- `FEATURE_PERSISTENCE` resolves to the existing `FeatureRepository`.
- `PLAN_PERSISTENCE` resolves to the existing `PlanRepository`.
- `PLATFORM_AUDIT_PERSISTENCE` resolves to the existing `PlatformAuditRepository`.
- `PLATFORM_USER_PERSISTENCE`, `PLATFORM_SESSION_PERSISTENCE`, and `PLATFORM_AUTHORIZATION_PERSISTENCE` resolve to the corresponding Prisma repositories.
- Each is registered with `useExisting`, so there is one Prisma repository instance per class.
- `TENANT_PERSISTENCE` and `TENANT_MEMBERSHIP_PERSISTENCE` resolve to the corresponding existing Prisma repositories.
- Tenant role/assignment, facility/branch, entitlement, and quota tokens resolve to their existing Prisma repositories.
- No MongoDB adapter is registered or selected. One read-only authorization candidate exists outside Nest bindings; missing active bindings still fail through dependency resolution.

## Behavior retained

- Catalog reads keep their existing filters, ordering and pagination.
- Catalog updates retain status compare-and-set predicates.
- Audit resolution remains conditional on the event still being OPEN.
- Login lockout remains one Prisma transaction; refresh history, row locking, rotation, and reuse compromise remain in the existing session repository transactions.
- Role and permission filters, session listing order, and token claims remain unchanged.
- Tenant-scoped membership predicates, active tenant checks, lifecycle compare-and-set, owner protection, row locking, and transaction ownership remain unchanged.
- `TenantMembershipService` resolves platform user existence through `PlatformUserPersistencePort`.
- Role owner-bootstrap, permission replacement, membership-role assignment/removal, and branch creation keep their transaction ownership in the Prisma repositories.
- Facility/branch scope predicates, lifecycle compare-and-set operations, deterministic pagination, and entitlement/quota decision behavior remain unchanged.
- Healthcare/service catalog tenant filters and staff, role, scope, subscription, doctor, and scheduling-policy transaction ownership remain in the Prisma adapters.
- The existing transactions remain where they were; no transaction ownership moved.
- Existing controllers and public HTTP behavior were not changed.

## Migration gaps despite port coverage

All 22 audited central Prisma-backed repositories now implement ports and are bound to Prisma. Storage activation, application readiness, and encounter operation persistence remain direct Prisma responsibilities outside this repository-port set.

The 22 ports do not establish MongoDB compatibility, migration readiness, or transaction parity. The Prisma/MySQL repositories remain the only runtime implementations; one isolated, unregistered authorization candidate has unit coverage only, including session propagation and snapshot-read options.
