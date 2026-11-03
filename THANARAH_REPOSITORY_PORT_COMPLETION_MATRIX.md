# Thanarah Repository-Port Completion Matrix

**Updated:** 2026-11-03  
**Decision:** No-go for migration or adapter activation.

The project defines 22 central persistence ports. Eight now have isolated MongoDB candidate implementations. None is registered in the application. Prisma/MySQL remains the only active persistence path. A passing Mongo integration test proves behavior against the disposable replica set only; it does not prove MySQL parity or migration readiness.

| Persistence port | Prisma/MySQL implementation | Mongo candidate | Disposable replica-set evidence | MySQL parity / activation |
|---|---|---|---|---|
| TenantPersistencePort | Present | `MongoTenantRepository` candidate | Replica-set tests cover create/read/list/status CAS, pagination, and lifecycle timestamps | Not verified; slug collation parity / not ready |
| TenantMembershipPersistencePort | Present | Generic document repository only; not a port adapter | Generic membership tests only | Not verified / not ready |
| TenantRolePersistencePort | Present | None | None | Not verified / not ready |
| TenantMembershipRolePersistencePort | Present | None | None | Not verified / not ready |
| FacilityPersistencePort | Present | Generic document repository only; not a port adapter | Generic CRUD tests only | Not verified / not ready |
| BranchPersistencePort | Present | Generic document repository only; not a port adapter | Generic CRUD tests only | Not verified / not ready |
| TenantEntitlementPersistencePort | Present | `MongoTenantEntitlementRepository` | Entitlement state and cross-collection snapshot test | Not verified / not ready |
| TenantQuotaPersistencePort | Present | `MongoTenantEntitlementRepository` | Active configuration and unavailable-state test | Not verified / not ready |
| SubscriptionPersistencePort | Present | None | None | Not verified / not ready |
| HealthcareCatalogPersistencePort | Present | None | None | Not verified / not ready |
| ServiceCatalogPersistencePort | Present | None | None | Not verified / not ready |
| TenantStaffPersistencePort | Present | None | None | Not verified / not ready |
| TenantStaffRolePersistencePort | Present | None | None | Not verified / not ready |
| TenantStaffScopePersistencePort | Present | None | None | Not verified / not ready |
| FacilitySchedulingPolicyPersistencePort | Present | None | None | Not verified / not ready |
| DoctorPersistencePort | Present | None | None | Not verified / not ready |
| PlatformUserPersistencePort | Present | `MongoPlatformUserRepository` | Concurrent failed-login increments, lockout, and reset test | Not verified / not ready |
| PlatformSessionPersistencePort | Present | `MongoPlatformSessionRepository` candidate | Replica-set tests cover user-referenced create, rotation/reuse, lifecycle lookup, activity, and revocation/status transitions; full method-by-method contract and race/failover evidence remains incomplete | Not verified / not ready |
| PlatformAuthorizationPersistencePort | Present | `MongoPlatformAuthorizationRepository` | Snapshot reads, references, failure handling, and stepdown recovery | Not verified / not ready |
| FeaturePersistencePort | Present | `MongoPlatformFeatureRepository` | Lookup, pagination, uniqueness, and conditional updates | Collation parity not verified / not ready |
| PlanPersistencePort | Present | `MongoPlatformPlanRepository` | Lifecycle and plan-feature operations | Collation parity not verified / not ready |
| PlatformAuditPersistencePort | Present | None | None | Not verified / not ready |

**Totals:** 22 Prisma/MySQL ports present; 8 Mongo candidate port implementations; 14 ports without a full Mongo port adapter; 0 Mongo adapters registered; 0 ports approved for migration.

Generic document CRUD is not counted as a port implementation. No production database was accessed or changed.
