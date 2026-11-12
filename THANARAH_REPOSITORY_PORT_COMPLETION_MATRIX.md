# Thanarah Repository-Port Completion Matrix

**Updated:** 2026-11-13
**Decision:** MongoDB-only conversion is the approved product target and is in progress. Live adapter activation is still gated on complete workflow evidence.

The project defines 22 central persistence ports. Twenty now have isolated MongoDB candidate implementations. None is registered in the application. Prisma/MySQL remains the current central runtime path, not the desired architecture. A passing Mongo integration test proves the tested behavior against the disposable replica set only; it does not by itself prove application-wide conversion or production readiness.

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
