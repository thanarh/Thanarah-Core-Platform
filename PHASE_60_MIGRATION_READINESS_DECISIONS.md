# Phase 60 — MongoDB Migration Readiness Decisions

**Status:** Owner decisions required; no provider or topology selected
**Date:** 2026-10-28

## 1. Decision summary

**Readiness decision: NO-GO for implementation and production migration.**

The project requires multi-document atomic behavior across several platform workflows. A transaction-based target therefore requires a transaction-capable replica set or supported sharded cluster. No such target is approved or available in the current workspace. The existing standalone test container is not suitable evidence for those guarantees. No Phase 60 MongoDB capability or restore tests were run.

## 2. Deployment choices to evaluate

| Candidate | When it could fit | Required proof / constraints | Main tradeoff |
|---|---|---|---|
| Self-managed MongoDB replica set | Owner needs direct control and has capacity to operate database infrastructure. | Approved supported server version; replica-set member/failure-domain design; TLS/private networking; user/role and key management; backups/restores; monitoring, patching and on-call plan; isolated failover tests. | Maximum operational control but owner carries all reliability, security and lifecycle work. |
| Managed MongoDB service | Owner wants provider-operated database infrastructure and the chosen service supports required topology and contractual controls. | Written confirmation of supported version, transaction/write-concern semantics, region, network controls, backup/restore, monitoring, BAA/healthcare terms where applicable, service limits, data export and current price model. Test exact selected tier/topology. | Lower infrastructure operations burden; recurring and variable service/network/support costs and provider-specific constraints. |
| Existing hosting infrastructure | May be acceptable only if it can supply or securely connect to a production-grade replica set and meet residency, network, backup, monitoring and support requirements. | Written technical capability and owner evidence. Current project workflow provides a NestJS app only; no MongoDB server/topology is configured. The schema’s cPanel comment is not proof that cPanel can safely operate the target. | Potentially simpler connectivity, but existing hosting may not provide database availability, recovery or operational controls. |

No exact cost comparison is possible without production counts, workload, region, availability, backup retention and current provider quotes. Owner procurement must compare total cost, including operations, support, backups, egress, recovery and compliance requirements.

## 3. Mandatory owner decisions

| Decision | Status | Acceptance evidence required |
|---|---|---|
| Provider and contract | **PENDING** | Named provider/service, approved terms, service owner, and healthcare/BAA review where required. |
| Supported server version | **PENDING** | Written supported version range, upgrade policy and tested driver compatibility. |
| Topology | **PENDING** | Standalone, replica set, or sharded topology explicitly approved. Any standalone proposal must include tested non-transaction replacements for every listed SQL invariant. |
| Replica-set and transaction guarantee | **PENDING** | Approved member/election layout, transaction scope, retry and write concern policy, and matching isolated test results. |
| Shard policy/key | **PENDING** | Explicit unsharded policy or exact ordered shard key with proof that all required tenant and unique indexes remain correct. |
| Platform/tenant placement | **PENDING** | Decide whether platform and tenant data share a cluster. Document cross-cluster encounter/audit outbox or saga if they do not. |
| Multiple physical databases per tenant | **PROPOSED, NOT APPROVED** | Explicit static placement records/routes per storage domain, secret-reference mapping, unique ownership and operator migration process. No automatic sharding, fan-out or rebalancing. |
| TLS/network/least privilege | **PENDING** | TLS certificate and hostname validation; private networking or allowlist; least-privilege runtime, migration and backup roles; credential rotation and audit evidence. |
| Residency and compliance | **PENDING** | Approved region and written security/legal/compliance review. This assessment does not claim certification or contractual coverage. |
| Backup and recovery | **PENDING** | Independent backup method, encryption, retention, restore drill, data ownership, approved RPO/RTO and recovery authority. |
| Cutover | **PENDING** | Approved write-freeze duration or separately funded/tested change-capture design; one-writer rule; rollback boundary; observation period. |
| Operational ownership | **PENDING** | Named on-call, database operations, security incident, restore and cost-monitoring owners. |

## 4. Required capability evidence before implementation

- [ ] Isolated replica-set environment available and approved; no production access or data.
- [ ] Server/driver version and TLS/least-privilege configuration match the proposed target profile.
- [ ] Multi-document transaction commit/abort and failover interruption tests pass.
- [ ] Exact ordered unique/partial index definitions and concurrent conflict behavior pass.
- [ ] Concurrent update and workflow race tests pass for authentication/session, membership/authorization, staff scope, doctor/catalog, policy, subscriptions, and storage registry.
- [ ] Majority write concern and retry behavior are explicitly selected and verified against failover.
- [ ] Encrypted backup restore passes count, checksum, index and invariant checks.
- [ ] Monitoring and alert evidence includes replica health, lag, transaction failures, connection pool, storage, index health, backup age and reconciliation backlog.
- [ ] Owner-approved capacity, latency, cost, RPO/RTO, data-residency and compliance evidence is documented.
- [ ] Encounter operation-ledger and audit outbox/recovery design passes interruption, duplicate delivery and operator-review tests.

## 5. Recommendation

Do not begin a migration tool or claim migration readiness yet. First obtain owner decisions in Section 3 and make the matching isolated replica-set test environment available. Then run the Phase 60 matrix from `PHASE_60_MONGODB_CAPABILITY_TEST_RESULTS.md`, update its results with actual evidence, and review the architecture and runbook gates before a separate implementation phase.

