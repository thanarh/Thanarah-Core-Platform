# Phase 60 — MongoDB Infrastructure Readiness Assessment

**Status:** Assessment only; production migration not authorized
**Date:** 2026-10-28
**Scope:** Required MongoDB capabilities, possible deployment categories, current repository/workspace evidence, and minimum isolated test environment.

## 1. Executive finding

**Migration readiness is not established.** The current code has a MongoDB tenant-data adapter, but central platform persistence still uses Prisma/MySQL. Thirteen repositories contain SQL transactions or row-locking workflows. The repository’s MongoDB integration fixture is a disposable **standalone** `mongo:7.0.17` container; it does not test multi-document transactions, replica-set elections, majority acknowledgement under node loss, or the approved production topology.

At assessment time, no local `mongod` process or running container was found in the workspace. The `ss` utility was unavailable, so local port-listener inspection could not be completed. No remote Mongo endpoint was probed. The currently running application workflow is a NestJS application, not a dedicated MongoDB service. The existing test fixture could create a new disposable container, but Phase 60 specifically limits testing to an environment already available; therefore it was not started.

Consequently:

- Capability requirements can be classified from current repository behavior.
- Theoretical deployment options can be compared without selecting one.
- No MongoDB capability test was performed in this phase.
- A topology-matched isolated verification environment must be owner-approved and made available before technical feasibility can be confirmed.
- No provider, topology, data residency, compliance status, recovery objective, or production migration readiness is approved.

## 2. Repository and workspace evidence

- `prisma/schema.prisma` currently declares MySQL and contains 36 models and 21 enums; `prisma/migrations/` contains 29 migration directories.
- Central SQL remains the runtime store for platform identity/authentication, sessions, authorization, tenant/control-plane data, catalogs, subscriptions, storage registry, audit/security records, and encounter operation ledger.
- Existing tenant MongoDB collections are `patients`, `appointments`, `encounters`, and `appointment_schedule_locks`.
- `TenantMongoClientManager` enables `retryWrites: true`, but application configuration does not explicitly establish a production write concern, replica-set identity, server version, or transaction guarantee. Retryable writes are not equivalent to a multi-document transaction or a backup.
- Production environment validation requires the tenant MongoDB URI to use TLS with certificate and hostname validation. This verifies a configuration rule only; it does not establish that a production connection or provider exists.
- The current test fixture starts MongoDB 7.0.17 using `mongod --setParameter enableTestCommands=1`; it does not configure replica-set initialization. It is a test-only standalone topology and also starts a MySQL 8.0.41 container.
- Package configuration lists MongoDB Node driver `^7.7.0`; driver version does not establish a server compatibility or support policy.
- The checked-in recovery artifact describes a disposable MySQL/Mongo restore exercise. It does not establish production backup automation, retention, RPO/RTO, or a topology-matched restore result.
- No production database, remote endpoint, credentials, secrets, or provider account were accessed.

## 3. Capability classification

| Capability | Current application behavior | MongoDB requirement / evidence needed |
|---|---|---|
| Single-document atomic operations | Patient and encounter updates use tenant-scoped document operations; appointments use versioned updates; security-event resolution and failed-login increments have single-record semantics. | Atomic conditional update by `_id` plus tenant/version/status predicates; test lost-update, retry, and ambiguous acknowledgement cases. This capability is available on standalone MongoDB, but that does not provide production durability or availability. |
| Unique indexes and race control | Patient storage depends on unique tenant+patient-number and three partial duplicate indexes; other SQL tables have compound unique constraints. Appointment locks use a unique tenant/resource key. | Create exact ordered index definitions before writes; confirm nullable-field partial filters and collations; test simultaneous insert/update races. Sharded unique-index compatibility must be explicitly proven. |
| Multi-document transactions | Refresh-token rotation/history, membership/role/owner, staff/facility/branch/doctor assignments, policy revisions, subscriptions, and storage primary switches use SQL transactions and/or row locks. | If retained as separate documents with atomic commit, MongoDB transactions require a replica set or supported sharded cluster. Standalone is insufficient. A redesigned single-document protocol or outbox/saga may avoid some transactions, but requires separate proof and tests. |
| Concurrency control | SQL transactions use conditional status/version checks, unique keys, and `SELECT ... FOR UPDATE`. | Preserve uniqueness plus parent/actor eligibility under races. A “read, check, then write” sequence without transaction, unique index, compare-and-set, or lease can admit invalid concurrent state. |
| Majority write acknowledgement | Tenant Mongo manager sets retryable writes but does not set a documented application write-concern policy. | Decide per-data-class acknowledgement. A replica-set majority policy should be evaluated for auth/session, clinical, audit/operation-ledger and registry state; measure latency and prove failover behavior. Current repository evidence does not verify it. |
| Replica-set functionality | No application-level replica-set requirement or current fixture evidence. | Required for native multi-document transactions. Failover, elections, retry behavior, and acknowledgement survival need a replica-set test. One-member replica sets can test transaction API use but do not test meaningful node-loss resilience. |
| Sharding | No application-managed sharding or multi-target fan-out; patient duplicate indexes use non-simple collation. | Not required by observed scale evidence. If considered, approve shard key and prove all tenant and unique-index guarantees; current patient indexes do not establish shard-wide uniqueness on a sharded collection. |
| Recovery and reconciliation | Clinical encounter operation ledger and audit delivery already use explicit PREPARED/CONFIRMED/NOT_APPLIED/AMBIGUOUS and retry/review states. Existing recovery material is disposable. | Preserve durable idempotency, operation evidence, audit replay, independent backup, restore verification, and owner-defined RPO/RTO. Multi-cluster writes require an outbox/saga or another explicit consistency design. |
| Retryable writes | `retryWrites: true` is present in the current tenant Mongo client options. | Verify compatibility on the selected topology and server version. Every retried mutation must be idempotent or guarded by an operation key/version. This setting is not evidence of an end-to-end retry guarantee. |

## 4. Deployment categories and consequences

| Category | Availability / transactions | Security, network, residency | Backup / monitoring | Capacity / cost / operations |
|---|---|---|---|---|
| Self-managed MongoDB replica set | Supports multi-document transactions when configured on a compatible version. Availability depends on member count, placement and correct election settings. | Full control over TLS, firewall/private networking, users and region placement; all controls and audit evidence are owner-managed. | Owner must design independent backup, restore, monitoring, alerting, upgrades, failover and drills. Replication is not backup. | Flexible capacity, but host/storage/network plus engineering/on-call cost is material. |
| Managed MongoDB service | Replica-set and transaction support may be available; exact limits, failover and write concern depend on service/tier and must be verified. | Confirm provider/region, TLS validation, private connectivity/IP allowlists, least-privilege access, data residency, contract and healthcare terms. | Service backup, restore granularity, retention, monitoring and export behavior vary by tier and contract; restore must be tested. | Lower infrastructure operations burden, recurring compute/storage/backup/network/support costs. Capacity and service limits must be modeled from production inventory. |
| Existing application hosting | Could run the app against a separately operated MongoDB endpoint only if networking, TLS, authentication, routing and performance requirements are met. The repository does not establish that the current hosting environment can safely operate a replica set. | Verify outbound/inbound network rules, private connectivity, certificate handling, secrets, allowed regions and least privilege. | No MongoDB backup/monitoring capability is evidenced by the current Nest application workflow. Must be supplied and owned separately. | May avoid a second app deployment but does not remove database hosting/operations cost. Do not assume cPanel or Replit app hosting can operate MongoDB safely. |

No exact prices are quoted: provider, region, workload, redundancy, storage, backup retention, data transfer and support tier are undecided. Obtain current written estimates after production sizing and contractual review. This assessment does not select a provider or topology.

## 5. Minimum isolated environment before further testing

Do not install or provision infrastructure as part of this assessment. Before Phase 60 capability tests proceed, an owner must make an isolated environment available with:

1. A MongoDB server version and Node driver version approved for the proposed production profile.
2. A replica set initialized for transaction tests; no production data, credentials, routes or network access.
3. A multi-member replica-set profile (minimum three voting members across isolated failure domains) for majority acknowledgement, election, failover and node-loss tests. A single-member replica set can be used only for transaction syntax/atomicity tests, not availability claims.
4. TLS enabled with certificate and hostname verification; isolated test credentials with least-privilege roles; no reused production secrets.
5. Network restrictions limited to the isolated test clients and required test services.
6. A MongoDB backup/restore utility compatible with that server version, isolated storage for encrypted test backups, and permission to restore into a clean test target.
7. Monitoring sufficient to observe replica state, elections, connections, write concern results, transaction aborts, index builds, disk use and restore status.
8. Synthetic fixture data for all conflict/concurrency cases, including tenant-scoped indexes, refresh token rotation, assignment races, schedule locks, subscriptions and encounter reconciliation.

The environment should be disposable and explicitly separated from production. Do not run test commands that auto-start containers until that environment is approved and the task explicitly permits provisioning it.

## 6. Operational prerequisites

- **Connection/authentication:** use approved secret references; separate application, operator, migration and backup identities; rotate credentials; avoid URI values in logs. Define connection pool limits, server-selection timeout, connect timeout, socket timeout and shutdown behavior from measured load.
- **TLS/network:** enforce certificate and hostname validation; restrict inbound/outbound access; document private endpoint or allowlist; test certificate rotation and connection failure.
- **Least privilege:** grant only required database and collection actions. Separate runtime writes from index provisioning and backup/restore privileges. Audit privileged operator actions.
- **Index management:** operator-controlled provisioning; exact ordered-key and option verification; conflict scan before unique index; fail-closed target activation; no index DDL during ordinary application startup.
- **Monitoring/alerts:** replica health and lag, election/failover, majority write errors, transaction aborts, connection pool saturation, slow queries, index build state, disk/storage, backup age/failure, restore verification and application-level reconciliation backlog.
- **Backups:** independent encrypted backup, approved retention, off-cluster protection, restore procedure and recurring isolated restore drills. Replication and a successful dump do not by themselves prove recoverability.
- **Recovery objectives:** owners must set RPO/RTO, data-loss authority, incident roles, communications, restore order, point-in-time coordination for platform and tenant data, and post-restore reconciliation.

## 7. Readiness decision

**Status: NOT READY FOR MIGRATION IMPLEMENTATION OR PRODUCTION CUTOVER.**

Blocking evidence includes no approved provider/topology/version/region; no current isolated replica-set environment; no transaction/failover/majority-acknowledgement/backup-restore tests; no approved data residency/compliance review; no production-sized capacity model; and no approved backup, RPO/RTO, write-freeze, or operational ownership.

The next safe action is an owner decision on the deployment profile and authorization for an isolated, topology-matched test environment. No production access or infrastructure provisioning is implied.

