# Thanarah Repository-Port Completion Matrix

**Updated:** 2026-11-13
**Decision:** All 22 central persistence ports are now registered with MongoDB implementations in the application. Production activation and production data migration are not approved by this document.

## Current source registrations

| Port | Registered implementation |
| --- | --- |
| TenantPersistencePort | MongoTenantRepository |
| TenantMembershipPersistencePort | MongoTenantMembershipRepository |
| TenantRolePersistencePort | MongoTenantRoleRepository |
| TenantMembershipRolePersistencePort | MongoTenantMembershipRoleRepository |
| FacilityPersistencePort | MongoFacilityRepository |
| BranchPersistencePort | MongoBranchRepository |
| TenantEntitlementPersistencePort | MongoTenantEntitlementRepository |
| TenantQuotaPersistencePort | MongoTenantEntitlementRepository |
| SubscriptionPersistencePort | MongoSubscriptionRepository |
| TenantStaffPersistencePort | MongoTenantStaffRepository |
| TenantStaffRolePersistencePort | MongoTenantStaffRoleRepository |
| TenantStaffScopePersistencePort | MongoTenantStaffScopeRepository |
| FacilitySchedulingPolicyPersistencePort | MongoFacilitySchedulingPolicyRepository |
| DoctorPersistencePort | MongoDoctorRepository |
| PlatformUserPersistencePort | MongoPlatformUserRepository |
| PlatformSessionPersistencePort | MongoPlatformSessionRepository |
| PlatformAuthorizationPersistencePort | MongoPlatformAuthorizationRepository |
| FeaturePersistencePort | MongoPlatformFeatureRepository |
| PlanPersistencePort | MongoPlatformPlanRepository |
| PlatformAuditPersistencePort | MongoPlatformAuditRepository |
| HealthcareCatalogPersistencePort | MongoHealthcareCatalogRepository |
| ServiceCatalogPersistencePort | MongoServiceCatalogRepository |

Direct runtime paths also use MongoDB: subscription transfer/settings handling,
the encounter operation ledger, storage-target registry and target activation.
Domain enum values and registry contracts no longer load the generated SQL
client. Historical SQL files and migrations remain available, but are not
application providers.

The disposable replica-set adapter suites passed **77 tests**: 27 platform,
20 role/policy, 12 staff-scope/doctor, 12 control-plane, and 6 tenant-storage
tests. This is not production approval or a claim of exhaustive equivalence
with every historical MySQL test. The compiled full-app/browser verification
and development initialization outcome are recorded in
`THANARAH_MONGODB_CONVERSION_PROGRESS.md`.

## Historical pre-activation matrix

The table and totals below preserve the earlier candidate audit. Their
“unregistered”, “missing”, and “not ready” classifications describe that earlier
increment, not current source registrations. Remaining production-level
acceptance requirements must still be evaluated separately.

| Persistence port | Prisma/MySQL implementation | Mongo candidate | Candidate classification | Disposable replica-set evidence | MySQL parity / activation |
|---|---|---|---|---|
| TenantPersistencePort | Present | `MongoTenantRepository` candidate | PARTIAL | Replica-set tests cover create/read/list/status CAS, pagination, and lifecycle timestamps | Not verified; slug collation parity / not ready |
| TenantMembershipPersistencePort | Present | `MongoTenantMembershipRepository` candidate | PARTIAL | Replica-set tests cover create/read/list/directory, active tenant lookup, lifecycle CAS, duplicate protection, and owner protection; status/assignment race proof remains incomplete | Not verified; transaction and owner-assignment parity / not ready |
| TenantRolePersistencePort | Present | `MongoTenantRoleRepository` candidate | PARTIAL | Replica-set tests cover role CRUD metadata, permission replacement, system-role protection, and transactional owner bootstrap | MySQL collation, cross-port coordination, and transaction/error parity unverified / not ready |
| TenantMembershipRolePersistencePort | Present | `MongoTenantMembershipRoleRepository` | PARTIAL | Disposable tests cover membership/staff permission aggregation in one snapshot, owner protection, tenant/actor isolation, self-assignment, idempotency, concurrent assignment and stale-parent retry | End-to-end activation and complete cross-port concurrency review pending / not ready |
| FacilityPersistencePort | Present | `MongoFacilityRepository` candidate; all port methods implemented | PARTIAL | Replica-set test covers reference rejection, tenant isolation, stable pagination, rename, and status CAS | MySQL parity and dependent transaction/reference race behavior not verified / not ready |
| BranchPersistencePort | Present | `MongoBranchRepository` candidate | PARTIAL | Replica-set tests cover active parent checks, tenant scoping, list/update, and lifecycle CAS | Parent status races and MySQL parity not verified / not ready |
| TenantEntitlementPersistencePort | Present | `MongoTenantEntitlementRepository` | PARTIAL | Entitlement state and cross-collection snapshot test | Not verified / not ready |
| TenantQuotaPersistencePort | Present | `MongoTenantEntitlementRepository` | PARTIAL | Active configuration and unavailable-state test | Not verified / not ready |
| SubscriptionPersistencePort | Present | `MongoSubscriptionRepository` candidate | PARTIAL | Replica-set tests cover overlap rejection, concurrent serialization, current lookup, and lifecycle transitions | Plan/tenant state races, isolation parity, uncertain commit, and MySQL semantics remain unverified / not ready |
| TenantStaffPersistencePort | Present | `MongoTenantStaffRepository` candidate | PARTIAL | Replica-set tests cover eligible-member creation, duplicate prevention, tenant-scoped reads, metadata updates, and lifecycle CAS | MySQL transaction/reference-race, status behavior, and service-error parity not verified / not ready |
| TenantStaffRolePersistencePort | Present | `MongoTenantStaffRoleRepository` | PARTIAL | Disposable tests cover staff eligibility, owner-only assignment, owner protection, listing/removal, duplicate and concurrent grants, and tenant/actor isolation | End-to-end activation and complete cross-port concurrency review pending / not ready |
| TenantStaffScopePersistencePort | Present | None | MISSING | None | Not verified / not ready |
| FacilitySchedulingPolicyPersistencePort | Present | `MongoFacilitySchedulingPolicyRepository` | PARTIAL | Disposable tests cover create/update/status, expected-version conflict, concurrent updates, ordered revisions, tenant/reference isolation, and rollback when revision insertion fails | Mongo-only appointment/browser journey and application registration pending / not ready |
| DoctorPersistencePort | Present | None | MISSING | None | Not verified / not ready |
| PlatformUserPersistencePort | Present | `MongoPlatformUserRepository` | PARTIAL | Concurrent failed-login increments, lockout, and reset test | Not verified / not ready |
| PlatformSessionPersistencePort | Present | `MongoPlatformSessionRepository` candidate | PARTIAL | Replica-set tests cover user-referenced create, rotation/reuse, lifecycle lookup, activity, and revocation/status transitions; full method-by-method contract and race/failover evidence remains incomplete | Not verified / not ready |
| PlatformAuthorizationPersistencePort | Present | `MongoPlatformAuthorizationRepository` | PARTIAL | Snapshot reads, references, failure handling, and stepdown recovery | Not verified / not ready |
| FeaturePersistencePort | Present | `MongoPlatformFeatureRepository` | PARTIAL | Lookup, pagination, uniqueness, and conditional updates | Collation parity not verified / not ready |
| PlanPersistencePort | Present | `MongoPlatformPlanRepository` | PARTIAL | Lifecycle and plan-feature operations | Collation parity not verified / not ready |
| PlatformAuditPersistencePort | Present | `MongoPlatformAuditRepository` candidate | PARTIAL | Replica-set tests cover reference validation, idempotent audit lookup, security-event creation, and one-time resolution | MySQL/error semantics and event-delivery readiness not verified / not ready |
| HealthcareCatalogPersistencePort | Present | `MongoHealthcareCatalogRepository` candidate | PARTIAL | Replica-set tests cover both catalog kinds, unique names, tenant-active checks, tenant scoping, updates, and lifecycle CAS | MySQL collation and service/error parity not verified / not ready |
| ServiceCatalogPersistencePort | Present | `MongoServiceCatalogRepository` candidate | PARTIAL | Replica-set tests cover nullable code uniqueness, name/code conflicts, counts, tenant scoping, updates, and lifecycle CAS | MySQL collation/null semantics and service error parity not verified / not ready |

**Totals:** 22 Prisma/MySQL ports present; 20 Mongo candidate port implementations; 2 ports without a full Mongo port adapter; 0 Mongo adapters registered; 0 ports approved for live activation. All twenty candidates are PARTIAL for activation readiness; none is classified COMPLETE.

Generic document CRUD is not counted as a port implementation. No production database was accessed or changed.

The current increment passed 19 additional contract tests on a disposable replica
set, alongside the existing 27 platform and 6 tenant Mongo tests. It does not
activate the candidates or remove remaining direct Prisma dependencies. See
`THANARAH_MONGODB_CONVERSION_PROGRESS.md` for the current acceptance boundary.
