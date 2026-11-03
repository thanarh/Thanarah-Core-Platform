# Thanarah MongoDB Adapter Matrix

**Updated:** 2026-11-03  
**Test topology:** Disposable three-member MongoDB 7.0.17 replica set on loopback; synthetic database and fixtures only.

| Port(s) | Candidate implementation | Transaction / atomicity approach | Verified locally | Remaining gate |
|---|---|---|---|---|
| PlatformAuthorizationPersistencePort | `MongoPlatformAuthorizationRepository` | Snapshot transaction and one shared session for cross-collection reads | Yes: role, permission, missing/malformed references, concurrent revocation snapshot, sanitized failure, primary stepdown | No cross-adapter MySQL differential; code/value parity and lifecycle behavior remain unapproved |
| TenantPersistencePort | `MongoTenantRepository` | Atomic status compare-and-set; pre-provisioned unique slug and listing indexes | Yes: create, reads, filtered stable pagination, duplicate index, lifecycle status transitions in disposable replica set | Slug collation and MySQL differential behavior are not proven; candidate remains unregistered |
| FeaturePersistencePort | `MongoPlatformFeatureRepository` | Atomic expected-status updates | Yes: reads, ordering, case-insensitive lookup, uniqueness, update and status compare-and-set | `en` strength-1 collation is not proven equivalent to MySQL `utf8mb4_unicode_ci`; service error mapping also needs review |
| PlanPersistencePort | `MongoPlatformPlanRepository` | Snapshot transactions for relation reads/writes; unique pair index for attachment | Yes: plan lifecycle, relation reads, attach/configure/detach, duplicate handling | Plan-key collation parity, JSON/SQL-null semantics, and service error mapping are not proven |
| TenantEntitlementPersistencePort | `MongoTenantEntitlementRepository` | Snapshot transaction across plan, feature, and association reads | Yes: plan/feature missing, missing/disabled association, entitled and inactive-feature outcomes | No MySQL differential across case/accent behavior or concurrent lifecycle changes |
| TenantQuotaPersistencePort | `MongoTenantEntitlementRepository` | Snapshot transaction across association, plan, and feature | Yes: enabled active configuration and unavailable states | No MySQL differential; quota JSON-vs-SQL-null representation still needs explicit parity evidence |
| PlatformUserPersistencePort | `MongoPlatformUserRepository` | Single-document atomic update pipeline for failed-login increment and lockout | Yes: concurrent increments, lockout, reset, and case-insensitive lookup | No MySQL differential for lock timing/threshold races; email collation differs potentially; service error mapping is not approved |
| PlatformSessionPersistencePort | `MongoPlatformSessionRepository` | Mongo transaction for user-reference validation, token-history insertion, session rotation, and reuse compromise | Yes: user-referenced create, rotation, simultaneous same-token rotation/replay, lifecycle lookup and transitions on the disposable replica set | Transaction retry/uncertain commit, session-specific failover, and MySQL behavior are not proven |

All eight candidates remain unregistered. Other generic document repositories do not implement their corresponding persistence ports. The Mongo indexes use case/accent-insensitive collation for some keys and emails, but that choice is not evidence of equivalence to the source MySQL collation.
