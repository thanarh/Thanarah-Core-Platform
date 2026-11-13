---
name: Mongo cross-port locking
description: Limits of adapter-local lock documents used to emulate relational row locking.
---

A lock document in a private Mongo collection only serializes transaction paths that acquire the same lock. It does not coordinate parent-state changes performed by other adapters or collections that do not use that lock.

**Why:** The source MySQL subscription and branch workflows lock tenant/facility rows, while the Mongo candidates currently use adapter-specific lock documents or snapshot reads.

**How to apply:** Treat subscription overlap and initial-owner bootstrap locks as local safeguards, not proof of transaction parity. Before activation, establish a shared protocol or a storage-level invariant across every conflicting writer, including facility, tenant, plan, membership, and role changes.

A real reference-document write in the same transaction can force a conflict
with independent lifecycle writers that update that document. An unchanged
no-op update is not an adequate substitute.

**Why:** A disposable stale-snapshot test established a read, changed the actual
parent through an independent client, then attempted the reference write. The
driver retried the transaction and the now-inactive parent was rejected.

**How to apply:** Protect every reference whose concurrent lifecycle change
would invalidate the command, and retain snapshot reads for authorization.
This is a technique for coordinating specific writers, not proof that all
remaining candidates or cross-cluster workflows are safe.

Keep the actual tenant reference write as the common serialization point for
central tenant-scoped mutations, and touch additional eligibility references
such as users, memberships, facilities and plans in the same transaction.

**Why:** A lock owned only by the membership or subscription adapter cannot
conflict with independent tenant lifecycle writers. A tenant-document write
coordinates those writers without coupling them to private lock collections.

**How to apply:** Preserve this intentional coarse per-tenant coordination
when optimizing or refactoring. More granular locking needs equivalent race
evidence; snapshot reads alone are insufficient. This does not create atomic
transactions between the central store and a separate clinical cluster.
