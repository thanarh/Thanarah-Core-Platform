# Thanarah — MongoDB Migration Rehearsal and Cutover Runbook

**Phase:** 59 — planning only
**Status:** Proposed runbook for a later implementation phase
**Purpose:** Give a separate implementation phase enough transfer rules and acceptance gates to build a migration tool without inventing mappings or safety behavior.

## 1. Operating rules

- This document authorizes no production connection or data change. Do not run migration steps until owner decisions, access approval, and a separately approved execution window exist.
- One authoritative writer at a time. No default dual-write.
- No production secrets in shell history, command arguments, logs, checkpoints, reports, or documents.
- Preserve every source record and ID until reconciliation and owner-approved disposition. Never delete or merge data to make validation pass.
- Keep source records read-only during copy. After cutover, keep SQL read-only and recoverable through the approved observation period.
- Stop on unclassified data, missing required index, unexplained count/checksum mismatch, cross-tenant reference, unresolved duplicate, or failed backup/restore check.
- Do not automatically move data between tenant physical databases. Placement changes are explicit, separately rehearsed operations.

## 2. Required run parameters and approvals

Before a rehearsal or production run, record in the change ticket/run manifest:

- Source database engine/version and schema migration watermark.
- Approved target provider, version, topology, region, tenant placement, shard policy, and transaction/write-concern profile.
- Source and target identifiers, collection mapping version, application build, operator identities, and approved secret handles (never secret values).
- Data classification, maintenance window, freeze time, source watermark, source/target backup references, checksum algorithm, and transfer tool version.
- Owner-approved RPO/RTO, count/completeness thresholds, performance budgets, required restore point, rollback decision authority, and observation duration.
- Explicit list of source databases/tenant Mongo targets included and excluded, with reasons.

If these values are absent, do not start.

## 3. Transfer specification

### 3.1 Mapping and conversion rules

Use `THANARAH_MONGODB_TARGET_DATA_MODEL.md` as the authoritative per-model mapping. Apply these rules to all 36 Prisma models:

1. Preserve single-model UUID IDs as MongoDB `_id` strings without regeneration.
2. For join models with composite SQL keys, create deterministic `_id` from the ordered source key values; retain all key fields and enforce their unique compound index.
3. Preserve source field names/values, enum strings, nullability, defaulted values already stored, JSON values, and timestamps. Record any explicitly approved conversion in a versioned mapping manifest.
4. Keep date-only values (notably `Patient.dateOfBirth`) as calendar dates; do not convert them as midnight UTC instants.
5. Preserve numeric precision and string comparison behavior. Verify SQL collation behavior against MongoDB index collation before declaring uniqueness equivalent.
6. Copy platform/global entities before references: permission catalogs, roles, tenants/users, then memberships/assignments and dependent catalog/operational records. The exact dependency order is in the model document and must be encoded in the tool.
7. Tenant MongoDB collections are a separate source stream. If retaining the same physical tenant database, inventory and verify rather than re-copy. If moving a database, use a tenant/domain-specific manifest and the same checkpoint and reconciliation rules.
8. SQL `Patient` rows must go through the dedicated reconciliation workflow in Section 7; they must not be blindly inserted into an already-populated tenant collection.

### 3.2 Checkpoint format

The checkpoint ledger is migration-control metadata, not business data. Use an access-controlled store with a uniqueness key equivalent to:

`{migrationId, sourceSystem, sourceNamespace, sourceModel, tenantIdOrGlobal, batchNumber}`

Each completed batch records:

- Mapping version and tool version.
- Deterministic source key range / last source key.
- Source count, target upsert/insert count, skipped count (must be explained), and conflict count.
- Canonical source and target checksum inputs and resulting digests.
- Start/end timestamps, outcome, retry count, and safe error classification.
- Target placement identity and index-validation state.

Do not include patient payloads, password hashes, refresh tokens, connection strings, or unnecessary PHI. Store checkpoints atomically; a batch is complete only after writes and reconciliation evidence are committed. A repeated batch must be idempotent and produce the same target IDs and values.

### 3.3 Batching and retries

- Use keyset pagination over a stable unique source key; avoid offset pagination on changing tables.
- Bound batch size by measured document bytes, memory, write rate, and target latency. The exact batch size is a rehearsal parameter, not a hard-coded guess.
- Use unordered bulk writes only when per-record errors are captured and mapped; never let one duplicate silently hide other failures.
- Retry only classified transient network/primary-selection/write-conflict failures with bounded exponential backoff and jitter. Do not retry validation, unique conflict, authorization, or data-shape errors as if transient.
- After an uncertain acknowledgement, read back by deterministic target ID and compare canonical content before retrying.
- A missing checkpoint is not proof that a batch was never written. Reconcile target state before re-running.
- After the configured retry ceiling, stop the affected stream, preserve evidence, and require operator disposition.
- Do not run clinical write traffic against a target during bulk load or index construction.

## 4. Preflight and backup sequence

1. Confirm all approvals and source/target inventory. Verify current migration status; do not apply SQL or Mongo schema migrations as part of this phase.
2. Verify the target environment is isolated, access-controlled, encrypted in transit, has least-privilege migration credentials, and matches the approved topology.
3. Run read-only source preflight: table/model counts, source key ranges, required-field null counts, enum distributions, unique-key conflict scans, orphan/reference checks, date and JSON anomalies, and data-size estimates.
4. For each tenant, verify registry identity, active target, primary/domain placement, indexes, source cluster identity, and routing assumptions. Do not infer a tenant’s target from a user-supplied database name.
5. Create independent encrypted backups of SQL and relevant tenant MongoDB sources. Verify checksums and restore each into isolated infrastructure before cutover authorization.
6. Record backup IDs/timestamps and restore-test evidence in the run manifest. If backups or restores fail, stop.
7. Run a dry run that emits counts, conflicts, and planned writes only. Verify it cannot mutate either source or target.

## 5. Copy and validation sequence

### Rehearsal / initial load

1. Copy platform catalogs and roots, including users, roles/permissions, tenant records, plan/feature catalogs, and reference data.
2. Copy tenant-scoped organization, memberships, assignments, catalogs, doctors, scheduling policy/current versions/revisions, subscriptions, storage registry, audit/security records, and operation-ledger records in dependency order.
3. Transfer or verify tenant MongoDB records separately, preserving the existing `_tenantId` and record `_id`.
4. Build target indexes after loading only when the approved method is safe for that collection. Before each unique index, run a conflict report. A failure leaves the target non-writable; do not delete/merge records to pass.
5. Run per-batch source-to-target count and canonicalized digest comparison; store evidence in the checkpoint ledger.
6. Run full-stream count and relationship reconciliation after all batches complete.
7. Run application integration tests against the approved target topology and restore from the test backup. A passing standalone test is not evidence for a replica set or sharded topology.

### Final production copy

The currently evidenced repository has no CDC, change log, or dual-write mechanism for SQL-owned models. Therefore the default plan is a controlled write freeze:

1. Put all application endpoints, background jobs, and admin tooling that can write into maintenance mode. Drain in-flight requests and wait for operations to settle.
2. Confirm no source writes remain; record UTC freeze time and a source watermark per source system.
3. Create final coordinated source backups. Because platform SQL and tenant Mongo may not share an atomic snapshot, keep writers frozen until both snapshots and final transfer are complete.
4. Run final keyset delta from the previous rehearsal watermark, then the SQL-to-Mongo transfer, tenant Mongo verify/copy, index verification, and full reconciliation.
5. Do not shorten the freeze by making concurrent writes to source and target. If freeze is unacceptable, stop and design a separately approved CDC/outbox solution with an explicit ordering and conflict policy.

## 6. Measurable acceptance gates

Set all environment-specific performance and recovery thresholds before rehearsal. Unless an owner approves a documented exception:

| Gate | Required pass condition |
|---|---|
| Record counts | For every source model and tenant, source eligible count equals target count plus only individually classified and owner-approved exclusions. **Unexplained difference: 0.** |
| Required-field completeness | 100% of target-required fields are valid; 0 silently defaulted or coerced source values. Every exception has record ID, reason, owner, and disposition. |
| Identifier preservation | 100% of in-scope source IDs map to the same target `_id`; 0 generated/replaced IDs; composite-key rows map deterministically. |
| Referential integrity | 100% of required references resolve to a target record with matching tenant scope. Nullable/SetNull historical references are reported separately and retained per source semantics. |
| Unique indexes | Every required unique/compound/partial index exists with exact ordered key, uniqueness, partial predicate, collation, and name/compatibility contract. 0 unresolved conflicts. |
| Tenant isolation | 100% pass on cross-tenant ID substitution, guessed IDs, tenant filter omission, role/scope revocation, aggregation, search, and storage-route tests; 0 data leakage. |
| Authentication parity | Pass existing password hash verification; inactive/locked user rejection; failed-login threshold and reset behavior; session create/revoke; concurrent refresh rotation; token reuse detection and compromise behavior. No raw token appears in storage or logs. |
| Authorization parity | Platform and tenant permission decisions, membership and role changes, owner rules, facility/branch scope, and status changes match approved expected results for positive and negative cases. |
| Schedule consistency | Concurrent overlapping appointment attempts preserve existing lock/uniqueness behavior; owner-token release is safe; process interruption/stale-lock behavior is documented and tested. |
| Subscription integrity | Concurrent active-period create/transition tests produce no unauthorized overlap; plan/tenant inactive transitions reject operations as specified. |
| Audit/operation ledger | Every mutation marker, clinical history event, audit event, delivery state, and reconciliation result matches the source/cutover set; 0 unexplained pending/ambiguous operations. Replaying a delivery does not duplicate an audit event. |
| Backup restoration | Restore SQL and Mongo snapshots into isolation; all relevant counts/checksums and index gates pass; measured recovery time meets approved RTO and data point meets RPO. |
| Performance | Critical endpoint/query latency, throughput, connection use, index size, and migration duration meet owner-approved numeric budgets under representative load. No numeric budget is inferred here. |
| Recovery behavior | Inject target outage, primary failover, network timeout, ambiguous acknowledgement, interrupted batch, and process restart. Recovery produces no missing/duplicate records and follows the runbook. |

## 7. Special reconciliation: Patient and existing tenant MongoDB

1. Build an inventory of SQL `Patient` rows by `tenantId` and existing Mongo `patients` documents by `_tenantId`. Do not include PHI in ordinary reports.
2. Match exact stable tenant and patient IDs first. Record exact matches, SQL-only rows, Mongo-only rows, same-ID content mismatches, patient-number collisions, and identity duplicate candidates separately.
3. Do not infer identity solely from names, email, phone, or date of birth. The duplicate-detection rules are conflict signals, not authorization to merge.
4. Preserve every original record. Have the data owner decide whether an SQL-only row is stale, authoritative, or requires a separately authorized add; record decision provenance.
5. Before creating patient uniqueness indexes, compute conflicts under the exact current normalization, partial-filter and collation rules. Do not drop existing duplicate indexes before the replacement definitions pass verification.
6. If copying to another tenant database, preserve `_id`, `_tenantId`, patient number, timestamps, and raw clinical references. Validate appointment/encounter references against the same tenant.
7. Activate the destination only after exact index verification and all reconciliation gates pass.

## 8. Cutover, stop conditions, and rollback

### Go/no-go

Go only after the migration lead, engineering owner, data owner, security/compliance owner, and operations owner sign the run manifest. Confirm all Section 6 gates, tested backups, monitoring, support coverage, and rollback authority.

### Stop immediately if

- Any source/target count or checksum mismatch is unexplained.
- A unique index cannot be created/verified, including index order, partial predicate, collation, or sharding compatibility.
- A required reference is missing or crosses tenant scope.
- Any auth, permission, isolation, clinical audit, schedule, or subscription test fails.
- A source backup cannot be restored, the approved topology differs from the tested topology, or migration credentials exceed least privilege.
- A migration batch returns an uncertain result that cannot be reconciled by deterministic ID.

### Switch

1. Keep application writes frozen through final load and reconciliation.
2. Verify target health, critical indexes, read/write permissions, backup status, and the active tenant placement registry.
3. Switch the single writer/routing configuration only under the approved release process.
4. Run smoke tests and monitor error rate, latency, auth denials, cross-tenant access metrics, pending operations, audit backlog, target health, and backup jobs.
5. Record exact time of first MongoDB production write. This is the rollback boundary.

### Rollback boundary

- **Before first MongoDB production write:** route back only to the unchanged, write-frozen SQL source after verifying its restore point and schema compatibility.
- **After first MongoDB production write:** do not point the application at stale SQL. Use only a separately rehearsed reverse-replay/reconciliation mechanism or restore to an approved recovery point with an explicit data-loss decision. Keep a single writer.
- Keep SQL and its backup read-only until the owner-approved observation period and all retirement gates are complete.

## 9. Run evidence and implementation deliverables

A later implementation phase should produce:

- Versioned migration mapping manifest matching the target data-model document.
- Dry-run/read-only inventory command and a migration command with explicit source/target allowlists.
- Checkpoint/restart implementation and a resume report.
- Conflict and reconciliation reports that minimize PHI.
- Index-definition verifier that checks exact ordered keys, options, partial filters, collations and sharding compatibility.
- Backup/restore evidence, topology-matched integration tests, failure-injection results, performance report, and operator runbook.
- Cutover log, owner approvals, rollback decision, post-cutover reconciliation, and signed SQL-retirement approval.

Do not create or run these tools during Phase 59.

