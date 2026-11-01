# Phase 66 — Repository Dependency Matrix

**Audit date:** 2026-11-01
**Evidence:** Current `src/`, `prisma/schema.prisma`, tests, scripts and prior Phase 64 transaction matrix. Consumer names below are service/controller/module consumers found by source search. This is a code inventory, not a production inventory.

## Reconciled counts

- Prisma schema: **36 models, 21 enums**.
- Checked-in Prisma migration directories: **29**.
- Current application-level repository classes: **25** (22 Prisma-backed control-plane repositories plus 3 tenant-storage contract implementations; the latter may be MongoDB, in-memory, or explicitly unconfigured).
- Central/control-plane Prisma repository classes: **22**. Tenant clinical storage implementations are separate and are not counted as Prisma repositories. The count excludes `PlatformMongoRepositories` and `TenantStorageActivationService`, which is a service rather than a repository.
- Direct Prisma use outside those repository classes remains in `AppController` (readiness), `EncounterService` (operation ledger/audit orchestration), and `TenantStorageActivationService` (transactional registry activation).
- Explicit transaction-bearing files remain **13**: 12 repository classes plus `TenantStorageActivationService`. Multiple transaction blocks occur within several files. This corrects any interpretation of “13 repositories” as exactly 13 repository classes.
- Raw SQL/locking (`$queryRaw`, `FOR UPDATE`) remains present in the transaction-bearing workflows and Prisma readiness probe. No raw SQL usage was found in the migration scripts.
- No cron or scheduled-job registration was found under `src/` or `scripts/`; explicit bootstrap and Prisma development scripts exist.

## Central/control-plane repositories

Risk measures consequence of behavior loss during migration, not code quality. **HIGH** includes security/authorization, money/lifecycle, cross-document invariants, audit, or transaction behavior. **MEDIUM** includes tenant-scoped control-plane state or indexed catalogs. **LOW** means a relatively independent read/catalog surface; no repository is approved for cutover solely by this label.

| Repository / file | Consumers | Prisma models and operations | Invariants, transaction and concurrency | Existing tests / gaps | Risk |
|---|---|---|---|---|---|
| `PlatformUserRepository` — `src/auth/repositories/platform-user.repository.ts` | Authentication service, auth guard/module | `User`; identity lookup and failed-login state | Failed-login increment/lockout transaction; concurrent threshold/reset semantics | Auth foundation tests; no Mongo atomic-counter/lockout contract | HIGH |
| `PlatformSessionRepository` — `src/auth/repositories/platform-session.repository.ts` | Refresh-token service, session service, auth guard | `PlatformSession`, `PlatformRefreshTokenHistory`; session/token reads and updates | 3 transaction blocks; rotation/reuse and revocation span session/history; row lock and uncertain-ack sensitivity | Session repository tests; no Mongo adapter/contract | HIGH |
| `PlatformAuthorizationRepository` — `src/auth/repositories/platform-authorization.repository.ts` | Authorization service/module | `UserPlatformRole`, `PlatformRole`, `PlatformPermission`, `PlatformRolePermission`; role/permission reads | Referential integrity and assignment uniqueness; authorization decisions are security-sensitive | Authorization tests; no Mongo authorization implementation | HIGH |
| `TenantRepository` — `src/tenant/tenant.repository.ts` | Tenant service, membership service | `Tenant`; status and identity reads/writes | Tenant lifecycle gates concurrent membership, role, staff and subscription changes | Tenant repository tests; no target contract | HIGH |
| `TenantMembershipRepository` — `src/tenant/tenant-membership.repository.ts` | Membership service, tenant context service, workspace controller | `TenantMembership`, `Tenant`, `User`; scoped reads and status updates | Transaction locks tenant while changing expected membership state; tenant isolation must remain fail-closed | Membership tests; no Mongo race/reference tests | HIGH |
| `TenantRoleRepository` — `src/tenant/tenant-role.repository.ts` | Tenant-role service | `Tenant`, `TenantRole`, `TenantPermission`, `TenantRolePermission`, membership/owner state | Permission replacement and initial owner bootstrap transactions; single-owner and active-member constraints | Tenant-role tests; no Mongo atomicity test | HIGH |
| `TenantMembershipRoleRepository` — `src/tenant/tenant-membership-role.repository.ts` | Tenant-role and tenant-authorization services | Membership, tenant role/grants, membership-role assignment, staff-role assignment | Two transactional assignment/removal flows; tenant/member/role validity and owner protection | Membership-role tests; no Mongo race or transaction suite | HIGH |
| `TenantStaffRepository` — `src/tenant/tenant-staff.repository.ts` | Staff service | `Tenant`, `TenantMembership`, `User`, `Staff` | Transaction locks tenant and validates active membership/user before create; unique identity/staff constraints | Staff repository tests; no Mongo parent-state race test | HIGH |
| `TenantStaffRoleRepository` — `src/tenant/tenant-staff-role.repository.ts` | Staff-role service | `Tenant`, `Staff`, staff-role assignment/catalog models | Two transactions; active actor/tenant/staff/role checks and assignment uniqueness | Staff-role tests; no Mongo transaction parity | HIGH |
| `TenantStaffScopeRepository` — `src/tenant/tenant-staff-scope.repository.ts` | Staff-scope service | `Tenant`, `Staff`, `Facility`, `Branch`, memberships, staff facility/branch assignments | Four transaction blocks and row locks; scope must match active tenant/facility/branch | Staff-scope tests; no Mongo concurrency/rollback tests | HIGH |
| `FacilityRepository` — `src/tenant/facility.repository.ts` | Facility service | `Facility`, tenant | Create/read/update; tenant ownership and status checks | Facility tests; no reusable cross-adapter contract | MEDIUM |
| `BranchRepository` — `src/tenant/branch.repository.ts` | Branch service | `Tenant`, `Facility`, `Branch` | Transaction locks active parent before branch create; tenant/facility status race | Branch tests; no Mongo parent-state race test | HIGH |
| `HealthcareCatalogRepository` — `src/tenant/healthcare-catalog.repository.ts` | Healthcare catalog service | Tenant, department, specialty | Tenant-scoped catalogs; unique codes/keys and lifecycle filters | Healthcare catalog tests; no Mongo contract | MEDIUM |
| `ServiceCatalogRepository` — `src/tenant/service-catalog.repository.ts` | Service catalog service | Tenant, service | Tenant-scoped catalog state and uniqueness | Service catalog tests; no Mongo contract | MEDIUM |
| `DoctorRepository` — `src/tenant/doctor.repository.ts` | Doctor service | Doctor, staff, tenant, department/specialty assignments | Multiple transactions and locks; cross-catalog validation; Department and Specialty links are independent | Doctor tests; no Mongo transactional parity | HIGH |
| `FacilitySchedulingPolicyRepository` — `src/tenant/appointment-scheduling-policy.repository.ts` | Scheduling policy service | Policy and policy-revision models | Two transactions; expected-version compare-and-set and matching revision must be atomic | Policy tests; no Mongo transaction/uncertain-ack contract | HIGH |
| `FeatureRepository` — `src/platform-catalog/feature.repository.ts` | Feature and plan services | `Feature`; create/read/list/conditional status update | Unique key and conditional lifecycle transition | SaaS catalog tests; no Mongo contract | LOW |
| `PlanRepository` — `src/platform-catalog/plan.repository.ts` | Plan service | `Plan`, `PlanFeature`, `Feature` | Unique key, conditional status/configuration updates and relationship integrity | SaaS catalog tests; no Mongo contract | MEDIUM |
| `TenantEntitlementRepository` — `src/tenant/tenant-entitlement.repository.ts` | Entitlement service/guard | `Plan`, `Feature`, `PlanFeature`, `Subscription` | Read composition drives access policy; consistent lifecycle/filter semantics required | Entitlement tests; no Mongo parity | HIGH |
| `TenantQuotaRepository` — `src/tenant/tenant-quota.repository.ts` | Quota service/guard | Plan-feature quota configuration and usage inputs | Quota decisions must not drift or be bypassed under concurrent usage | Quota tests; no Mongo atomic-counter contract | HIGH |
| `SubscriptionRepository` — `src/subscriptions/subscription.repository.ts` | Subscription service/controller | `Tenant`, `Plan`, `Subscription` | Two transaction blocks with `FOR UPDATE`; active-period overlap cannot be enforced by unique key alone | Subscription tests; no Mongo transactional/overlap race suite | HIGH |
| `PlatformAuditRepository` — `src/platform-security/platform-audit.repository.ts` | Audit service; security module | `PlatformAuditLog`, `PlatformSecurityEvent`, user/tenant references | Append-only audit intent plus conditional event resolution; relation behavior and retention | Audit repository/security tests; no Mongo audit-delivery contract | HIGH |
| `TenantStorageActivationService` — `src/tenant/tenant-storage.activation.service.ts` | Tenant storage activation workflow | `Tenant`, `TenantStorageTarget` plus target indexes | Two transactions and tenant lock; preflight indexes before atomic primary/status switch | Activation tests; no approved-topology registry race test | HIGH |
| `EncounterService` direct Prisma access | Encounter controller/service; audit service and tenant encounter storage | `EncounterOperation`, platform audit, tenant encounter documents | Prepare/write/confirm, idempotency, uncertain outcome and reconciliation cross central SQL/tenant Mongo | Encounter operation/reconciliation tests; no all-store transaction | HIGH |

## Tenant clinical storage contracts

These are not central Prisma repositories and must remain behind the trusted tenant storage boundary:

| Contract / implementation | Data | Isolation requirement | Evidence / gap | Risk |
|---|---|---|---|---|
| `TenantStoragePatientRepository` / `MongoTenantPatientStorage` | Patient documents | Resolve target only from validated `TrustedTenantContext`; never accept caller-selected database | Patient duplicate/index integration evidence exists; central-vs-tenant legacy Patient reconciliation remains open | HIGH |
| `TenantAppointmentRepository` / Mongo and in-memory appointment storage | Appointment documents and schedule locks | Tenant-scoped target resolution, facility/branch scope and facility-policy timezone semantics | Appointment tests and tenant Mongo client evidence; production topology not approved | HIGH |
| `TenantStorageEncounterRepository` / Mongo and in-memory encounter storage | Encounter documents/history | Tenant-scoped target; idempotent operation identity; preserve operation-ledger recovery states | Encounter tests; cross-store audit/ledger consistency remains unproven | HIGH |

## Global dependency and test notes

- The 36-model schema includes relational joins/foreign keys across identity, tenant control plane, staff/catalogs, scheduling, subscriptions, audit/security and encounter ledger. Full model definitions and all declared indexes remain the authoritative constraint inventory.
- `AppController` calls Prisma readiness directly. `TenantWorkspaceController` injects the membership repository directly. `EncounterService` and activation service retain direct Prisma access.
- The test directory contains **108 top-level test files**. Repository-focused tests exist for the entries noted above, but tests generally mock Prisma semantics; they are not portable adapter contract tests.
- Existing Phase 65 tests cover only the isolated platform Mongo foundation. Phase 64 application Mongo evidence covers the tenant patient path and client manager, not replacement of central repositories.
- No production data counts, duplicate rates, database version/topology or live SQL collation behavior were inspected.
