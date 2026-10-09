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
