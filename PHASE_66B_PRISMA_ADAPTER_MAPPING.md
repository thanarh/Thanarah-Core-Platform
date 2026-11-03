# Phase 66B — Prisma Adapter Mapping

**Date:** 2026-11-03
**Scope:** Mapping for all 22 implemented Phase 66B central port groups. No MongoDB adapter is registered; one isolated read-only authorization candidate is not an active replacement.

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
| `TenantRolePersistencePort` | `TenantRoleRepository` | `TenantRole`, `TenantPermission`, `TenantRolePermission` | Tenant predicates and deterministic role ordering retained; permission replacement and initial owner bootstrap remain in existing Prisma transactions, including tenant row lock and owner uniqueness check. |
| `TenantMembershipRolePersistencePort` | `TenantMembershipRoleRepository` | `TenantMembershipRole`, `TenantMembership`, `TenantRole`, staff role assignments | Active tenant/member and role checks, self/owner protections, idempotent assignment, and tenant lock within assign/remove transactions remain unchanged. |
| `FacilityPersistencePort` | `FacilityRepository` | `Facility` | Tenant-scoped access, stable `createdAt DESC, id DESC` pagination, expected-status conditional lifecycle updates, and lifecycle timestamps retained. |
| `BranchPersistencePort` | `BranchRepository` | `Branch`, `Facility`, `Tenant` | Facility/tenant-scoped access, stable pagination, active-parent checks, and active-parent row locks around branch creation retained. |
| `TenantEntitlementPersistencePort` | `TenantEntitlementRepository` | `Plan`, `PlanFeature`, `Feature` | Existing plan/feature status checks and explicit missing, disabled, unavailable, and ambiguous outcomes retained. |
| `TenantQuotaPersistencePort` | `TenantQuotaRepository` | `PlanFeature`, `Plan`, `Feature` | Existing enabled/active checks retained; quota JSON remains opaque until validated by the quota service. |
| `HealthcareCatalogPersistencePort` | `HealthcareCatalogRepository` | `Department`, `Specialty`, `Tenant` | Tenant-scoped catalog access and conditional lifecycle behavior remain in the existing adapter. |
| `ServiceCatalogPersistencePort` | `ServiceCatalogRepository` | `Service`, `Tenant` | Tenant-scoped list/read/write semantics and existing conflict outcomes remain in the adapter. |
| `SubscriptionPersistencePort` | `SubscriptionRepository` | `Subscription`, `Tenant`, `Plan` | Subscription lifecycle and period checks remain inside the existing Prisma transactions. |
| `TenantStaffPersistencePort` | `TenantStaffRepository` | `Staff`, `TenantMembership`, `User`, `Tenant` | Active tenant/member eligibility, duplicate prevention, tenant predicates, and existing lifecycle behavior remain unchanged. |
| `TenantStaffRolePersistencePort` | `TenantStaffRoleRepository` | `StaffRoleAssignment`, `TenantRole`, `TenantMembership`, `Tenant` | Assignment/removal checks, tenant locking, and owner/self protections remain in the adapter transactions. |
| `TenantStaffScopePersistencePort` | `TenantStaffScopeRepository` | Staff facility/branch assignments, `Staff`, `Facility`, `Branch`, `TenantMembership`, `Tenant` | Actor/staff/unit eligibility checks, tenant scope, idempotency, and assignment transactions remain unchanged. |
| `DoctorPersistencePort` | `DoctorRepository` | `Doctor`, staff and catalog assignment models, `Tenant` | Tenant, staff, and active catalog row locking plus assignment transactions remain in the Prisma adapter. |
| `FacilitySchedulingPolicyPersistencePort` | `FacilitySchedulingPolicyRepository` | Facility scheduling policy and revision models | Version compare-and-set and revision writes remain in the same Prisma transaction. |

## Dependency injection

`PlatformCatalogModule` binds catalog tokens; `PlatformSecurityModule` binds the audit token. `AuthPersistenceModule` binds user, session, and authorization tokens. All bindings use `useExisting`.
`TenantPersistenceModule`, imported by `TenantModule`, binds the tenant and membership tokens to their existing Prisma repositories with `useExisting`.
`TenantRolePersistenceModule` binds role and membership-role ports; `TenantFacilityBranchPersistenceModule` binds facility and branch ports. Entitlement, quota, catalog, subscription, staff, doctor, and scheduling-policy modules bind their tokens to Prisma providers.

## Remaining Prisma-specific behavior in consumers

- `FeatureService` and `PlanService` still recognize Prisma `P2002` errors to preserve their existing domain conflict responses. This is a remaining implementation leak and should be moved to a neutral adapter error contract in a follow-up increment, with service regression tests updated accordingly.
- Feature/plan status values and platform audit event constants are still imported from Prisma's generated enum exports. The port method signatures use application-owned string unions; a later domain-enum extraction may remove that remaining generated-client dependency without changing API values.
- Tenant status and membership status values remain imported from generated Prisma enums in existing services; the persistence-port signatures use application-owned string unions. The `P2002` collision translation also remains service-side.
- All 22 repositories in the audited central repository set are ported. Direct Prisma responsibilities outside that set remain, including storage activation, readiness, and encounter coordination.

## Verification boundary

Focused repository tests use the existing Prisma-mocked test suites. Provider tests assert the registered persistence tokens resolve to their intended Prisma repositories. The isolated authorization candidate has mocked unit tests; its Phase 65 replica-set test is opt-in and was skipped in the current run.
