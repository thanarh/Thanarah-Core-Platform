---
name: Mongo tenant event expiry
description: Mongo TTL indexes and application-side filtering for tenant event records.
---

Store Mongo TTL expiry values as BSON `Date`, not ISO strings. Query the same expiry field in reads so expired records are hidden before the asynchronous TTL monitor removes them.

**Why:** Mongo TTL indexes ignore strings, and TTL deletion is asynchronous; relying on the index alone can leave expired records readable or retained indefinitely.

**How to apply:** For any tenant-scoped event or audit collection with retention, write a Date-backed TTL field and filter reads by that field.
