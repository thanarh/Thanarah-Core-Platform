---
name: Mongo cross-port locking
description: Limits of adapter-local lock documents used to emulate relational row locking.
---

A lock document in a private Mongo collection only serializes transaction paths that acquire the same lock. It does not coordinate parent-state changes performed by other adapters or collections that do not use that lock.

**Why:** The source MySQL subscription and branch workflows lock tenant/facility rows, while the Mongo candidates currently use adapter-specific lock documents or snapshot reads.

**How to apply:** Treat subscription overlap and initial-owner bootstrap locks as local safeguards, not proof of transaction parity. Before activation, establish a shared protocol or a storage-level invariant across every conflicting writer, including facility, tenant, plan, membership, and role changes.
