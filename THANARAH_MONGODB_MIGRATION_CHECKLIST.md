# Thanarah — MySQL/MariaDB to MongoDB Migration Checklist

**Status:** Planning checklist; no migration performed
**Rule:** Check an item only after evidence is recorded and the accountable owner has accepted it. An unchecked decision or release gate is a blocker.

## A. Scope and governance

- [ ] Confirm that the migration covers every SQL runtime responsibility, not only patient/clinical data.
- [ ] Name accountable product, data, engineering, security/compliance, and operations owners.
- [ ] Approve provider, supported MongoDB version, topology, region/data residency, sharding policy, and cluster placement.
- [ ] Approve the transaction model, write concern, retry behavior, and supported failure guarantees.
- [ ] Approve data classification, BAA/healthcare terms where required, audit retention, encryption, access policy, and incident response.
- [ ] Approve maintenance/write-freeze window, migration window, RPO/RTO, retention, observation period, and rollback authority.
- [ ] Keep all unresolved decisions visible; do not infer production approval from the standalone MongoDB 7.0.17 test fixture.

## B. Production inventory and source of truth

- [ ] Inventory every production MySQL/MariaDB database, engine/version, schema/migration state, table count, row count, size, and relevant index/constraint.
- [ ] Inventory every tenant MongoDB target and its database, collection counts/sizes, indexes, topology, version, and current primary status without exposing credentials.
- [ ] Record tenant count, storage placement, active/inactive target state, and all application/reporting/job dependencies.
- [ ] Record counts and data classification for users, credentials hashes, sessions, memberships, roles, catalogs, subscriptions, audits, security events, operation ledger, and clinical records.
- [ ] Determine whether SQL `Patient` contains data; compare to each tenant's Mongo `patients` collection and document authority/conflicts.
- [ ] Identify duplicates, orphan references, invalid enum values, null/default differences, unexpected date values, malformed JSON, and records beyond schema limits.
- [ ] Map every model, field, enum, index, unique constraint, foreign key, and transaction invariant to an approved target representation.
- [ ] Document all seed/catalog records created by migrations or startup/bootstrap code.
- [ ] Define canonical ID and date handling; preserve UUIDs and distinguish date-only values from UTC instants.

## C. Target design and security

- [ ] Define platform versus tenant databases/collections and record ownership.
- [ ] Define how trusted tenant context is derived, validated, and applied to every tenant read/write.
- [ ] Define document references versus bounded embedding using actual access patterns and document-growth limits.
- [ ] Map every SQL unique/index/foreign-key/check constraint to exact MongoDB indexes or guarded service invariants.
- [ ] Verify collation, partial-filter, compound-key order, sharding compatibility, and uniqueness using the approved topology.
- [ ] Preserve patient-number and all three duplicate-prevention rules; resolve existing conflicts through an authorized process, not silent deletion.
- [ ] Define validation for enums, nullable/default fields, JSON rules/quotas, timestamps, and `updatedAt`.
- [ ] Define access and retention for password hashes, refresh-token hashes/history, IP/user-agent metadata, audit events, security events, and PHI.
- [ ] Ensure connection secrets are held only in approved secret management; do not copy connection strings into MongoDB documents or migration artifacts.
- [ ] Define backup encryption, access, retention, restore roles, key recovery, and deletion procedures.
- [ ] Explicitly decide lock lease/cleanup behavior; do not add TTL or alter scheduling-lock semantics as a side effect.

## D. Consistency and concurrency design

- [ ] Document a replacement for refresh-token atomic rotation and reuse/compromise detection.
- [ ] Document atomic failed-login count/lockout behavior under concurrent requests.
- [ ] Preserve tenant owner uniqueness and membership/role assignment rules under concurrency.
- [ ] Review every transaction call site in the 13 repositories identified in the Phase 59 decision record; document its MongoDB invariant and topology requirement.
- [ ] Preserve staff role/facility/branch scope checks when parent status changes race assignment.
- [ ] Preserve scheduling policy version compare-and-set and revision history atomically.
- [ ] Prevent overlapping active subscription periods under concurrent create/transition requests.
- [ ] Preserve tenant storage activation and primary-target switching; keep a target unavailable until all required indexes are verified.
- [ ] Choose and test encounter operation-ledger/audit design: common transaction boundary, tenant-local outbox, or explicit saga/reconciliation.
- [ ] Preserve encounter idempotency, PREPARED/CONFIRMED/NOT_APPLIED/AMBIGUOUS states, audit retry limits, and operator-review behavior.
- [ ] Define retryable versus non-retryable outcomes; make retries idempotent and observable.
- [ ] Prove all transaction claims against the approved topology; do not infer transactions from driver support or replication.

## E. Transfer tooling and rehearsal

- [ ] Use a protected migration ledger with source/model/tenant/batch, high-water mark, count, checksum, and completion state.
- [ ] Ensure deterministic keyset batching, bounded memory, resumability, and safe retry of partially completed batches.
- [ ] Ensure target writes preserve source IDs and do not overwrite unrelated records.
- [ ] Validate parent-before-child loading and tenant-reference mappings.
- [ ] Handle SQL Patient reconciliation separately from tenant Mongo-to-Mongo movement.
- [ ] Define exact conflict reports and manual disposition workflow; never auto-merge or delete duplicate clinical identities.
- [ ] Validate index creation against existing target records before activation.
- [ ] Prevent migration logs/artifacts from containing unnecessary PHI, password hashes, token material, or secret values.
- [ ] Rehearse end-to-end using sanitized production-like data and the approved server/topology.
- [ ] Rehearse process interruption, batch retry, index-build failure, unique conflict, source outage, target outage, timeout, and operator restart.
- [ ] Rehearse all backup, restore, registry/primary recovery, cutover, and rollback steps.
- [ ] Measure transfer duration, index build duration, validation duration, and restore duration against the approved window and RPO/RTO.
- [ ] Record all rehearsal outcomes, defects, corrections, and approvals; repeat after material tooling/design changes.

## F. Cutover runbook

- [ ] Confirm change approval, named operators, support coverage, communications, and stop/go authority.
- [ ] Confirm latest independent SQL and Mongo backups are complete, checksummed, protected, and restorable.
- [ ] Confirm all application instances, scheduled jobs, integrations, and admin tools are included in write-freeze scope.
- [ ] Freeze writes, drain requests and background jobs, and record the source watermark/time.
- [ ] Run final export/load using the approved sequence; capture batch ledger and transfer checksums.
- [ ] Build required target indexes and verify exact ordered definitions, options, collation, and topology compatibility.
- [ ] Reconcile counts/checksums per model, tenant, and collection; review all differences and exceptions.
- [ ] Verify cross-model references, uniqueness, tenant isolation, legacy Patient disposition, and catalog/seed completeness.
- [ ] Run authentication, session, authorization, scheduling, subscription, audit/security, storage activation, readiness, and encounter reconciliation smoke tests.
- [ ] Confirm only MongoDB is writable for production traffic; document the authoritative writer and timestamp.
- [ ] Obtain named owner sign-off before traffic switch.
- [ ] Monitor errors, latency, database load, rejected writes, authorization denials, reconciliation backlog, and backup status throughout the observation window.

## G. Rollback and recovery

- [ ] Before MongoDB accepts production writes, document the verified route back to the unchanged, write-frozen SQL source.
- [ ] After MongoDB accepts production writes, prohibit a simple configuration rollback to stale SQL.
- [ ] Define whether post-cutover rollback uses tested reverse transfer/replay or restore to an approved recovery point.
- [ ] Establish a single authoritative writer during recovery; do not dual-write without an approved idempotent replication design.
- [ ] Define conflict handling for writes made after cutover and how audit/clinical histories remain traceable.
- [ ] Run restore and rollback drills in isolated infrastructure; capture actual recovery duration and integrity evidence.
- [ ] Keep SQL read-only and recoverable for the owner-approved observation/rollback period.

## H. SQL retirement gates

- [ ] Disposition all 36 SQL models, 21 enums, migration-created records, and dependencies.
- [ ] Reconcile SQL and target counts/checksums with no unexplained differences.
- [ ] Validate all unique constraints, tenant scope invariants, references, query indexes, and topology-specific rules.
- [ ] Confirm no runtime code, readiness checks, scheduled work, reporting, support tooling, or integration still depends on SQL.
- [ ] Confirm SQL has remained read-only for the full approved observation period.
- [ ] Confirm no missing/duplicate/ambiguous encounter operations and no unresolved audit delivery backlog.
- [ ] Confirm restore and recovery meet approved RPO/RTO and have named ongoing owners.
- [ ] Obtain security/compliance, data owner, product, and operations sign-off for archive, retention, and deletion.
- [ ] Obtain explicit authorization before revoking access or irreversibly deleting SQL data/backups.

## I. Phase 60 infrastructure evidence and prerequisites

### Verified repository/workspace facts (not production validation)

- [x] Current Prisma datasource remains MySQL; the repository has 36 models, 21 enums, and 29 migration directories.
- [x] The current tenant Mongo client enables `retryWrites`; this does not prove majority acknowledgement, transaction support, or end-to-end idempotency.
- [x] Production configuration validates the tenant Mongo URI for TLS with certificate and hostname validation; this does not verify a live production endpoint.
- [x] The existing Mongo integration fixture starts `mongo:7.0.17` without replica-set initialization; it is standalone test infrastructure, not production-topology evidence.
- [x] No local MongoDB process or running Docker container was found during Phase 60 workspace inspection; port-listener inspection was unavailable because `ss` was not installed.
- [x] The current project workflow starts the NestJS application; no MongoDB service workflow is configured in this workspace.

### Required before capability tests or implementation

- [ ] Owner approves provider, supported server version, topology, region/residency, service terms, and operating owner.
- [ ] Owner makes an isolated topology-matched replica-set environment available; do not create one without explicit authorization.
- [ ] Verify transaction commit/abort and failover interruption on that environment.
- [ ] Verify exact unique/partial indexes, concurrent update races, write concern, retry behavior, backup and restore.
- [ ] Approve TLS/network restrictions, least-privilege users, connection-pool/timeouts, monitoring, and alerting.
- [ ] Approve backup frequency/retention, restore test cadence, RPO/RTO, and recovery responsibilities.
- [ ] Record actual test commands, topology/version, output and limitations in `PHASE_60_MONGODB_CAPABILITY_TEST_RESULTS.md`.
- [ ] Keep migration readiness **NO-GO** until every mandatory capability and owner decision has evidence.

## J. Phase 61 isolated replica-set lab evidence

### Verified discovery (2026-10-30; read-only)

- [x] Docker CLI and daemon are available; read-only Docker metadata reported server version 27.5.1.
- [x] `docker ps` returned no running containers; no container or service was started.
- [x] No local `mongod`, `mongosh`, or `mongo` executable, MongoDB process, or port-27017 listener was found.
- [x] Existing Testcontainers fixture provisions standalone MongoDB 7.0.17 and is not replica-set evidence.
- [x] No approved isolated replica-set environment or target profile was evidenced; no remote endpoint was probed.
- [x] Phase 61 replica-set, concurrency, and backup/restore tests were **NOT RUN** because the required approved environment was unavailable.
- [x] The Phase 49 disposable restore report is historical standalone-fixture evidence only; it does not establish Phase 61 replica-set recovery capability.

### Required before Phase 61 tests

- [ ] Owner explicitly approves and provides an isolated, disposable replica-set test environment matching the proposed target profile; do not provision one without authorization.
- [ ] Approve server/driver versions, member/election layout, TLS, least-privilege identities, network restrictions, write concern, and permitted failover controls.
- [ ] Provide an isolated backup method and separate clean restore target; define integrity checks and recovery-time criteria.
- [ ] Run the replica-set, Thanarah concurrency, and backup/restore matrices using synthetic data only; record actual evidence in the three Phase 61 reports.
- [ ] Keep migration readiness **NO-GO** until required tests pass and owner decisions are approved.

## K. Phase 62 replica-set lab attempt

### Actual evidence (2026-10-31)

- [x] Three isolated MongoDB 7.0.17 containers started with separate data volumes and localhost-only published ports.
- [x] MongoDB runtime was configured with replica-set mode, authorization, and a locally generated test keyfile; test-only credential values were not recorded.
- [x] Replica-set initialization was attempted and **failed** its quorum check because the second and third members did not respond.
- [x] Peer names resolved on the dedicated user-defined bridge, but member TCP connectivity failed; no primary, secondary health, or replication state was established.
- [x] Transaction, failover, backup/restore, and Thanarah workflow matrices were **NOT RUN**. No standalone substitute was used.
- [x] Only Phase 62 containers, networks, volumes, and temporary test credentials were removed; verification found no Phase 62 resources or localhost test listeners remaining.

### Required before further capability tests

- [ ] Provide an isolated Docker/network environment where members can communicate over a private bridge while retaining loopback-only published ports.
- [ ] Reprovision three members and verify successful initialization, one primary, two healthy secondaries, and replicated synthetic writes before running capability tests.
- [ ] Keep all transaction, failover, backup/restore, and Thanarah capability claims unverified until their respective Phase 62 reports contain passing evidence.
- [ ] Keep migration readiness **NO-GO**; infrastructure tests alone do not establish production readiness or application parity.

## L. Phase 63 local replica-set evidence

### Demonstrated in a disposable local lab (2026-10-31)

- [x] A three-member MongoDB 7.0.17 replica set initialized using loopback-only Docker host networking after the bridge network failed peer TCP connectivity.
- [x] One primary and two healthy secondaries were verified; synthetic writes replicated to all three members.
- [x] Multi-document transaction commit and abort behavior passed.
- [x] Unique-index conflict, concurrent insert, and atomic conditional-update tests passed.
- [x] Majority write acknowledgement and a normal retryable write were verified; retry after an induced transient failure and uncertain acknowledgement remain untested.
- [x] Controlled primary stepdown, replacement election, and reconnection by a replica-set-aware test client passed.
- [x] A logical backup restored to a separate isolated standalone MongoDB 7.0.17 target; six documents, counts, representative values, a unique index, and source/restore independence were verified.
- [x] Seven synthetic Thanarah invariant simulations passed; they do not verify production application code or establish workflow parity.
- [x] Phase 63 containers, volumes, temporary credentials, backup files, and test ports were removed and verified absent.

### Still unverified; readiness remains NO-GO

- [ ] Resolve or replace the Docker bridge networking restriction; host networking is loopback-only test infrastructure, not an approved production topology.
- [ ] Test in-flight transaction interruption, retry after failover, and ambiguous acknowledgement recovery.
- [ ] Verify Thanarah's actual Node MongoDB client and application workflows against the approved target topology.
- [ ] Approve provider, production topology, TLS/network profile, residency/compliance, operational ownership, backup controls, RPO/RTO, and cutover/recovery plan.
- [ ] Do not infer production migration readiness or application parity from this local lab.

## M. Phase 64 application-client evidence

### Verified on a disposable loopback-only replica set (2026-10-31)

- [x] The actual official MongoDB 7.7.0 client created by `TenantMongoClientManager` connected to the disposable MongoDB 7.0.17 replica set, discovered one primary/two secondaries, and reported readiness.
- [x] Native driver session commit, abort, and session cleanup passed through the managed client; this is driver-level evidence, not an existing repository transaction abstraction.
- [x] The actual `MongoTenantPatientStorage` adapter resolved the synthetic tenant target, created/read a synthetic Patient, and translated a duplicate patient-number conflict.
- [x] An injected pre-execution connection close on a retryable insert and an injected transient transaction error both recovered without duplicate test documents; a controlled primary stepdown was followed by a successful write.
- [x] Focused application-manager/readiness/storage unit tests passed; exact counts and boundaries are in `PHASE_64_APPLICATION_MONGODB_COMPATIBILITY.md`.

### Still unverified; readiness remains NO-GO

- [ ] Reproduce an acknowledgement lost after the server commits and verify safe operation-status recovery; the Phase 64 failure injector closed the connection before execution.
- [ ] Interrupt an active application transaction with a real primary stepdown and prove safe retry/commit-status handling.
- [x] Added `PlatformMongoClientManager.withTransaction` as a storage-layer session boundary; unit tests cover cleanup and error behavior. The Phase 65 real-replica-set test is added but was skipped in the current run.
- [ ] Verify MongoDB implementations for all 13 repositories in `PHASE_64_REPOSITORY_TRANSACTION_MATRIX.md`; each is still Prisma/MySQL.
- [ ] Test actual Appointment and Encounter Mongo adapters and live timeout/topology error sanitization.
- [ ] Approve a production topology and verify TLS, credentials, provider/network behavior, backups, recovery objectives, and application parity. Keep migration readiness **NO-GO**.

## N. Phase 65 isolated platform storage foundation

### Implemented and verified in the workspace (2026-11-02)

- [x] Added an independent optional `PLATFORM_MONGO_URI` / `PLATFORM_MONGO_DATABASE` configuration pair; tenant Mongo and Prisma/MySQL configuration are unchanged.
- [x] Added lazy platform client lifecycle, neutral readiness, graceful shutdown, typed/validated platform identity, tenant, membership, platform-role/permission, and session/history document contracts and repository operations.
- [x] Added explicit index provisioning and verification for the implemented collections; the disposable replica-set test verified uniqueness, ordered keys, user-email collation, and no TTL index.
- [x] Phase 65 platform MongoDB integration: **6/6 passed** against a disposable three-member loopback-only MongoDB 7.0.17 replica set. Tests used synthetic data and a test-only database; no Prisma/MySQL connection was imported by the integration test.
- [x] No existing SQL repositories, authentication/authorization workflows, tenant activation, subscriptions, audit workflows, production data, or production configuration were switched or modified.

### Still not migrated or proven; readiness remains NO-GO

- [ ] No cross-document referential integrity, authorization invariants, session rotation/reuse guarantee, or MongoDB transaction propagation is implemented; keep the new repositories unused by live workflows.
- [ ] Prove equality/collation behavior against MySQL `utf8mb4_unicode_ci` before any identity cutover.
- [ ] Approve production provider/topology, data residency/compliance, access roles/secrets, backup and restore, retention, RPO/RTO, and operations ownership.
- [ ] Implement and verify the 13 transaction-bearing repository replacements, audit/outbox/encounter consistency, Appointment and Encounter compatibility, transfer rehearsal, and cutover gates.
- [ ] Do not infer MySQL retirement readiness or production feature parity from this foundation.

## O. Phase 66 repository migration audit

### Verified source-repository facts (2026-11-01; no production access)

- [x] Recounted the current Prisma schema: 36 models, 21 enums, and 29 migration directories; the prior inventory counts still match.
- [x] Found 22 active Prisma-backed control-plane repository classes and 3 separate tenant-storage contract implementations. `TenantStorageActivationService` is a service, not a repository.
- [x] Confirmed 13 distinct source files contain transaction-bearing operations: 12 repository classes and `TenantStorageActivationService`; multiple transaction blocks occur in some files.
- [x] Identified direct Prisma access outside repository classes in `AppController` readiness, `EncounterService` operation-ledger handling, and `TenantStorageActivationService`.
- [x] No Nest scheduled-job/cron registration was found in `src/` or `scripts/`; explicit development bootstrap and Prisma helper scripts exist.
- [x] Added Phase 66 architecture, repository dependency, transaction compatibility, SQL/Mongo semantics, and migration-sequence reports. These are source audits and plans, not production inventory or compatibility evidence.

### Incomplete and unverified; readiness remains NO-GO

- [x] The Phase 66 baseline lacked a complete database-independent port layer; the 22-repository port layer was completed later in section R. Other direct Prisma responsibilities remain.
- [ ] No reusable cross-adapter repository contract suite was added or run in Phase 66.
- [ ] The Phase 65 platform Mongo repositories are not replacements for the active central repositories. All 13 transaction-bearing workflows and encounter cross-store behavior remain unimplemented/unverified on MongoDB.
- [ ] The current run did not execute opt-in replica-set workflow concurrency, failover interruption, or uncertain-acknowledgement tests. Prior Phase 63–65 evidence is limited to its stated test surfaces.
- [ ] No differential MySQL/MongoDB semantic tests were run for Unicode collation, nullable uniqueness, date precision/timezones, decimal precision, sorting/pagination, enums, null-versus-missing, counters, or lifecycle filters.
- [ ] No production database, production secret value, or production environment was accessed or changed. No migration, dual-write, shadow-write, deployment, staging, or commit was performed.
- [ ] Owner decisions and approvals for provider/topology, residency/compliance, transaction policy, retention, backups/restore, RPO/RTO, and operational ownership remain outstanding.
- [ ] Do not begin production migration, active repository replacement, shadow traffic, or cutover. Phase 67 may begin only isolated planning/contract-test/tooling after required topology and owner approvals.

## P. Phase 66B incremental typed persistence ports

### Implemented and verified in the workspace (2026-11-03)

- [x] Added application-owned typed ports for Feature catalog, Plan/PlanFeature catalog, and Platform audit/security event persistence. The interfaces do not expose Prisma or MongoDB types.
- [x] Bound the catalog, audit, authentication, tenant, and membership port groups to their existing Prisma repositories using explicit Nest injection tokens and `useExisting`; no Mongo adapter is registered.
- [x] Migrated `FeatureService`, `PlanService`, and `PlatformAuditService` to interface-typed constructor dependencies. Query behavior, conditional updates, and transaction ownership were retained.
- [x] Added a Nest dependency-injection test proving all three tokens resolve to their intended Prisma adapters.
- [x] TypeScript, build, focused repository/DI tests, full suite, formatting, and lint passed. Latest full suite: 935 passed, 12 skipped; lint has one pre-existing warning.
- [x] Added typed identity, session/refresh-history, and platform authorization ports. Existing Prisma repositories remain the adapters; auth services and guard depend on the ports. Login lockout and session/history transaction boundaries were not moved.
- [x] Added focused auth DI coverage verifying all three auth ports resolve to their intended Prisma repositories.
- [x] Added application-owned tenant/organization and membership ports. The central Tenant model represents organization; source audit found no separate organization or tenant-hostname repository.
- [x] Bound `TENANT_PERSISTENCE` and `TENANT_MEMBERSHIP_PERSISTENCE` to the existing Prisma repositories with `useExisting`; migrated tenant service, membership service, membership validation, and workspace listing consumers.
- [x] Routed membership invitation user lookup through the existing `PLATFORM_USER_PERSISTENCE` port.
- [x] Preserved tenant-scoped membership predicates, active-tenant checks, lifecycle row lock, owner protection, transaction ownership, pagination, and ordering; added focused cross-tenant negative regression coverage.
- [x] At the end of Slice 3, eight of 22 central Prisma-backed repository classes implemented ports; the continued increments below record the current cumulative count.

### Still incomplete; readiness remains NO-GO

- [x] At that checkpoint, eight of the 22 central Prisma-backed repositories remained unported; later port increments are recorded in sections Q and R.
- [ ] `AppController` still calls Prisma readiness directly; `EncounterService` and `TenantStorageActivationService` still use Prisma directly.
- [ ] Feature/Plan services still inspect Prisma `P2002` errors, and catalog/audit services still import generated Prisma enum values. These implementation leaks need a neutral domain contract before those services are fully persistence-independent.
- [ ] No all-repository contract suite or Mongo adapter tests were added. Transaction commit/rollback and concurrent tenant membership lifecycle behavior remain unverified against MySQL; failover and uncertain-acknowledgement behavior remain unverified for MongoDB.
- [ ] This auth slice uses mocked Prisma tests; true concurrent refresh execution and database rollback behavior were not verified against MySQL in this increment.
- [x] Phase 66B central repository porting is complete for the audited set; Mongo adapter migration, transaction parity, and cutover remain incomplete and unsafe to activate.

## Q. Phase 66B continued port increments

### Implemented and verified in the workspace (2026-11-03)

- [x] Added typed ports for tenant roles, membership-role assignments, facilities, branches, feature entitlements, and plan-feature quota lookup.
- [x] Kept all six domains on their existing Prisma repositories; the role, membership-role, and branch transaction boundaries remain in the adapters.
- [x] Migrated role, tenant authorization, facility, branch, entitlement, and quota services to interface-typed port injection.
- [x] Bound the role/assignment and facility/branch port groups with `useExisting`; entitlement and quota modules bind their port tokens to Prisma providers.
- [x] Added DI binding tests for role/assignment and facility/branch groups; existing service and repository regression tests cover the changed consumers and adapters.
- [x] TypeScript check passed. Focused regression run: 145 tests passed across 13 files.
- [x] Fourteen of 22 central Prisma-backed repositories now implement ports; eight remain unported.

### Still incomplete; readiness remains NO-GO

- [ ] No MongoDB adapter is implemented or registered for these six new ports; Prisma/MySQL remains the only active adapter.
- [ ] Role/bootstrap, role assignment, and branch creation transaction behavior remains unverified on MongoDB; no tenant owner or authorization workflow has switched stores.
- [x] Full suite passed: 937 tests passed and 12 opt-in integration tests skipped across 2 files; TypeScript, Nest build, and formatting passed.
- [x] ESLint passed with 0 errors and 1 pre-existing warning at `test/encounter-operation-reconciliation.spec.ts:10`.
- [ ] Disposable Mongo integration, operational, migration-tooling, and data-transfer workstreams remain unverified or not started.
- [x] At that checkpoint, the remaining eight repository ports and transaction compatibility work were still pending; port completion is recorded in section R.

## R. Remaining central repository port increments

### Implemented in the workspace (2026-11-03)

- [x] Added application-owned ports and Prisma bindings for healthcare catalog, service catalog, subscriptions, tenant staff, staff-role assignments, staff facility/branch scope, doctors, and facility scheduling policies.
- [x] Migrated the corresponding services to interface-typed port injection; transaction ownership, row locks, tenant predicates, version checks, and revision writes remain in existing Prisma adapters.
- [x] Added Nest DI coverage for each new binding and retained the existing repository/service regression suites.
- [x] All 22 of the audited central Prisma-backed repositories now implement ports. The port layer is complete for this repository set; this is not a MongoDB migration or parity claim.
- [x] Full suite passed: 952 tests passed and 14 opt-in tests skipped across 107 passed and 2 skipped files; type-check, Nest build, formatting, and diff checks passed.
- [x] Lint passed with 0 errors and 1 pre-existing warning at `test/encounter-operation-reconciliation.spec.ts:10`.
- [x] Workflow restarted successfully; Nest started on port 5000. The configured development database URL was rejected as non-MySQL, so database connectivity remains unverified.

### Still incomplete; readiness remains NO-GO

- [ ] Prisma remains the only active adapter. No MongoDB adapter is registered for these ports.
- [ ] MongoDB transaction/session parity, MySQL semantic parity, migration tooling, synthetic data-transfer rehearsal, backups/recovery, operational ownership, and cutover approval remain outstanding.
- [ ] Do not access production databases, change production configuration, dual-write, deploy, commit, transfer production data, or retire SQL.

## S. Mongo transaction propagation boundary

- [x] Added an unused platform-storage transaction runner that passes a driver session only to transaction-scoped storage work and always ends the session.
- [x] Added unit coverage for success, cleanup, safe domain errors, driver-error sanitization, and missing configuration.
- [ ] Run the new commit/abort integration case against a disposable Phase 65 replica set; the current environment did not run opt-in Mongo integration files.
- [ ] This runner is not a cross-provider contract, does not prove workflow parity, and is not bound to any active persistence port.

## T. Read-only platform authorization Mongo candidate

- [x] Added an isolated `PlatformAuthorizationPersistencePort` implementation using the existing platform role/permission collections.
- [x] The candidate validates stored documents and references, rejects unknown authorization codes, de-duplicates permissions, and masks raw database failures.
- [x] Authorization reads use snapshot transactions and pass the same session to each collection read; unit tests assert both.
- [x] Unit tests cover role/permission resolution, empty assignments, broken references, and sanitized failures (5 tests).
- [ ] The Phase 65 replica-set integration test is present but skipped in the current environment.
- [ ] The candidate is not registered in Nest or selected for application traffic; it does not prove data parity, write-path consistency, or migration readiness.

