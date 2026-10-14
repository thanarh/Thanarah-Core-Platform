---
name: Patient duplicate index enforcement
description: The persistence and deployment constraints behind atomic tenant Patient duplicate protection.
---

Patient duplicate protection uses tenant-scoped partial compound unique indexes for the three established identity rules. Do not assume the runtime Mongo URI provides transaction-capable topology; do not replace the indexes with claims unless crash recovery and reservation lifecycle are fully guaranteed.

Thanarah does not yet have a documented production MongoDB topology or shard-key pattern for tenant Patient collections.

For the Patient-number index, MongoDB 7.0.17 omits `collation` from `listIndexes` when the effective collation is the default simple collation. An explicit canonical `{ locale: 'simple' }` is equivalent; an inherited non-simple collection collation must fail readiness. **Why:** Patient-number matching is case-sensitive, and omitted metadata is not evidence of an incompatible index. **How to apply:** test both metadata forms and verify non-simple collection defaults against the disposable MongoDB version; do not extrapolate to an unapproved production profile.

**Why:** Runtime configuration accepts a generic MongoDB URI, while a standalone MongoDB is used for disposable integration tests. Unique indexes enforce races directly without transactions or stale-claim recovery.

**How to apply:** Provision and verify the required indexes before enabling Patient writes. Every uniqueness key must keep the logical tenant key first. If the target topology cannot create and enforce those indexes (including a sharded layout with incompatible shard-key requirements), fail closed. Create and verify replacements before removing legacy non-unique duplicate indexes; never auto-merge or delete conflicting patients.
