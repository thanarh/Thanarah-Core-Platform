# Phase 66 — Repository Migration Architecture

**Date:** 2026-11-01
**Status:** Read-only repository audit and migration design. No active repository was switched, no production data was accessed, and no migration was run.

## Executive decision

The current application remains MySQL/MariaDB-backed for central platform and tenant control-plane persistence. Tenant clinical storage already has MongoDB adapters, but that does not make the central repositories MongoDB-compatible. The Phase 65 platform MongoDB implementation is an isolated optional foundation and is not injected into authentication, authorization, tenant management, subscriptions, audit, or other live workflows.

**Migration readiness: NO-GO. Phase 67 must not begin implementation or cutover until the blockers in this report are resolved.** Phase 66 establishes the current inventory and a proposed boundary; it does not implement a replacement persistence layer.

## Current repository boundary

- Prisma/MySQL owns central platform identity, sessions, role catalogs, tenant/control-plane entities, subscriptions, audit/security records, tenant storage registry, and the encounter operation ledger.
- Tenant MongoDB adapters own tenant patient, appointment, encounter, and scheduling-lock records. Routing uses the existing trusted tenant context and storage registry.
- Prisma still contains a `Patient` model, but runtime patient operations use the tenant storage contract. Treat this as a legacy/source-of-truth reconciliation question, not evidence that patient records are currently stored centrally.
- Phase 65 platform Mongo repositories are separate and unused by application traffic.

## Port boundary to implement before any adapter replacement

Services should depend on domain-specific persistence ports, not Prisma repositories or MongoDB repositories. Ports should preserve meaningful operations such as conditional status transitions, scoped membership lookup, session rotation, and schedule-policy revision updates; avoid a generic CRUD layer that hides the current invariants.

The target port groups are:

1. Identity and authentication: platform user, authorization catalog/assignment reads, session and refresh-token lifecycle.
2. Tenant control plane: tenant, membership, tenant roles and grants, staff, staff roles/scopes, facilities, branches, doctors and catalog assignments.
3. Platform catalogs and commercial state: plans, features, plan-feature configuration, subscriptions, entitlements and quota reads.
4. Security and operational records: platform audit, security events, tenant storage registry/activation, encounter operation ledger.
5. Tenant clinical storage: keep the existing tenant-scoped storage interfaces separate; require `TrustedTenantContext` on tenant data operations and fail closed when it is absent or invalid.

Ports must define the outcomes of duplicate writes, stale-state compare-and-set, not-found results, retryable dependency failures, and uncertain acknowledgements. Transaction-bearing operations need an explicit unit-of-work/session boundary or a reviewed aggregate/command protocol. Do not let a controller select a database implementation. The current health controller directly calls `PrismaService.isReady()`; move readiness behind an application-facing readiness port/service before treating the controller boundary as complete.

**Implementation status:** The repository audit found no general port layer for the active central repositories. Existing classes are concrete Prisma-backed repositories and most consuming services inject those concrete classes. This phase intentionally did not introduce partial port wiring that could be mistaken for a complete migration boundary. The Phase 67 prerequisite is a complete typed port/provider refactor, verified to preserve behavior, while keeping Prisma as the only active adapter.

## MongoDB adapter contract

Each future Mongo implementation must be mapped to the SQL behavior before it is activated:

- Preserve UUID string identifiers unless a separately approved data contract changes them. Do not convert to ObjectId implicitly.
- Encode each SQL unique and composite key with exact ordered indexes; validate nullable-unique semantics and collation against the actual source database.
- Replace foreign-key checks with explicit reference validation and consistency repair/monitoring. MongoDB does not provide relational foreign keys.
- Use conditional single-document updates for compare-and-set behavior. Use replica-set transactions only where the full operation needs multi-document atomicity and the approved topology supports it.
- Translate duplicate-key conflicts into the same domain-level outcomes as SQL uniqueness violations. Never treat every database error as a duplicate.
- Retry only operations with proven idempotency. Treat a lost acknowledgement after commit as uncertain until operation status is recovered; do not blindly replay.
- Keep audit and encounter side effects inside an approved transaction/outbox/saga design. Do not claim atomicity across separate tenant and central clusters.
- Keep central platform data separate from tenant healthcare collections. Do not infer routing, sharding, or tenant placement from a platform repository.

## Existing runtime and safety boundary

No production database was queried, and no secret values were read. The current configured workflow runs the Nest application; `prisma/schema.prisma` declares MySQL and `DATABASE_URL`. Development scripts deliberately resolve `MYSQL_DATABASE_URL`; bootstrap scripts are explicit development operations. The source tree has no scheduled job/cron registration. Do not add dual-write, shadow-write, live Mongo selection, startup index provisioning, or an automatic SQL fallback as part of a port refactor.

## Exit criteria

Before a Mongo adapter can replace any central repository: land complete ports and Prisma bindings; map all SQL constraints and side effects; obtain the transaction, collation, retention, topology, residency/compliance and operations decisions; pass adapter contract and failure-injection tests on approved disposable topology; and rehearse transfer, reconciliation, rollback and restore. Owner sign-off remains mandatory.
