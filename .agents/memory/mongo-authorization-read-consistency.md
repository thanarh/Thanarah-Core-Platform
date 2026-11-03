---
name: Mongo authorization read consistency
description: Consistency requirement for MongoDB platform role and permission lookups.
---

Any MongoDB implementation of platform authorization must read user-role assignments, roles, role-permission assignments, and permissions within one snapshot-read transaction, passing the same session to every collection operation.

**Why:** The authorization query spans multiple collections; separate reads can observe a partial role grant or revocation and return a permission set that no single SQL join would produce. Mongo transaction support also requires a replica-set-capable target.

**How to apply:** Keep authorization candidates off live traffic until the snapshot/session behavior is verified against the isolated replica-set integration test. Do not substitute independent collection reads or infer parity from unit mocks.
