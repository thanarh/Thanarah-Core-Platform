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

