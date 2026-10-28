# Thanarah — Full MySQL/MariaDB to MongoDB Migration Assessment

**Assessment date:** 2026-10-28
**Status:** Planning assessment; no migration approved or performed
**Scope:** Repository-specific assessment of moving all platform persistence from MySQL/MariaDB to MongoDB, including data transfer, architecture, consistency, phased execution, and retirement gates.

## 1. Executive summary

Thanarah is not currently a MySQL-only application. It already runs a split persistence architecture:

- Prisma and MySQL/MariaDB currently own the platform/control-plane records, identity and authorization, sessions, tenant and catalog data, subscriptions, security/audit records, tenant-storage registry, and encounter operation ledger.
- The MongoDB Node.js driver currently owns tenant patient, appointment, and encounter documents, along with appointment scheduling-lock documents.
- `prisma/schema.prisma` still contains a central `Patient` model, but repository documentation and runtime storage code identify it as legacy; the active Patient repository uses tenant MongoDB storage.

The central Prisma schema contains **36 models and 21 enums**, with **29 checked-in migration directories**. Moving to MongoDB therefore requires more than copying SQL rows: it requires replacing Prisma/MySQL persistence across identity, authorization, tenant control plane, catalogs, subscriptions, audit/security, and the encounter-operation workflow, while preserving the already-live tenant MongoDB data and its routing rules.

The largest technical risks are:

1. **Security and tenant isolation:** SQL foreign keys, composite uniqueness, and joins currently help enforce identity and tenant boundaries. MongoDB will not provide relational foreign keys; these invariants must be made explicit in indexes, guarded write paths, and consistency checks.
2. **Multi-document atomicity:** Several important application workflows rely on SQL transactions and `SELECT ... FOR UPDATE`. Production MongoDB topology and transaction guarantees are not approved. The test fixture is a standalone MongoDB 7.0.17 instance and does not prove transaction capability.
3. **Cross-store encounter operations:** Encounter documents are in tenant MongoDB while the durable operation ledger and platform audit are in central SQL. The existing prepare/write/confirm/reconcile behavior must remain safe when these records move, including if they end up on different clusters.
4. **Data correctness and recovery:** No production counts, conflict baseline, migration mapping, approved RPO/RTO, write-freeze window, or production backup automation is evidenced. A disposable MySQL+Mongo restore test is not a production recovery plan.
5. **Provider, topology, residency, and compliance:** The repository does not approve a MongoDB provider, server version, topology, sharding policy, region, BAA/healthcare terms, or operational owner. These must remain explicit owner decisions.

**Recommendation:** Do not start a production migration or choose a MongoDB topology based on this assessment. First obtain owner decisions and production inventory, then implement and validate the migration tooling in an isolated non-production environment. The safest currently assessable cutover is an approved write freeze, consistent source backups, resumable offline transfer, reconciliation, and a controlled switch. Do not dual-write by default.

## 2. Scope, evidence, and limits

### In scope

- All persistence described by the current Prisma schema and runtime repositories.
- Existing tenant MongoDB collections and their role in the target architecture.
- Data mapping, transfer safety, consistency, rollback boundaries, and retirement conditions.

### Evidence reviewed

- `prisma/schema.prisma` and `prisma/migrations/`.
- Prisma-backed repositories and services under `src/auth`, `src/tenant`, `src/subscriptions`, `src/platform-security`, and `src/database`.
- Tenant MongoDB storage, client manager, storage registry/activation, and readiness code.
- `README.md`, `replit.md`, `.env.example`, Mongo deployment/topology decision records, and the existing recovery artifact/test documentation.
- Existing test source and test topology declarations.

This is repository evidence, not a production database assessment. No production database was queried; no secret values were read; no test, migration, data transfer, deployment, or application/configuration change was performed for this planning phase. The initial Git worktree was clean.

### Important evidence limits

- Production row/document counts, tenant counts, payload sizes, duplicate/conflict rates, and data quality are unknown.
- The standalone MongoDB 7.0.17 integration fixture is test-only evidence. It does not establish production topology, transaction guarantees, supported server version, or provider approval.
- The existing disposable recovery artifact demonstrates a test procedure, not automated production backups, retention, restore objectives, or ownership.
- Historical migration-impact documents may describe earlier phases. Current code and current decision records take precedence where they differ.

## 3. Current persistence map

### 3.1 SQL-owned runtime data

Current MySQL/MariaDB runtime responsibilities include:

- Platform users, password hashes, login lockout state, platform roles/permissions, sessions, refresh-token history, and token versions.
- Tenant identity/status, memberships, tenant roles/permissions, staff profiles, staff role assignments, facility/branch scope, doctors and their department/specialty assignments.
- Department, specialty, service, facility, branch, and scheduling policy catalogs.
- Plans, features, plan-feature configuration, subscriptions, and their lifecycle state.
- Tenant MongoDB storage-target registry and primary-target metadata.
- Platform audit log, platform security events, and encounter operation/audit-delivery ledger.

The central `Patient` Prisma model is still present in the schema and migration history, but the documented runtime Patient path uses MongoDB. Its SQL contents cannot be assumed empty or safely discarded; production inventory must determine whether it contains legacy, stale, duplicate, or otherwise relevant records.

### 3.2 Tenant MongoDB runtime data

Current tenant storage uses tenant-scoped documents and application-established trusted tenant context:

| Collection | Runtime purpose | Notable current behavior |
|---|---|---|
| `patients` | Patient demographics and lifecycle | `_tenantId` scoped reads/writes; patient-number unique index; three partial unique duplicate indexes using English strength-2 collation; index preflight before relevant writes. |
| `appointments` | Scheduling records | Tenant-scoped filtering, optimistic `version`, patient lookup, time-range and access-scope queries. |
| `encounters` | Clinical encounters | Tenant-scoped clinical records, diagnosis/service arrays, amendments, versioned metadata history. History is excluded from ordinary list projection. |
| `appointment_schedule_locks` | Scheduling contention guard | Tenant/resource unique key; lock documents are acquired and explicitly released. Do not assume process-crash expiry or TTL cleanup without further evidence. |

The client manager resolves the current `primary` connection reference from one configured MongoDB URI and then uses registered database names. Registry placement does not itself shard or route records across clusters. Existing code rejects routes with multiple placements. Provider, server version, production topology, database placement, and sharding remain unresolved in `TENANT_MONGODB_DEPLOYMENT_DECISION.md`.

### 3.3 Full SQL schema inventory and proposed MongoDB grouping

The proposed grouping below is a design starting point, not an approved physical topology. Preserve each record's existing ID and relationships; do not indiscriminately embed all related records.

| Group | Existing SQL models | MongoDB planning destination |
|---|---|---|
| Platform identity and authorization | `User`, `PlatformRole`, `PlatformPermission`, `UserPlatformRole`, `PlatformRolePermission` | Platform database: separate collections with unique keys and role/permission reference arrays or explicit assignment documents. Keep password hashes and token versions protected; never transfer plaintext credentials. |
| Sessions and refresh history | `PlatformSession`, `PlatformRefreshTokenHistory` | Platform database: separate collections or a bounded session aggregate. Preserve token-hash uniqueness, token-family lookup, expiry, revoke/compromise state, and atomic rotation/reuse handling. |
| Tenant and organizational structure | `Tenant`, `Facility`, `Branch` | Platform database, tenant-scoped IDs and explicit references. Cross-tenant facility/branch references must be rejected by guarded writes. |
| Membership, authorization, and staff scope | `TenantMembership`, `TenantPermission`, `TenantRole`, `TenantRolePermission`, `TenantMembershipRole`, `Staff`, `StaffRoleAssignment`, `StaffFacilityAssignment`, `StaffBranchAssignment` | Platform database. Retain assignments as independently queryable records or bounded arrays only after query/size review. Enforce tenant and user/membership/role scope in write workflows. |
| Healthcare catalogs and provider records | `Department`, `Specialty`, `Service`, `Doctor`, `DoctorDepartmentAssignment`, `DoctorSpecialtyAssignment` | Platform database or tenant metadata databases, to be decided. Preserve the existing independent Department and Specialty assignment semantics; organizational scope comes from Staff. |
| Scheduling policy | `FacilitySchedulingPolicy`, `FacilitySchedulingPolicyRevision` | Platform database. Store current policy separately from append-only revision records; preserve optimistic version checks, facility/tenant identity, timezone and rule snapshots. |
| Commercial catalog | `Plan`, `Feature`, `PlanFeature`, `Subscription` | Platform database. Preserve unique keys, quotas, lifecycle history, and the invariant that overlapping active subscription periods are prevented. |
| Tenant storage control plane | `TenantStorageTarget` | Platform database, but redesign secret/credential handling and routing references only through approved secret management. Do not store connection strings in documents. Preserve inactive/active and primary-switch workflow. |
| Audit and security | `PlatformAuditLog`, `PlatformSecurityEvent` | Platform database or dedicated audit store subject to retention, immutability, access, and residency decisions. Preserve idempotent event IDs, resolution state, actor/subject references, and security event metadata. |
| Encounter mutation ledger | `EncounterOperation` | Must be redesigned with the encounter/audit consistency model. Preserve deterministic operation identity, idempotency hash/fingerprint, PREPARED/CONFIRMED/NOT_APPLIED/AMBIGUOUS state, delivery attempts, and operator-review outcomes. |
| Legacy SQL Patient | `Patient` | Reconcile against active tenant `patients` documents; do not blindly append. Preserve the tenant and patient IDs where the record is authoritative, and document conflict/duplicate disposition. |
| Tenant clinical and operational data already in MongoDB | Existing `patients`, `appointments`, `encounters`, `appointment_schedule_locks` | Retain or move using a separately verified Mongo-to-Mongo plan. If moving targets, copy/index/validate per tenant and preserve downtime, write ownership, and rollback boundaries. |

This table covers all 36 Prisma models. The 21 enums must also be mapped to validated MongoDB fields/application contracts; MongoDB does not enforce Prisma enum constraints automatically.

## 4. Architecture assessment

### 4.1 Target architecture principles

1. **Separate platform and tenant data logically.** A platform database may hold global identity, authorization, tenant control plane, catalogs, subscriptions, and operational records. Tenant-specific clinical data may remain in tenant databases. Whether these share one cluster is an owner decision.
2. **Do not treat database-per-tenant as a security boundary by itself.** Every request must continue to derive tenant identity from trusted server context, reject caller-supplied tenant scope, and use tenant-scoped query filters or an equivalently strong routing guarantee.
3. **Choose references and embedding by access pattern, growth, and consistency—not by SQL table shape.** Keep independently growing or permission-sensitive objects separately queryable. Bound embedded arrays and document sizes; the encounter amendment/history arrays need an explicit growth/archival decision.
4. **Make invariants explicit.** Map every SQL FK, unique constraint, partial constraint, check, and transaction to MongoDB unique/partial indexes, conditional updates, transaction boundaries, or a documented application invariant plus reconciliation.
5. **Preserve stable IDs.** Existing UUID strings should remain stable unless a reviewed mapping explicitly proves no external/API/audit reference depends on them. Avoid generating new IDs during copy.
6. **Keep topology out of application assumptions.** Do not assume replica sets, sharding, cross-database transactions, global uniqueness, or multi-cluster atomicity until approved and proven against the selected deployment.
7. **Keep migration state and sensitive data protected.** Migration checkpoints should hold source/model/tenant/batch identifiers and counts, not unnecessarily duplicate PHI or password/token secrets. Use encrypted, access-controlled transport and temporary storage approved for the data classification.

### 4.2 Data-model and index concerns

- Recreate unique constraints for user email; role/permission codes; tenant slug; tenant-scoped names/codes; staff/membership assignments; patient number; subscriptions; storage target identity; and encounter operation IDs.
- Review each composite key in `schema.prisma`; simple single-field unique indexes are not substitutes for tenant-scoped compound indexes.
- Enforce cross-document relationships in transactional service methods or validated reference checks. MongoDB does not provide SQL-style foreign-key enforcement.
- Preserve exact comparison semantics. SQL collation and MongoDB collation are not automatically equivalent. Patient duplicate enforcement already depends on partial unique indexes and non-simple collation; the existing deployment decision explains that this does not establish shard-wide uniqueness for a sharded Patient collection.
- Preserve date semantics: SQL `DateTime @db.Date` for date of birth is date-only, while appointments, sessions, revisions, and audit events are instants. Define UTC conversion and date-only serialization explicitly.
- Preserve JSON rule/quota payload meaning and validation. Preserve integer versions and conditional-update semantics; avoid floating-point conversion for any future monetary or quota values if the source representation is exact.
- Define retention/TTL separately. Expiring sessions or locks by TTL can change behavior and must not be introduced without a policy and recovery review.
- Explicitly map enums, nullable fields, defaults, and Prisma-managed `updatedAt` behavior. MongoDB will not apply Prisma defaults or `@updatedAt` automatically.

### 4.3 Transaction and concurrency assessment

Runtime transactions are present in these areas; this is a repository inventory, not an exhaustive proof of every business invariant:

| Workflow | Existing SQL guarantee to preserve | MongoDB design question |
|---|---|---|
| Refresh-token rotation and reuse detection | Session row lock, token-history updates, family/session revocation semantics. | Atomic state transition across session and history; prevent concurrent reuse from issuing multiple valid rotations. |
| Failed-login tracking/lockout | Transactional update of failed attempts and lock state. | Atomic conditional increment and lock threshold; resist concurrent login races. |
| Tenant membership/role and owner assignment | Tenant row lock, active-tenant and actor checks, owner/role assignment consistency. | Uniqueness and single-owner guarantee under concurrency; transactions or single-document aggregate design. |
| Staff role/facility/branch assignment | Tenant, actor, staff and unit checks; SQL row locks and assignment uniqueness. | Atomic validation plus insert/delete; protect against facility/branch status changes racing assignment. |
| Branch, doctor, and staff workflows | Multi-record validations and writes with unique constraints. | Decide whether to transact, use conditional writes, or model as one bounded aggregate. |
| Scheduling-policy edit and revision | Current-version compare-and-set plus revision creation in one transaction. | Revision and current policy must not diverge; transaction or append-only event/projection design. |
| Subscription create/transition | Tenant/plan locks, active status validation, overlap check and write. | Prevent concurrent overlapping active periods; unique indexes alone may not express interval overlap. |
| Tenant storage activation/primary switch | Mongo index preflight then SQL transaction updates registry target states. | Mongo index DDL and registry state remain cross-system and non-atomic; preserve fail-closed activation and recoverable primary switch. |
| Encounter mutation and platform audit | Durable SQL PREPARED marker before tenant Mongo write; history evidence, idempotency, delivery retries and reconciliation. | Ledger, clinical write, audit delivery, and possible separate clusters need an explicit outbox/saga or proven common-cluster transaction model. |

Some SQL transactions use `SELECT ... FOR UPDATE` and explicit `ReadCommitted`. A standalone MongoDB deployment does not provide multi-document transactions. Replica-set or sharded transaction support is not an approval by itself: transaction scope, topology, retry semantics, write concern, and failure behavior must be tested. Avoid long-running transactions around bulk copy or user requests.

Phase 59 rechecked the complete transaction call-site inventory in these 13 repositories: `src/auth/repositories/platform-session.repository.ts`, `src/auth/repositories/platform-user.repository.ts`, `src/subscriptions/subscription.repository.ts`, `src/tenant/appointment-scheduling-policy.repository.ts`, `src/tenant/branch.repository.ts`, `src/tenant/doctor.repository.ts`, `src/tenant/tenant-membership.repository.ts`, `src/tenant/tenant-membership-role.repository.ts`, `src/tenant/tenant-role.repository.ts`, `src/tenant/tenant-staff.repository.ts`, `src/tenant/tenant-staff-role.repository.ts`, `src/tenant/tenant-staff-scope.repository.ts`, and `src/tenant/tenant-storage.activation.service.ts`. The detailed callsite-to-invariant replacement matrix is in `THANARAH_MONGODB_MIGRATION_DECISIONS.md`.

The appointment schedule lock collection uses a unique tenant/resource key and explicit release. The observed release path does not establish a time-based lease or crash cleanup; the migration must preserve current behavior initially and treat lock expiry/recovery as a separately reviewed design change.

### 4.4 Cross-store encounter consistency

Current encounter mutations span tenant MongoDB, SQL `EncounterOperation`, and SQL platform audit records. The code persists a durable PREPARED marker before starting a Mongo write, uses history as evidence, tracks idempotency, and exposes reconciliation states such as retry-safe, applied, and review-required.

Before implementation, owners and engineers must choose one of these tested designs:

- Keep operation marker and encounter mutation in a common MongoDB transactional boundary, then deliver platform audit through an idempotent outbox; or
- Use a documented saga/outbox workflow with durable state transitions and reconciliation when platform and tenant databases may be on different clusters; or
- Prove that all relevant collections share an approved deployment/transaction boundary and implement an equivalent atomic workflow.

Do not remove the ledger, reduce its state machine, or claim that a single MongoDB write makes this workflow atomic without demonstrating it under injected failures, retries, process restarts, and audit unavailability.

## 5. Data-transfer and cutover strategy

### 5.1 Preconditions and source of truth

1. Obtain owner approval for provider, server version, topology, data-residency region, sharding policy, transaction/write-concern requirements, security/compliance terms, and operating responsibility.
2. Inventory all production SQL databases and tenant MongoDB targets without exposing secret values. Record engine/version, row/document counts, bytes, indexes, tenant mappings, migration state, orphan counts, duplicate candidates, and known legacy data.
3. Design a record-level source-to-target map and disposition for every SQL model, enum, index, and legacy field. Identify authoritative data when SQL and Mongo contain the same logical patient/encounter/tenant reference.
4. Set approved backup retention, encryption/access controls, RPO/RTO, freeze duration, recovery owner, and rollback decision authority.
5. Use synthetic or appropriately de-identified data in development until the provider and data-handling approvals permit otherwise.

### 5.2 Recommended transfer pattern

Prefer a resumable, offline transfer under a controlled write freeze unless an approved low-downtime design is separately engineered:

1. Validate migration tooling and mapping against a production-like sanitized copy. Run a complete rehearsal, including failure/resume and restore.
2. Capture verified, encrypted, independent backups of the SQL source and every relevant Mongo source/tenant target. Record checksums, timestamps, engine/topology, and restore evidence.
3. Put the application in a planned maintenance/write-freeze state; drain in-flight mutations and background jobs. Confirm source writes are stopped and record a single cutover watermark/time.
4. Export in bounded, deterministic batches ordered by stable primary key. Keep a protected migration ledger with source model, tenant, high-water mark, batch identity, count, checksum, and state. Restarting a batch must be idempotent and must not create duplicate target records.
5. Load parent/global records before dependent assignments, and tenant metadata before records that reference it. Preserve IDs and exact timestamps; resolve tenant IDs, dates, enums, nullable values, JSON, and binary/long text according to the approved map.
6. Build target indexes after bulk loading where safe, then validate exact definitions. For unique constraints, run a conflict report before index creation; do not merge or delete records automatically to make an index pass.
7. Reconcile source and target counts/checksums per model and tenant; validate foreign-reference equivalents, required unique keys, duplicate rules, critical state transitions, and sampled/full-record comparisons based on data volume and risk.
8. Run application smoke and security/tenant-isolation tests against the target, including failover/readiness, refresh-token rotation/reuse, scheduling races, subscription overlap, storage activation, and encounter audit reconciliation.
9. Obtain named technical, security/compliance, product/data-owner, and operations sign-off before directing production traffic to MongoDB.
10. Keep the SQL source write-frozen and recoverable for the approved observation period. Retire only after explicit acceptance of all gates in Section 8.

No CDC, dual-write, or reverse-replication capability is evidenced in the repository. If a short write-freeze window is required, design and validate a separate change-capture/outbox plan; do not improvise dual writes during cutover.

### 5.3 Patient reconciliation

The schema contains SQL `Patient`, while runtime Patient records are already tenant MongoDB documents. Treat this as a reconciliation problem, not a simple table copy:

- Determine whether SQL Patient rows exist and whether each tenant Mongo target is authoritative.
- Match using stable tenant and patient IDs first. Use patient number and normalized identity only to identify candidates, not as permission to merge automatically.
- Report unmatched, conflicting, duplicate, and one-to-many cases separately. Preserve both source records until an authorized disposition is recorded.
- Keep Mongo duplicate-prevention behavior and all three existing identity rules intact; validate target index definitions before enabling writes.
- Never delete SQL or Mongo Patient data solely because a record is absent from the other store.

### 5.4 Backup and recovery approach

- Maintain independent, encrypted backups of SQL and Mongo sources before migration and throughout the rollback window.
- Back up platform/control-plane and tenant clinical data with coordinated timestamps or an application write freeze. Cross-cluster backups do not become atomic simply because they are created close together.
- Document restore order, credentials/roles via approved secret handling, index rebuild behavior, registry/primary-target recovery, and how to handle writes made after cutover.
- Perform restore drills into isolated infrastructure and measure RPO/RTO; record actual durations and integrity checks.
- Do not treat replication, snapshots, a disposable test artifact, or a successful export as a backup until restoration and reconciliation have been demonstrated.

### 5.5 Rollback boundary

Before any production writes are accepted by MongoDB, rollback may be a controlled routing reversal to the unchanged, write-frozen SQL source after verifying the source snapshot and application compatibility.

Once MongoDB accepts new production writes, reverting the connection setting alone is unsafe: SQL is stale. Rollback then requires one of:

- An approved, tested reverse-transfer/replay mechanism with conflict resolution and a defined write owner; or
- Restoring the pre-cutover state and accepting a formally approved recovery point/data-loss decision.

There must be one authoritative writer at a time. Do not run independent writes to both stores without an idempotent, reconciled replication design.

## 6. Phased roadmap and exit gates

| Phase | Work | Exit gate |
|---|---|---|
| 0 — Owner decisions | Approve provider, version, topology, residency, sharding, transaction model, compliance terms, backup/RPO/RTO, freeze window, and operating owner. | Written decisions; unresolved items are blockers, not assumptions. |
| 1 — Production inventory | Read-only inventory of every SQL source and Mongo tenant target; counts, sizes, data quality, legacy Patient overlap, indexes, dependencies and data classification. | Signed inventory and source-of-truth map with no unexplained high-risk records. |
| 2 — Target design | Mongo data model, IDs, collections, tenancy, unique indexes, relationship validation, transactions/outbox, retention, migrations and operations. | Architecture/security review; every SQL invariant mapped and topology-specific concerns resolved. |
| 3 — Tooling and test | Build migration tooling, dry run, resumability, idempotency, backups, reconciliation and failure injection. | Rehearsal passes from clean restore and injected interruption; no production writes. |
| 4 — Performance and resilience | Load, query/index, transaction contention, restore, failover, backup, audit reconciliation and isolation tests against the approved topology. | Measured capacity/latency and recovery meet approved objectives; no standalone-only assumptions. |
| 5 — Production rehearsal | Repeat with fresh production-like snapshot and named operators; validate maintenance window, communications, freeze, cutover and rollback. | Runbook, checksums, approvals, operator roles and stop conditions accepted. |
| 6 — Controlled cutover | Freeze writes; back up; transfer; build/verify indexes; reconcile; switch the sole writer; smoke test and monitor. | All checks pass and authorized owners accept the new system. Otherwise remain frozen and execute the pre-write rollback path. |
| 7 — Observation and retirement | Keep SQL isolated/read-only and recoverable; monitor critical workflows and reconcile; then archive/decommission under retention policy. | All retirement gates in Section 8 signed and retention/deletion obligations satisfied. |

## 7. Open owner decisions

No answer is inferred by this assessment.

1. Which MongoDB provider, supported server version, topology, and data-residency region are approved?
2. Are tenant databases or collections allowed to be sharded? If yes, what exact ordered shard key and unique-index strategy are approved?
3. Can platform and tenant data share one cluster/replica set, or may tenant targets be separate clusters?
4. Which multi-document transaction and write-concern guarantees are required and supported?
5. What are approved backup/retention, RPO/RTO, BAA/healthcare terms, audit retention, and incident ownership?
6. What production counts, tenant count, duplicate/conflict baseline, and legacy SQL Patient disposition are required?
7. What maximum maintenance/write-freeze window is acceptable? If it is shorter than offline transfer needs, who approves the change-capture design?
8. How long must SQL remain read-only and recoverable after cutover, and who authorizes final retirement?

## 8. SQL retirement gates

Do not retire, delete, or revoke access to the SQL source until all are true:

- [ ] All 36 SQL models and 21 enums have an approved disposition; there are no unexplained tables, migration-only data, or seed/catalog records.
- [ ] Production source counts and target counts reconcile by model and tenant; discrepancies have signed dispositions.
- [ ] All foreign-reference equivalents, unique constraints, tenant-scoped constraints, and critical query indexes are verified on the approved topology.
- [ ] SQL Patient records have a documented reconcile/retain/archive disposition; no patient data was silently discarded or merged.
- [ ] Authentication, role changes, session rotation/reuse, tenant isolation, scheduling, subscriptions, storage registry/activation, audit/security, and encounter recovery tests pass.
- [ ] Encounter operation and audit delivery can be reconciled with no missing, duplicated, ambiguous, or unowned operations.
- [ ] Backup restore and rollback/recovery drills meet approved RPO/RTO and have named owners.
- [ ] Application configuration and operational runbooks no longer require SQL for runtime, readiness, scheduled jobs, administration, or support.
- [ ] SQL has remained read-only for the approved observation period; no unexpected reads/writes or dependent reports/jobs remain.
- [ ] Security, compliance, data owner, operations, and product owners have signed off on retention, archive, and deletion obligations.
- [ ] Final retirement is authorized; retained backups and legal/contractual retention requirements are handled before any irreversible deletion.

## 9. Repository references

- `prisma/schema.prisma`, `prisma/migrations/` — SQL schema, enums, constraints and migration history.
- `src/database/prisma.service.ts`, `src/config/env.schema.ts` — central database dependency, readiness and configuration validation.
- `src/auth/repositories/`, `src/auth/services/` — user, login, session and refresh-token workflows.
- `src/tenant/*.repository.ts`, `src/subscriptions/subscription.repository.ts` — SQL control-plane workflows and transactions.
- `src/platform-security/` — audit and security event persistence.
- `src/tenant/mongo-tenant-*.storage.ts`, `src/tenant/tenant-mongo-client.manager.ts`, `src/tenant/tenant-storage.*` — current tenant Mongo data paths and routing.
- `src/tenant/encounter.service.ts` — encounter operation marker, idempotency, audit delivery and reconciliation.
- `TENANT_MONGODB_DEPLOYMENT_DECISION.md` — unresolved provider/topology and Patient index limitations.
- `MIGRATION_IMPACT_REPORT.md` and recovery test artifacts — historical assessment and disposable recovery evidence; not production approval or automated backup evidence.

