# Thanarah — MongoDB Migration Decisions and Owner Questions

**Phase:** 59 — decision record
**Status:** Owner decisions pending; this document proposes choices and records consequences without choosing for the owner.
**Date:** 2026-10-28

## 1. Repository facts that constrain decisions

- The central Prisma schema is MySQL and has 36 models, 21 enums, and 29 migration directories.
- MySQL/MariaDB currently stores platform identity/authentication, sessions, platform and tenant authorization, tenant/control-plane data, catalogs, subscriptions, storage registry, audit/security events, and the encounter operation ledger.
- Patient, appointment, encounter, and scheduling-lock data already use tenant MongoDB storage. SQL `Patient` remains in schema/migrations; its production data status is unknown.
- The tenant Mongo client currently resolves one `primary` connection reference from one configured URI. Routes with multiple placements are rejected; there is no automatic routing, sharding, or rebalance behavior.
- Existing SQL multi-document transactions and `FOR UPDATE` usage span login lockout, refresh rotation, membership and role changes, staff/doctor/resource assignments, branches, policy revisions, subscriptions, and storage-target switches.
- Current tenant MongoDB test infrastructure is standalone MongoDB 7.0.17. It does not establish production transaction capability or topology.
- No production database was accessed for this decision record.

## 2. Deployment option comparison

These are architecture categories, not provider recommendations or quotes. Exact product capabilities, current prices, regional availability, service terms, BAA, backup features, and limits must be verified with the chosen provider before approval.

| Option | Transactions and consistency | Backups / recovery | Networking and residency | Availability / operations | Cost consequences |
|---|---|---|---|---|---|
| Self-managed standalone MongoDB | No multi-document transactions. Existing transaction-dependent workflows must be redesigned and proven; otherwise unsuitable for parity. | Backup, encryption, restore drills, monitoring and version upgrades are fully owner-operated. | Maximum placement/network control, but TLS, firewalling, credentials and host security are owner responsibilities. | One server is a single failure domain; owner handles all operational response. | Lowest initial infrastructure footprint can mean high staff and outage cost. Not a safe production default for current transaction assumptions. |
| Self-managed replica set | Supports multi-document transactions subject to supported server version and correct configuration. Transaction scope is limited to that replica set; it does not make cross-cluster work atomic. | Owner designs independent backups, retention, restore, key recovery and point-in-time objectives. Replication is not backup. | Flexible regions and private network patterns, all configured and audited by owner. | Owner operates elections, upgrades, capacity, monitoring, security patches and failover drills. | Infrastructure and ongoing on-call/engineering costs; capacity and resilience can be tuned but require expertise. |
| Managed replica set / managed cluster | May provide replica-set transaction capability; verify exact server version, transaction limits, write concern and failover semantics. Different clusters remain separate atomicity boundaries. | Backup options vary by tier/region/contract. Verify restore guarantees, retention, export limits, encryption, and actual RPO/RTO. | Verify region, private connectivity, IP policies, TLS, key-management, data residency and service access controls. | Provider handles some infrastructure tasks, but application, index, backup policy, cost monitoring and incident response remain owner responsibilities. | Recurring service, storage, I/O, backup, network/egress and support costs. Compare projected production load and restore needs, not just entry tier. |
| Managed sharded cluster | Can scale horizontally, but adds shard-key and transaction complexity. Unique indexes must satisfy shard-key rules; current Patient duplicate indexes use non-simple collation and do not establish sharded global uniqueness. | Backup/restore and resharding behavior are provider/tier dependent; prove tenant-level restore and cross-shard recovery. | Region and network features vary. Confirm all shards/config servers and backups meet residency/security obligations. | More components and operational controls; sharding does not automatically improve a poorly indexed or low-volume workload. | Usually greater minimum cost and operations complexity; may add cross-shard transaction/query overhead. No production scale evidence here justifies selecting it. |

**Topology implication:** A single standalone server is not proven capable of preserving current multi-document SQL transaction behavior. A replica set is the direct MongoDB transaction option, but a replica set is not an owner decision in this repository. A sharded deployment also needs a deliberate key and unique-index redesign, especially for Patients.

## 3. Decisions requiring owner answers

Record one answer, decision owner, evidence, and date for every item before implementation begins.

| Decision | Choices / consequence | Current status |
|---|---|---|
| Provider and commercial terms | Choose a provider only after security, support, terms, service capability, price model, and contracting review. Provider-specific BAA and healthcare terms must be independently confirmed where applicable. | **PENDING — no provider selected.** |
| Server version | Approve a supported production version and upgrade policy; test driver compatibility, index behavior, transactions, backups and restore against it. Test image `7.0.17` is not production approval. | **PENDING — no production version approved.** |
| Topology | Standalone requires redesign of multi-document atomic workflows; replica set supports transaction-based design; sharded cluster adds shard-key/unique-index requirements. | **PENDING — no topology approved.** |
| Sharding | Keep tenant Patient collections unsharded, or approve exact shard key and replace/prove a shard-compatible duplicate-enforcement design. `_tenantId` leading an index is not evidence it is the shard key. | **PENDING — shard policy/key not documented.** |
| Physical placement | One cluster for platform and tenant data simplifies some transaction boundaries; separate clusters improve isolation/placement flexibility but create cross-cluster consistency constraints. | **PENDING — no cluster layout approved.** |
| Replica-set and transaction support | Decide if workflows will use transactions or be redesigned with single-document atomic patterns/outbox/sagas. Transactions across distinct clusters are not assumed. | **PENDING — no production guarantee.** |
| Tenant multi-database routing | Preserve registry/resolver; allow explicit static domain placements per tenant, each resolving to approved connection-reference aliases. No automatic data sharding, fan-out, rebalance, or copy. | **PROPOSED — requires architecture approval.** |
| TLS/network/access | Require TLS validation and least-privilege credentials; decide private network/connectivity, source allowlist, rotation and emergency access. | **PENDING — production settings not evidenced.** |
| Data residency and healthcare review | Choose permitted region(s); confirm contractual BAA/healthcare terms and regulatory/security obligations with qualified owners. This assessment makes no compliance claim. | **PENDING — no approval evidenced.** |
| Backup/retention/RPO/RTO | Approve independent backup type/frequency, retention, encryption/key custody, restore access, RPO/RTO, and restore-drill cadence. | **PENDING — production policy unknown.** |
| Maintenance/cutover | Accept an offline write freeze or fund a separate CDC/outbox design. Repository evidence does not provide change capture or safe dual writes. | **PENDING — freeze window unknown.** |
| SQL retention/retirement | Approve observation period, archive/retention duties, deletion owner, and explicit final retirement authorization. | **PENDING — no duration/owner.** |

## 4. Consistency decision matrix

The exact SQL transaction call sites were rechecked in the current repository. For each multi-document behavior below, a MongoDB transaction-based replacement requires a transaction-capable replica set (or supported sharded cluster). A standalone target is not equivalent. A non-transaction alternative is acceptable only after it has a formal invariant, race/failure analysis, and concurrency/failure-injection test.

| Existing transaction callsite | Existing invariant | Proposed MongoDB replacement | Replica set required? |
|---|---|---|---|
| `src/auth/repositories/platform-user.repository.ts` — `recordFailedLogin` | Atomic failed-attempt increment and lock threshold. | Atomic update of the single `platform_users` document using update pipeline/conditional filter; verify threshold and reset races. | **No** if fully single-document and proven. |
| `src/auth/repositories/platform-session.repository.ts` — `rotateAtomically`, `rotateByRefreshTokenHash`, `markReuseDetected` | Session lock, token history creation/update, rotation, reuse detection and compromise/revocation behavior. | Preferred: transaction over session + refresh-history collections, with deterministic history hash unique key and session-first serialization. Alternative: bounded session aggregate with embedded history and a single-document CAS, only if growth and access contract are approved. | **Yes** for separate-collection transaction. Alternative can avoid it only after redesign/test. |
| `src/tenant/tenant-membership.repository.ts` — `changeStatusIfCurrent` | Lock tenant; compare expected membership state; update status coherently. | Transaction over tenant/membership, or versioned tenant-scoped membership transition with a proven tenant gate that prevents deactivation/role races. | **Yes** for transaction design; otherwise redesign/test. |
| `src/tenant/tenant-role.repository.ts` — `replacePermissions`, `bootstrapInitialOwner` | Replace full permission set atomically; tenant lock, active member, no pre-existing owner, bootstrap default roles/grants. | Transaction across role/permission assignments and tenant/owner guard, or versioned whole-permission-set document plus transactional owner bootstrap. | **Yes** for multi-document transaction. |
| `src/tenant/tenant-membership-role.repository.ts` — `assign`, `remove` | Active tenant and actor/target checks, role scope, owner protections and assignment write/delete. | Transaction across tenant, membership, role and assignment; alternatively a serialized tenant authorization command with compare-and-set/version and durable idempotency. | **Yes** for transaction design. |
| `src/tenant/tenant-staff.repository.ts` — `createForActiveMembership` | Active tenant, active membership and user checks under row locks, unique staff per tenant/user and creation. | Transaction across tenant, membership, user and staff; conditional single-document design must prove parent state cannot race. | **Yes** for transaction design. |
| `src/tenant/branch.repository.ts` — `createUnderActiveFacility` | Active tenant/facility parent lock and branch create. | Transaction over tenant, facility and branch or explicit parent version/lock protocol with atomic create and race tests. | **Yes** for transaction design. |
| `src/tenant/doctor.repository.ts` — create, update/status, and Department/Specialty assignment workflows | Lock active tenant, doctor, and catalog records; ensure tenant-scoped references and independent department/specialty assignment semantics. | Transaction for doctor and assignment updates; enforce compound unique keys and recheck state inside transaction. | **Yes** for multi-document transaction. |
| `src/tenant/tenant-staff-role.repository.ts` — `assign`, `remove` | Active tenant/actor, staff and role validity and assignment uniqueness. | Transaction across tenant, actor membership, staff, role, assignment; or serialized idempotent tenant command with proven state gating. | **Yes** for transaction design. |
| `src/tenant/tenant-staff-scope.repository.ts` — facility/branch assign/remove and scope changes | Active actor/tenant, eligible facility/branch, staff scope, parent lock, duplicate-safe insert/delete. | Transaction across tenant, actor, staff, facility/branch and assignment; unique compound indexes handle duplicate races but do not replace parent-state serialization. | **Yes** for transaction design. |
| `src/tenant/appointment-scheduling-policy.repository.ts` — `upsert`, `setStatus` | Compare `expectedVersion`, update policy version/status, create matching revision atomically. | Transaction over policy and revision; preserve version compare-and-set. Alternative append-only command log requires an approved projection/recovery design. | **Yes** for current separate-collection design. |
| `src/subscriptions/subscription.repository.ts` — `createForActiveTenantAndPlan`, `transition` | Lock tenant/plan; validate active state and prevent overlapping active periods; conditional lifecycle transition. | Transaction with tenant-scoped serialization, overlap query and insert/update. A unique index cannot alone enforce arbitrary interval non-overlap. | **Yes** for transaction design. |
| `src/tenant/tenant-storage.activation.service.ts` — `setTargetStatus`, `setPrimaryTarget` | Preflight Mongo indexes, recheck target identity, lock tenant, switch registry active/primary states atomically. | Keep Mongo DDL/preflight outside the metadata transaction; then transactionally switch target documents and explicit placement generation. Make target unavailable on any mismatch. | **Yes** for atomic multi-document registry changes. DDL and registry remain non-atomic. |

Additionally, current encounter mutations cross tenant MongoDB, SQL `EncounterOperation`, and platform audit. This is not solved by translating SQL transactions alone. Keep PREPARED-before-write, history evidence, idempotency, retry states, audit delivery and reconciliation. Use a common approved transaction boundary or a durable outbox/saga; separate clusters require explicit cross-store recovery.

## 5. Security and recovery design decisions

### Authentication and sessions

- Copy existing password hashes without transformation and verify through the existing password service. Never export plaintext; do not change the hash algorithm during data transfer.
- Preserve dummy-hash timing behavior, account status, lockout counter and lock deadline. Failed login uses atomic conditional update and bounded threshold.
- Keep raw refresh tokens only in the existing client/cookie channel. Store hashes only. Keep unique token-hash constraints and token-family identity.
- Concurrent refresh requests must produce one valid rotation; reuse of a rotated token must preserve current detection/compromise behavior. Test race, replay, timeout, failover and ambiguous acknowledgement.
- Keep session revocation and token-version changes effective across all authorization paths. Do not TTL-delete sessions/history until policy and audit dependencies are decided.

### Membership, roles, permissions, and scope

- Permission code catalogs remain canonical platform data; assignments remain tenant-scoped.
- Every membership, role, staff, facility and branch relationship must have matching tenant identity at write and read time.
- Preserve current system-role and single-owner protections. Revocation/status changes must become effective despite caches/tokens according to current token-version and authorization behavior.
- Department and Specialty assignments stay independent; Staff remains the source of organizational scope as described in project memory.

### Tenant activation and target selection

- Registration creates an inactive, non-primary placement.
- Operator provisioning creates and verifies exact collection indexes and required uniqueness before activating a target.
- Registry writes use a transaction/version guard to prevent two primaries for the same tenant/domain. Mongo index DDL cannot be atomic with registry metadata.
- Resolve only the server-approved active placement for the requested tenant/domain. Reject missing, inactive, mismatched or ambiguous routes with a fail-closed service-unavailable result.
- Multiple physical databases per tenant are explicit static placements. Moving data between them requires a controlled migration and must not be hidden inside ordinary reads/writes.

### Subscriptions, audit, security, and encounter recovery

- Preserve interval overlap checks under concurrent writes; use per-tenant transaction/serialization.
- Preserve audit event IDs and metadata, append-oriented access controls, security-event resolution state, and source `SetNull` relationship behavior where applicable.
- Keep encounter operation ledger semantics and reconciliation reachable. If operation markers live tenant-locally while platform audit is elsewhere, use an idempotent outbox with bounded retries and review-required state.
- Keep appointment lock unique key and explicit owner-token release. No TTL expiry is currently evidenced; introduce lease expiry only after defining stale-lock semantics and validating race safety.

## 6. Decisions that must be signed before implementation

- [ ] Provider, supported server version, topology, and contract/BAA status.
- [ ] Data-residency regions and regulatory/security review.
- [ ] Shard eligibility and exact shard key, or explicit unsharded policy.
- [ ] Replica-set transaction/write-concern and failover behavior.
- [ ] Platform/tenant cluster placement and multi-physical-database-per-tenant route model.
- [ ] TLS/network controls, least-privilege roles, credential rotation and access owner.
- [ ] Backup/retention, independent restore, key custody, RPO/RTO, and drill schedule.
- [ ] Write-freeze window or separately designed change-capture approach.
- [ ] Post-cutover rollback strategy, observation period, SQL archive/retirement owner.
- [ ] Production source inventory and signed SQL Patient reconciliation policy.

