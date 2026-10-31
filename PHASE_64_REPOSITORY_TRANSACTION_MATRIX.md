# Phase 64 — Repository Transaction Compatibility Matrix

**Date:** 2026-10-31
**Scope:** Review of the 13 Phase 59 SQL transaction/locking call sites against current source. No repository rewrites or migrations were performed.

## Current compatibility

The 13 call sites below are still implemented by Prisma/MySQL repositories. This repository contains no MongoDB implementation for these platform/control-plane transactions. Phase 64 tested the official MongoDB client and one existing tenant Patient storage adapter; it did not run these repositories against MongoDB. All rows therefore remain **NOT COMPATIBLE / NOT VERIFIED for MongoDB migration**.

| Current SQL repository and call site | Invariant to preserve | MongoDB requirement/design still to prove | Phase 64 evidence |
|---|---|---|---|
| `src/auth/repositories/platform-user.repository.ts` — `recordFailedLogin` | Failed-attempt increment and lock threshold/reset race | Prove an atomic single-document update/pipeline preserves threshold semantics under concurrent failures and resets. | Not tested in MongoDB; no adapter. |
| `src/auth/repositories/platform-session.repository.ts` — rotation and reuse detection | Session lock, token-history creation, rotation, reuse detection, compromise/revocation | Transaction across session/history collections, or separately approved bounded aggregate plus single-document CAS and growth contract. | Not tested in MongoDB; no session adapter. |
| `src/tenant/tenant-membership.repository.ts` — `changeStatusIfCurrent` | Tenant and expected membership state remain coherent under status races | Replica-set transaction or proven versioned tenant gate that prevents status/role races. | Not tested in MongoDB; Prisma/MySQL remains. |
| `src/tenant/tenant-role.repository.ts` — permission replacement and initial owner bootstrap | Atomic permission replacement; active-member and single-owner guard | Transaction across tenant, role/grant, and owner state, or approved versioned design with race tests. | Not tested in MongoDB; Prisma/MySQL remains. |
| `src/tenant/tenant-membership-role.repository.ts` — assignment/removal | Active tenant/member, role scope, owner protection, assignment uniqueness | Transaction or serialized idempotent authorization command with proven state gating. | Not tested in MongoDB; Prisma/MySQL remains. |
| `src/tenant/tenant-staff.repository.ts` — `createForActiveMembership` | Active tenant, membership and user checks plus unique staff creation | Transaction or single-document protocol proving parent state cannot race creation. | Not tested in MongoDB; Prisma/MySQL remains. |
| `src/tenant/branch.repository.ts` — `createUnderActiveFacility` | Active tenant/facility parent state and branch creation | Transaction or explicit parent-version/lock protocol with race tests. | Not tested in MongoDB; Prisma/MySQL remains. |
| `src/tenant/doctor.repository.ts` — doctor and catalog assignment workflows | Active parent checks; tenant references; independent Department/Specialty assignment semantics | Transaction for multi-document changes, with compound keys and in-transaction state rechecks. | Not tested in MongoDB; Prisma/MySQL remains. |
| `src/tenant/tenant-staff-role.repository.ts` — assignment/removal | Active tenant/actor, staff and role validity, uniqueness | Transaction or serialized idempotent tenant command with proven gating. | Not tested in MongoDB; Prisma/MySQL remains. |
| `src/tenant/tenant-staff-scope.repository.ts` — facility/branch scope changes | Active actor/tenant, eligible parent and staff scope, duplicate-safe changes | Transaction or an explicitly proven parent-state serialization protocol; unique keys alone are insufficient. | Not tested in MongoDB; Prisma/MySQL remains. |
| `src/tenant/appointment-scheduling-policy.repository.ts` — `upsert`/`setStatus` | Expected-version update and matching revision are atomic | Replica-set transaction over policy/revision, or approved append-only command log and recovery design. | Not tested in MongoDB; Prisma/MySQL remains. |
| `src/subscriptions/subscription.repository.ts` — create/transition | Active tenant/plan, conditional transition, no overlapping active periods | Transaction with tenant serialization and overlap check; a unique index alone cannot enforce arbitrary interval exclusion. | Not tested in MongoDB; Prisma/MySQL remains. |
| `src/tenant/tenant-storage.activation.service.ts` — target status/primary switch | Index preflight, target recheck, tenant lock, atomic registry primary switch | Keep Mongo DDL preflight separate; prove transactional metadata switch and placement generation on approved topology. | Not tested in MongoDB; Prisma/MySQL remains. |

## Additional cross-store gap

Encounter mutations also cross tenant MongoDB, SQL `EncounterOperation`, and platform audit. They are not one of the 13 SQL call sites above, but cannot be declared transaction-compatible by translating the SQL transactions alone. Preserve the existing PREPARED-before-write, operation ledger, idempotency, audit delivery, and reconciliation requirements in a separately tested outbox/saga or approved common transaction boundary.

## Decision

Do not claim MongoDB compatibility for these 13 repositories. No central platform MongoDB connection, repository session propagation, replacement repositories, or migration implementation was added. Required next evidence includes an approved topology, explicit transaction/session architecture, and repository-specific concurrency and failure-injection tests. Migration readiness remains **NO-GO**.
