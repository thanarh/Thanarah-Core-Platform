# Thanarah Repository-Port Completion Matrix

**Updated:** 2026-11-04
**Decision:** No-go for migration or adapter activation.

The project defines 22 central persistence ports. Sixteen now have isolated MongoDB candidate implementations. None is registered in the application. Prisma/MySQL remains the only active persistence path. A passing Mongo integration test proves behavior against the disposable replica set only; it does not prove MySQL parity or migration readiness.

| Persistence port | Prisma/MySQL implementation | Mongo candidate | Candidate classification | Disposable replica-set evidence | MySQL parity / activation |
|---|---|---|---|---|
| TenantPersistencePort | Present | `MongoTenantRepository` candidate | PARTIAL | Replica-set tests cover create/read/list/status CAS, pagination, and lifecycle timestamps | Not verified; slug collation parity / not ready |
| TenantMembershipPersistencePort | Present | `MongoTenantMembershipRepository` candidate | PARTIAL | Replica-set tests cover create/read/list/directory, active tenant lookup, lifecycle CAS, duplicate protection, and owner protection; status/assignment race proof remains incomplete | Not verified; transaction and owner-assignment parity / not ready |
| TenantRolePersistencePort | Present | `MongoTenantRoleRepository` candidate | PARTIAL | Replica-set tests cover role CRUD metadata, permission replacement, system-role protection, and transactional owner bootstrap | MySQL collation, cross-port coordination, and transaction/error parity unverified / not ready |
| TenantMembershipRolePersistencePort | Present | None | MISSING | None | Not verified / not ready |
| FacilityPersistencePort | Present | `MongoFacilityRepository` candidate; all port methods implemented | PARTIAL | Replica-set test covers reference rejection, tenant isolation, stable pagination, rename, and status CAS | MySQL parity and dependent transaction/reference race behavior not verified / not ready |
| BranchPersistencePort | Present | `MongoBranchRepository` candidate | PARTIAL | Replica-set tests cover active parent checks, tenant scoping, list/update, and lifecycle CAS | Parent status races and MySQL parity not verified / not ready |
| TenantEntitlementPersistencePort | Present | `MongoTenantEntitlementRepository` | PARTIAL | Entitlement state and cross-collection snapshot test | Not verified / not ready |
| TenantQuotaPersistencePort | Present | `MongoTenantEntitlementRepository` | PARTIAL | Active configuration and unavailable-state test | Not verified / not ready |
| SubscriptionPersistencePort | Present | `MongoSubscriptionRepository` candidate | PARTIAL | Replica-set tests cover overlap rejection, concurrent serialization, current lookup, and lifecycle transitions | Plan/tenant state races, isolation parity, uncertain commit, and MySQL semantics remain unverified / not ready |
| TenantStaffPersistencePort | Present | None | MISSING | None | Not verified / not ready |
| TenantStaffRolePersistencePort | Present | None | MISSING | None | Not verified / not ready |
| TenantStaffScopePersistencePort | Present | None | MISSING | None | Not verified / not ready |
| FacilitySchedulingPolicyPersistencePort | Present | None | MISSING | None | Not verified / not ready |
| DoctorPersistencePort | Present | None | MISSING | None | Not verified / not ready |
| PlatformUserPersistencePort | Present | `MongoPlatformUserRepository` | PARTIAL | Concurrent failed-login increments, lockout, and reset test | Not verified / not ready |
| PlatformSessionPersistencePort | Present | `MongoPlatformSessionRepository` candidate | PARTIAL | Replica-set tests cover user-referenced create, rotation/reuse, lifecycle lookup, activity, and revocation/status transitions; full method-by-method contract and race/failover evidence remains incomplete | Not verified / not ready |
| PlatformAuthorizationPersistencePort | Present | `MongoPlatformAuthorizationRepository` | PARTIAL | Snapshot reads, references, failure handling, and stepdown recovery | Not verified / not ready |
| FeaturePersistencePort | Present | `MongoPlatformFeatureRepository` | PARTIAL | Lookup, pagination, uniqueness, and conditional updates | Collation parity not verified / not ready |
| PlanPersistencePort | Present | `MongoPlatformPlanRepository` | PARTIAL | Lifecycle and plan-feature operations | Collation parity not verified / not ready |
| PlatformAuditPersistencePort | Present | `MongoPlatformAuditRepository` candidate | PARTIAL | Replica-set tests cover reference validation, idempotent audit lookup, security-event creation, and one-time resolution | MySQL/error semantics and event-delivery readiness not verified / not ready |
| HealthcareCatalogPersistencePort | Present | `MongoHealthcareCatalogRepository` candidate | PARTIAL | Replica-set tests cover both catalog kinds, unique names, tenant-active checks, tenant scoping, updates, and lifecycle CAS | MySQL collation and service/error parity not verified / not ready |
| ServiceCatalogPersistencePort | Present | `MongoServiceCatalogRepository` candidate | PARTIAL | Replica-set tests cover nullable code uniqueness, name/code conflicts, counts, tenant scoping, updates, and lifecycle CAS | MySQL collation/null semantics and service error parity not verified / not ready |

**Totals:** 22 Prisma/MySQL ports present; 16 Mongo candidate port implementations; 6 ports without a full Mongo port adapter; 0 Mongo adapters registered; 0 ports approved for migration. The sixteen candidates are PARTIAL for migration readiness; none is classified COMPLETE.

Generic document CRUD is not counted as a port implementation. No production database was accessed or changed.
