# Thanarah — Tenant MongoDB Deployment Decision

**Status:** PENDING APPROVAL  
**Date:** 2026-10-10  
**Scope:** Tenant MongoDB deployment assumptions required to assess Phase 33 Patient duplicate protection.

## Decision summary

The repository does not establish an approved MongoDB provider, production server version, production topology, transaction guarantee, or shard-key pattern. The Phase 30 real-Mongo integration setup exercises a standalone `mongo:7.0.17` container only; that test setup is not production approval.

The current runtime maps registered tenant databases through one `primary` connection reference and one configured MongoDB URI. It resolves one active primary target per Patient operation. This is an application-level storage-routing design; it does not establish whether the backing MongoDB server is standalone, a replica set, or a sharded cluster.

Phase 33's three Patient duplicate indexes are unique, partial compound indexes using `{ locale: 'en', strength: 2 }`. They can provide the intended constraint on an unsharded Patient collection when index creation succeeds. MongoDB documents that a unique index on a sharded collection must include the shard key as a prefix and that a non-simple index collation cannot ensure uniqueness. The current definitions therefore do not establish shard-wide duplicate protection for a sharded Patient collection.

**Phase 33 remains blocked from a production-safety claim pending the decisions and release gates below.** This document records evidence and proposals; it does not approve a provider, topology, shard key, or transaction model.

## Explicitly documented and implemented facts

### Tenant storage and routing

- Central platform data is stored in MySQL/MariaDB; tenant Patient persistence uses the official MongoDB driver. The central Patient Prisma model remains legacy schema and is not the runtime Patient repository. (`README.md:47–74`)
- Registry targets identify a provider, connection-reference alias, database name, status, and primary flag. They do not record a MongoDB server version, topology, cluster identity, or shard key. (`prisma/schema.prisma:589–604`)
- The current Mongo client manager accepts only the `primary` connection reference and resolves it from the single configured `TENANT_STORAGE_MONGO_URI`. A client is shared across tenant databases on the same physical cluster. (`replit.md:50–53`; `src/tenant/tenant-mongo-client.manager.ts:32–60,77–108`)
- The application resolves one active primary target per operation and does not route or shard data across registered targets. That statement describes application-level placement; it is not evidence that a MongoDB collection is unsharded. (`README.md:57–67`; `replit.md:25–38`)
- Tenant databases are manually provisioned. The application does not provision production MongoDB databases or move Patient records. Clients cannot select physical database names or connection strings. (`README.md:52–74`; `replit.md:43–48`)
- The historical migration report says concrete tenant MongoDB providers had not been approved at that time. Current configuration names the MongoDB driver and URI secret, not a hosting provider. (`MIGRATION_IMPACT_REPORT.md:419–445`; `.env.example:10–15`)

### Test-only assumptions

- The real-Mongo test starts one `mongo:7.0.17` container without replica-set initialization or sharding configuration. It therefore exercises a standalone server. (`test/phase30-patient.integration.spec.ts:59–66,122–159`)
- The integration suite includes the Phase 32/33 duplicate checks and a fail-closed test that drops a required duplicate index, expects HTTP 503, and verifies no Patient was inserted. (`test/phase30-patient.integration.spec.ts:792–972,1291–1321`)
- The package's `mongodb` dependency is the Node.js driver version range `^7.7.0`; this does not establish a supported production server version. (`package.json:43`)

## Topology assessment

| Topology | Application and test evidence | Production status |
|---|---|---|
| Standalone | The integration test uses a standalone MongoDB 7.0.17 container. The current adapter connects through a configured URI and does not require application-level cross-target routing. | **Tested only; not approved for production.** |
| Replica set | No replica-set test setup or approved deployment statement was found. Driver connectability is not evidence of application validation or production approval. | **Unresolved; not approved.** |
| Sharded cluster | No sharded test setup or approved deployment statement was found. “Does not shard across targets” concerns the application registry, not MongoDB server-side sharding. The current collated unique indexes do not establish shard-wide uniqueness for a sharded Patient collection. | **Unresolved and incompatible with the current guaranteed-uniqueness claim for sharded Patient collections.** |

No exact shard key is documented. `_tenantId` being the first field in the compound indexes is an index definition, not evidence that `_tenantId` is the shard key.

## Phase 33 duplicate protection

### Rules and index definitions

The implementation treats these as possible duplicates within a tenant:

1. Same normalized first, middle, and last name, with the same non-null phone.
2. Same normalized first, middle, and last name, with the same non-null email.
3. Same normalized first and last name, with the same non-null date of birth; middle name is not part of this rule.

Name comparisons use the English strength-2 collation. Values are also normalized before comparison; phone punctuation and a leading plus sign remain significant. (`src/tenant/patient-duplicate.ts:13–40,43–63`)

The three index definitions in `src/tenant/mongo-tenant-patient.storage.ts:37–58,333–341` are:

| Rule | Ordered index key | Partial filter |
|---|---|---|
| Name + phone | `_tenantId, firstName, middleName, lastName, phone` | `phone` is a string |
| Name + email | `_tenantId, firstName, middleName, lastName, email` | `email` is a string |
| Name + date of birth | `_tenantId, lastName, firstName, dateOfBirth` | `dateOfBirth` is a date |

Each is unique and uses `{ locale: 'en', strength: 2 }`. The partial filters limit each uniqueness rule to records with the relevant value, consistent with MongoDB's [unique partial-index behavior](https://www.mongodb.com/docs/v7.0/core/index-unique/#unique-partial-indexes).

### MongoDB compatibility

MongoDB's [v7.0 unique-index documentation](https://www.mongodb.com/docs/v7.0/core/index-unique/#sharded-clusters-and-unique-indexes) requires a unique index on a ranged sharded collection to be the shard-key index or a compound index with the shard-key pattern as its prefix. It further states that uniqueness with an index collation can only be ensured when that collation is simple.

The current three indexes use a non-simple English strength-2 collation. Therefore:

- On an **unsharded Patient collection**, these index definitions can enforce the intended MongoDB unique constraints after successful provisioning, subject to there being no conflicting existing records.
- On a **sharded Patient collection**, they do not establish the documented shard-wide uniqueness guarantee. The exact shard key is also unknown, so prefix compatibility cannot be assessed. Even a matching `_tenantId` prefix would not remove the non-simple-collation limitation.
- An unsharded Patient collection hosted in a sharded deployment is distinct from a sharded Patient collection; the repository does not document which deployment is intended.

The runtime readiness check verifies index names, key order, uniqueness, partial filters, and expected collation (`src/tenant/mongo-tenant-patient.storage.ts:404–445`). It does not inspect the collection's sharding state or shard key; index metadata alone cannot certify shard-wide uniqueness.

## Transactions and atomicity

No production MongoDB transaction guarantee is documented. The Patient storage code relies on MongoDB unique indexes for duplicate-race enforcement and does not use MongoDB sessions or multi-document transactions. `retryWrites: true` is a driver option, not evidence of a transaction guarantee. The Prisma transaction in `src/tenant/tenant-storage.registry.ts:120–148` protects central registry metadata, not Patient writes.

The standalone integration test demonstrates concurrent behavior only on its test topology. It must not be used to infer production transaction support.

## Tenant activation and index readiness

The operational requirement is: **a tenant storage target must not become available for Patient writes until all required indexes have been provisioned and verified on that target.**

`MongoTenantPatientStorage.ensureIndexesForTarget` creates the Patient-number and list indexes, creates the three duplicate indexes, lists indexes to verify their expected definitions, and only then drops legacy duplicate-index names. (`src/tenant/mongo-tenant-patient.storage.ts:317–353`) Patient writes check required indexes and fail closed when they are missing or mismatched; the integration test verifies the HTTP 503/no-insert behavior for a missing duplicate index. (`src/tenant/mongo-tenant-patient.storage.ts:355–367`; `test/phase30-patient.integration.spec.ts:1291–1321`)

The documented operator sequence says to run index provisioning before activation. (`replit.md:54–59`) However, `TenantStorageRegistryService.setTargetStatus` checks for another active primary target but does not call or verify MongoDB index provisioning. (`src/tenant/tenant-storage.registry.ts:111–148`) Thus, the ordering requirement is not enforced by the activation method. Making activation enforce readiness is a follow-up implementation decision, outside this documentation-only phase.

## Existing data conflicts

Creating a unique index can fail if existing Patient documents violate its constraint; see MongoDB's [unique-index restrictions](https://www.mongodb.com/docs/v7.0/core/index-unique/). The provisioning method maps failures to storage unavailable and only drops legacy duplicate indexes after successful index verification. It does not merge or delete patient records. Conflicts must be handled through a separately approved data process, and the target must remain unavailable until provisioning and verification succeed.

## Proposed decisions requiring approval

These are proposals, not approved deployment facts:

1. Either approve unsharded Patient collections as the only topology for the current Phase 33 collation-based indexes, or require a redesigned and tested duplicate-key strategy before allowing sharded Patient collections. Do not weaken the current case-insensitive rules or replace the database-enforced guarantee with application-only checks without an explicit decision.
2. Approve and document the MongoDB provider, supported server version, production topology, and whether Patient collections may be sharded.
3. If Patient collections may be sharded, approve the exact ordered shard-key pattern and demonstrate compatibility of every required unique index; the current non-simple collations remain a blocker.
4. Require and later implement an activation gate that prevents Patient writes until index provisioning and verification have succeeded.
5. Add non-production integration coverage for the approved deployment characteristics before making a production-safety claim.

## Decision table

| Decision | Current documented status | Evidence | Required approval or follow-up |
|---|---|---|---|
| MongoDB provider | **UNRESOLVED** | Runtime uses an official driver and a URI secret; no provider is named. Historical report says providers had not been approved. (`README.md:52–56`; `MIGRATION_IMPACT_REPORT.md:419–445`) | Infrastructure owner selects and records a provider. |
| Supported server version | **UNRESOLVED** | Driver dependency is `^7.7.0`; test image is `mongo:7.0.17`. Neither establishes the production server range. (`package.json:43`; `test/phase30-patient.integration.spec.ts:59–61`) | Approve a server version/range and test it. |
| Production topology | **PENDING APPROVAL** | Standalone only in integration tests; no replica-set or sharded deployment is documented. | Approve standalone, replica set, or sharded topology and validate it outside production. |
| Tenant database placement | **One configured `primary` URI in the current runtime model; actual production cluster arrangement unresolved** | All registered targets resolve through the same URI/connection reference; target records contain database names. (`replit.md:50–53`; `src/tenant/tenant-mongo-client.manager.ts:32–60`; `prisma/schema.prisma:589–604`) | Confirm whether production uses this shared-cluster model; separate per-target clusters are not represented by the current alias mapping. |
| Shard key | **UNRESOLVED; none documented** | No shard-key field exists in target metadata or deployment instructions. `_tenantId` is only an index field. | If Patient collections may be sharded, approve the exact ordered key and verify every unique index. |
| Production transaction guarantee | **UNRESOLVED** | No Mongo transaction guarantee or Mongo session usage is documented. Central Prisma transactions are for registry metadata. | Record any required guarantee based on approved deployment evidence; do not infer from the driver or standalone tests. |
| Phase 33 index compatibility | **Conditional for unsharded collections; not established for sharded Patient collections** | Three unique partial indexes use non-simple collation; MongoDB documents the sharded uniqueness restrictions. | Approve unsharded-only use or require a compatible redesign and topology-specific tests. |
| Index-ready activation | **Required operationally; not enforced by `setTargetStatus`** | Operator sequence is documented, but the status method does not verify indexes. (`replit.md:54–59`; `src/tenant/tenant-storage.registry.ts:111–148`) | Implement enforcement in a later phase before production activation. |
| Existing duplicate data | **No automatic merge or deletion** | Unique-index creation may fail; provisioning catches failure and drops legacy indexes only after successful verification. (`src/tenant/mongo-tenant-patient.storage.ts:317–353`) | Resolve conflicts only through an approved data process before activation. |

## Release gate and recommended next action

Phase 33 remains blocked from a production-safety claim until:

1. The provider, supported server version, and production topology are approved and documented.
2. The Patient collection's sharded or unsharded status is explicit; if sharded, the exact shard key is approved and the duplicate-index strategy is proven compatible.
3. Activation is prevented until the required indexes are provisioned and verified on the target.
4. Non-production tests validate the approved deployment characteristics and concurrent duplicate behavior.

**Recommended next action:** obtain the infrastructure owner's written decision on provider, server version, topology, and whether Patient collections may be sharded. Then validate or redesign the Phase 33 indexes against that decision and schedule activation-gate implementation separately. Do not access production or choose a topology by assumption.

## Free Cluster Rotation and Read-Only Archive Feasibility

**Candidate assessed:** MongoDB Atlas Free clusters (formerly M0). Assessing a provider candidate does not select Atlas for Thanarah. The deployment decision remains **PENDING APPROVAL**. Public sources were checked on **2026-10-10 (Asia/Riyadh)**; no Atlas account, project, contract, cluster, or production system was inspected.

### Verified Atlas facts

| Area | Current documented fact | Architectural implication |
|---|---|---|
| Topology and version | Atlas Free clusters use MongoDB 8.0, have a fixed three-node replication factor, cannot be configured as sharded clusters, and do not allow customers to select or manually upgrade the server version. Atlas performs version upgrades. ([Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)) | A Free cluster is an unsharded replica-set candidate, not the standalone topology used in Phase 30 tests. Test Phase 33 on the provider's current server version before relying on it. |
| Storage and namespaces | A Free cluster is limited to 0.5 GB of uncompressed BSON data plus associated index bytes; storage cannot be increased or auto-expanded. It supports at most 100 databases and 500 collections total. Database names are limited to 38 bytes and namespaces to 95 bytes. ([Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)) | The cap includes the Phase 33 indexes. The application currently accepts database names up to 63 ASCII characters (`src/tenant/tenant-mongo.constants.ts:1–7`), so names of 39–63 bytes accepted by the app would not fit this Atlas tier. A database-per-tenant design also reaches the 100-database cap. |
| Throughput and monitoring | Free clusters allow at most 500 connections, 100 read/write operations per second, and 10 GB in plus 10 GB out per rolling seven-day period. Atlas throttles operations and network traffic, with per-connection cooldowns and queues that may wait longer than one second. Metrics and alert conditions are limited to Connections, Logical Size, Network, and Opscounter; the limit is 100 configured alerts per project and organization and five notifications per notification method on each alert. Storage does not auto-expand. ([Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)) | These are hard planning constraints, not an application-managed capacity pool. The repository has no documented Atlas-capacity monitor, automatic provisioning, or limit-aware admission control. |
| Cluster and project counts | Atlas permits one Free cluster per project. Its documentation notes that a sales contract might permit more per project. Atlas Service Limits lists 250 projects per Atlas user and 250 per organization; the actual account's available project capacity is unknown. ([Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/); [Atlas Service Limits](https://www.mongodb.com/docs/atlas/reference/atlas-limits/)) | A second simultaneous Free cluster normally requires another project. These are finite project limits, not evidence that Thanarah's account can create the projects or that repeated rotation is authorized. |
| Provisioning API | Atlas documents that the Clusters API can create a Free cluster but cannot modify one. ([Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)) | This does not provide an implemented or fully automatable rotation mechanism; account/project eligibility and deployment configuration still require approval. |
| Backup and recovery | Atlas-managed backups are unavailable for Free clusters. Atlas documents `mongodump` and `mongorestore` as manual backup/restore alternatives; Free clusters restrict those tools from accessing the `admin` database. ([Back Up, Restore, and Archive Data](https://www.mongodb.com/docs/atlas/backup-restore-cluster/); [Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)) | Replication across three nodes is not a backup. A separate, protected backup and tested restore process are prerequisites for retaining patient data. |
| Idle and archived clusters | Atlas automatically pauses Free clusters after 30 days with zero connections and may deactivate idle Free clusters under its Terms of Service. A paused cluster might not resume if its server version is older than the latest release; the documented recovery procedure requires a temporary M10 cluster running the same version, and may be unavailable if that version is end-of-life. ([Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/); [Restore Data From Paused Free Cluster](https://www.mongodb.com/docs/atlas/backup/restore-free-tier-cluster/)) | A Free cluster cannot be treated as a guaranteed always-online or indefinite archive. Recovery can require a paid cluster and version-specific steps. |
| Security and service controls | Free clusters do not provide Atlas backups, database auditing, customer-key-management encryption at rest, private endpoints, database access history, failover testing, or regional outage testing. ([Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)) | These limitations require security, resilience, data-residency, and healthcare compliance review; this audit makes no compliance certification. |

MongoDB's Cloud Terms additionally state that protected health information must not be stored or processed unless a Business Associate Agreement (BAA) is signed. The Terms prohibit use intended to avoid fees or exceed usage limits or quotas, and state that MongoDB has no obligation to retain data in a terminated Atlas cluster or after termination of the agreement. ([MongoDB Cloud Terms](https://www.mongodb.com/legal/terms-and-conditions/cloud)) No signed BAA, account agreement, or provider authorization for this rotation model is evidenced in the repository.

### Feasibility assessment

| Requirement | Assessment | Finding |
|---|---|---|
| One Free cluster for a development experiment | **SUPPORTED WITH LIMITS** | Atlas documents Free cluster creation, but the experiment should use synthetic, non-PHI data and respect the storage, database, collection, version, and throughput limits. |
| A second Free cluster in the same project while retaining the first | **UNSUPPORTED BY DEFAULT** | Atlas allows one Free cluster per project, subject to a possible sales-contract exception. |
| Multiple clusters in an actual Thanarah Atlas account | **UNVERIFIED** | The project/user/organization ceilings are documented, but the account structure, remaining project quota, region availability, and any contract exceptions are unknown and were not inspected. |
| Repeated Free-cluster rotation to avoid a paid tier or Free-tier quotas | **UNSUPPORTED AS PROPOSED** | The described capacity-triggered rotation appears intended to avoid fees or usage quotas. MongoDB's Cloud Terms prohibit that use. Obtain written provider approval for any materially different, legitimate migration; do not use project/account rotation to evade limits. |
| Manual migration between Free clusters | **SUPPORTED AS A MANUAL TOOLING PATH; CONSISTENCY IS CONDITIONAL** | Atlas documents `mongodump`/`mongorestore`. They do not provide ongoing replication by themselves; a source write freeze is required for a controlled final copy. The `admin` database is unavailable to these tools on Free clusters. |
| Live migration with `mongosync` | **UNSUPPORTED FOR SHARED TIERS** | MongoDB's [`mongosync` limitations](https://www.mongodb.com/docs/mongosync/current/reference/limitations/) say MongoDB Shared Tier is unsupported. Atlas's general live-migration documentation does not establish M0-to-M0 eligibility, so that path is **UNVERIFIED** and must not be used to promise zero downtime. ([Migrate or Import Data](https://www.mongodb.com/docs/atlas/import/)) |
| Read-only access while an archive cluster is active | **SUPPORTED IN PRINCIPLE, SUBJECT TO ROLE CONFIGURATION** | Atlas database users use role-based privileges and can be restricted to specific clusters. A read-only role can limit database access, but the existing Thanarah Patient route has no archive/read-only mode. ([Configure Database Users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/); [MongoDB Built-In Roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/)) |
| Indefinite, continuously available Free-cluster archive | **UNSUPPORTED AS A GUARANTEED RETENTION DESIGN** | Free clusters auto-pause after 30 days without connections, may be deactivated under the Terms, have no managed backups, and can become impossible to resume on their old version. |
| Phase 33 indexes on an Atlas Free collection | **COMPATIBLE IN PRINCIPLE; NOT YET VERIFIED ON ATLAS FREE** | Free clusters cannot be sharded, so the prior shard-wide unique-collation restriction does not apply to an unsharded `patients` collection. However, the current integration test uses MongoDB 7.0.17, while Atlas Free currently runs MongoDB 8.0. Re-run index creation and concurrency tests against the approved destination version before a safety claim. |
| Per-tenant cluster rotation and archive routing in current Thanarah code | **UNSUPPORTED BY THE CURRENT ROUTING MODEL** | `TenantMongoClientManager` accepts only `connectionReference === 'primary'` and uses the single `TENANT_STORAGE_MONGO_URI` (`src/tenant/tenant-mongo-client.manager.ts:46–60`). Target status is only `ACTIVE` or `INACTIVE` (`prisma/schema.prisma:57–60`); targets have no archive access mode. A global URI change would redirect all registered database names, not route one tenant to a new cluster while leaving its old cluster archived. |
| Free-tier suitability for live healthcare records | **UNVERIFIED; DO NOT USE WITHOUT A SIGNED BAA AND APPROVAL** | The Cloud Terms expressly require a signed BAA before processing PHI. No BAA, region/data-residency approval, backup plan, or security approval is present in the repository. |

The rotation idea as written is not an approved or implemented architecture. In particular, a cluster's database names, capacity, and indexes do not establish a cluster identity in the current registry. The one `primary` alias maps every registered target through the same configured URI; the current schema permits database names up to 63 bytes, while Atlas Free limits them to 38 bytes.

### Proposed lifecycle and migration sequence

The following sequence is **proposed only** for a provider-approved migration that does not evade Free-tier quotas. It is not an implementation plan for Phase 33B and is not approval to migrate real patient data:

1. Obtain written approval for provider/plan terms, BAA and security controls, source and destination regions, server version, project quota, retention requirements, and an owner-approved capacity trigger with sufficient migration headroom. Do not wait for the hard storage limit.
2. Provision an eligible destination only through an approved process. Verify its region, MongoDB version, available storage/connection capacity, database-name limits, access controls, and the provider's permitted use. If a Free destination would only exist to evade fees or quotas, stop and select an approved paid tier or provider instead.
3. Produce and validate an independent backup before changing routing. On Free clusters, the documented manual path is `mongodump`/`mongorestore`; provision database users and roles separately, and do not assume Atlas managed backups or live synchronization.
4. Put the affected tenant(s) into a controlled write-maintenance window. Record the final source boundary, stop Patient writes, and export each tenant database separately. Restore to the destination without enabling Patient writes.
5. Check database and collection inventories, record counts, stable Patient identifiers, tenant ownership fields, representative checksums, and index definitions. Provision and verify the Patient-number and all three Phase 33 duplicate indexes on the destination, then test duplicate races and fail-closed behavior against its actual MongoDB version.
6. Verify destination authorization and tenant isolation using trusted server-side tenant context. Do not treat a database name, hostname, or client-provided tenant identifier as authorization.
7. Switch the authoritative placement record only after all checks pass. This requires a future per-target connection-reference/URI design; the current single-`primary` manager cannot perform an isolated per-tenant cluster switch while retaining the source cluster.
8. Resume writes only on the destination. Revoke source write credentials and, if the provider and retention policy permit, use a separately restricted read-only database user for the old source. Retain an independent backup and the migration/verification evidence; do not delete the source as part of cutover.

This manual-copy sequence requires a write freeze. Because `mongosync` does not support Shared Tier and M0-to-M0 Atlas live-migration eligibility is unverified, **do not promise zero downtime**. The business must approve the maintenance window and recovery objective.

### Conditions before the old cluster becomes read-only

The old cluster must not be marked or treated as a read-only archive until:

- Source writes have been stopped and the final copy is complete.
- The destination's tenant isolation, data counts/integrity checks, required Phase 33 indexes, and duplicate-race behavior have been verified.
- The authoritative registry has been switched to the destination and Patient writes have been confirmed there.
- Source write credentials have been revoked or reduced to read-only privileges; the application has no write route to the source.
- A retention duration, independent backup, restore procedure, audit evidence, and archive access owner have been approved.

The current registry has no archive/read-only route. Even after a future route is added, an Atlas Free archive may pause after 30 days without connections and may require a paid M10 recovery path. It is therefore not a substitute for a durable backup or retention service.

### Failure and rollback behavior

- **Destination cannot be provisioned:** do not switch the registry, alter the source, or delete historical data. The source remains authoritative while it can safely accept writes. If capacity headroom is insufficient, pause onboarding and affected writes before the provider limit, and obtain an approved paid destination/provider. Atlas documents caps and throttling but does not promise graceful overflow; application behavior at the storage ceiling is not established here.
- **Dump, restore, index provisioning, or verification fails:** keep the destination unavailable for Patient writes and keep the source authoritative. Preserve the failed migration evidence for investigation; do not silently retry by overwriting destination data or discard patient records.
- **Cutover fails before any destination writes:** a return to source may be possible after confirming source freshness and registry state.
- **Failure after destination writes begin:** a pointer flip is not a safe rollback. Stop writes, preserve both copies, and use a separately approved reconciliation/reverse-migration procedure so destination-only updates are not lost.
- **Archive becomes paused or cannot resume:** use the documented provider recovery/export process and an independently validated backup. Do not promise recovery from the Free cluster alone.

No capacity trigger, dual-write process, change capture, per-tenant cluster switch, archive route, automated rollback, or reconciliation mechanism is implemented in the current repository. The sequence above must not be mistaken for existing behavior.

### Data integrity, security, retention, and production recommendation

- The 0.5 GB cap includes indexes. A migration needs headroom for the destination copy and index builds; same-tier rotation does not provide unlimited capacity.
- A three-node replication factor is not an independent backup. Free clusters have no managed backups, no failover or regional outage testing, limited monitoring, and no customer-key-management, database-auditing, private-endpoint, or database-access-history features.
- Free clusters can pause when unused, run provider-selected/upgraded MongoDB versions, and be deactivated under the Terms. MongoDB's Cloud Terms disclaim continued storage after cluster or agreement termination. These properties do not meet an evidenced indefinite-archive or recovery commitment.
- MongoDB Cloud Terms require a signed BAA before PHI may be stored or processed. Whether a BAA is available for the candidate Free plan is not established here. Until the authorized legal/security owners confirm it, do not load real patient or other PHI data.
- The current integration tests use MongoDB 7.0.17 standalone, not the MongoDB 8.0 three-node Atlas Free topology. Test-only success is insufficient for the destination.
- The current runtime cannot isolate a tenant's destination cluster from its source archive. A registry/client-manager design that supports multiple cluster references, activation gating, controlled cutover, and read-only archive access would be required in a later implementation phase.

**Recommendation:** Atlas Free is suitable only for a bounded, non-production feasibility experiment using synthetic data, after reviewing its current terms and limits. It is **not a production-safe SaaS healthcare storage, capacity-rotation, backup, or archival architecture on the evidence available**. Use an approved paid tier or another provider with documented capacity, supported migration, recoverable backups, retention controls, and required healthcare agreements for production. This recommendation does not select a provider or plan.

### Open decisions requiring human approval

1. Is Atlas an approved provider at all, and what signed agreement, BAA, and data-residency region would govern it?
2. Has MongoDB explicitly confirmed that the proposed capacity-driven Free-cluster rotation is permitted? The Cloud Terms prohibit using the service to avoid fees or usage quotas; do not rely on project/account rotation without written approval.
3. What supported production tier, MongoDB version, and unsharded/sharded topology will Phase 33 target?
4. What tenant count, collection count, measured BSON-plus-index size, connection load, write throughput, transfer volume, and safety margin must be supported?
5. Is a maintenance/write-freeze window acceptable, and what RPO/RTO, backup retention, archive availability, and rollback/reconciliation policy are required?
6. What later change will give each storage target an authoritative cluster reference and enforce index readiness before activation?

### Official sources checked

Checked **2026-10-10 (Asia/Riyadh)**. Public documentation was reviewed only; no account-specific quota, contract, BAA, or cluster configuration was inspected.

- [Atlas Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- [Atlas Service Limits](https://www.mongodb.com/docs/atlas/reference/atlas-limits/)
- [Back Up, Restore, and Archive Data](https://www.mongodb.com/docs/atlas/backup-restore-cluster/)
- [Restore Data From Paused Free Cluster](https://www.mongodb.com/docs/atlas/backup/restore-free-tier-cluster/)
- [Migrate or Import Data](https://www.mongodb.com/docs/atlas/import/)
- [`mongosync` Migration Limitations](https://www.mongodb.com/docs/mongosync/current/reference/limitations/)
- [Configure Database Users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/)
- [MongoDB Built-In Roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/)
- [MongoDB Cloud Terms](https://www.mongodb.com/legal/terms-and-conditions/cloud)
