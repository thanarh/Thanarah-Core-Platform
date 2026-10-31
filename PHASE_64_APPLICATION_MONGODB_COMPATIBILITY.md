# Phase 64 — Application MongoDB Compatibility

**Date:** 2026-10-31
**Result:** The official Node.js client and Patient MongoDB adapter passed the tested local replica-set cases; application transaction propagation and full repository compatibility are **not established**.
**Boundary:** Disposable synthetic data only. No production connection, MySQL migration, runtime behavior change, configuration change, or deployment.

## Runtime reviewed

- Application runtime: Node.js 22.23.4; official `mongodb` driver 7.7.0.
- Disposable server: MongoDB 7.0.17, three loopback-only members, replica set `rs0`.
- `TenantMongoClientManager` creates the official `MongoClient`, reuses it by the approved `primary` reference, caps manager clients at four, configures a pool maximum of 20, 5-second connect/server-selection timeouts, `retryWrites: true`, and disables command monitoring.
- The integration test used the manager's real `OfficialTenantMongoClientFactory` and its actual client object. It verified topology discovery, readiness, session-based commit/abort, and reconnection after a controlled stepdown.
- The manager's `TenantMongoClient` contract exposes `connect`, `db`, and `close`, but not `startSession`. No application-wide Mongo transaction/session propagation abstraction exists. The session tests therefore establish native driver capability through the configured client—not transaction support in the current repositories or request flows.

## Verified application-level behavior

| Capability | Result | Evidence |
|---|---|---|
| Managed client and shared readiness | **PASS** | Manager-connected official client pinged the disposable replica set and saw one primary and two healthy secondaries. |
| Native driver transaction commit/abort and session cleanup | **PASS, driver-level** | A session committed one synthetic write, aborted another, and both sessions ended. No repository transaction abstraction was exercised. |
| Actual tenant storage integration | **PASS, Patient adapter** | `MongoTenantPatientStorage` resolved the synthetic tenant target, provisioned its required indexes, created/read a synthetic Patient, and translated a duplicate patient-number key into the safe conflict result. |
| Controlled primary stepdown recovery | **PASS** | The manager's seed-list client found the replacement primary and completed a write afterward. |
| Failure mapping unit coverage | **PASS, unit-level only** | Existing manager tests verify sanitized connection failure handling and closing a failed client. They do not inject real timeout/topology failures into the application. |
| Appointment and Encounter adapters | **NOT RUN against MongoDB** | Their source was reviewed, but this Phase 64 integration did not invoke those adapters against the replica set. |
| The 13 SQL transaction-bearing repositories | **NOT IMPLEMENTED / NOT RUN** | They remain Prisma/MySQL repositories; no Mongo counterparts or repository-level compatibility tests exist. See `PHASE_64_REPOSITORY_TRANSACTION_MATRIX.md`. |

## Application configuration boundary

The test passed a credential-free URI for the loopback-only disposable replica set directly to `TenantMongoClientManager`. This exercised its real client options and lifecycle but bypassed production environment validation and did not test production TLS, credentials, provider connectivity, or connection policy. The disposable test members had no authentication, had test-command failpoints enabled, used synthetic data only, bound only to `127.0.0.1`, and published no ports. This is not a production configuration.

## Target MongoDB-only application contract

This is an architecture contract for a future design review, not implemented or owner-approved production configuration:

- **Platform/control plane:** use a distinct, long-lived platform MongoDB client and database boundary for users, sessions, memberships, authorization, subscriptions, audit, and registry metadata. The current platform repositories still use Prisma/MySQL; no platform MongoDB client is configured.
- **Tenant storage:** keep the current explicit registry/resolver boundary. Resolve an active physical database from trusted tenant context and an approved connection reference; do not accept database names or connection strings from request input. Keep logical tenant identity independent of physical database layout and keep tenant filters in document operations.
- **Client lifecycle and pools:** create clients lazily, reuse bounded clients per approved cluster/reference, retain bounded pool/connect/server-selection settings, and close every client during graceful application shutdown. Final limits and timeouts require topology/load validation.
- **Request context:** derive tenant identity from authenticated membership/authorization, propagate it through service/repository calls, and use it for both target resolution and tenant-scoped document predicates. Do not introduce automatic sharding or routing/rebalancing.
- **Health/readiness:** expose a neutral dependency-health result; readiness should ping shared configured services rather than enumerate every tenant target. Keep missing/unhealthy storage unavailable and avoid exposing URIs or raw driver errors.
- **Transactions:** pass an explicit session through every repository operation in an approved transaction boundary; commit/abort and end sessions in guaranteed cleanup paths. The current client-manager interface and repositories do not provide this MongoDB boundary.
- **Reconnect/retry:** allow the driver to rediscover replica-set members. Retry only operations with an approved idempotency/reconciliation rule; after uncertain acknowledgement, check operation status before any retry. `retryWrites` alone is not business-operation idempotency.
- **Configuration/security:** hold separate platform and tenant connection settings in secret management, validate TLS certificate/hostname checks and least-privilege roles, and never persist credentials in registry rows. Provider, URI policy, and final secret names remain owner decisions.

## Verification and decision

- Actual Phase 64 replica-set integration: **6/6 passed**.
- Focused existing storage-manager/readiness unit suites: **27/27 passed**.
- `npm run type-check`: **passed**.
- Focused ESLint and Prettier check: **passed**.
- Migration readiness remains **NO-GO**. This evidence proves a narrow driver/Patient-adapter path, not MySQL replacement, application transaction parity, production suitability, or safe retry of arbitrary business operations.
