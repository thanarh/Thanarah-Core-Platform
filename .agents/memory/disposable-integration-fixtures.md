---
name: Disposable integration fixtures
description: Keep database-backed integration tests independently runnable under name filters.
---

Each integration test that may be selected with a Vitest name filter must create the records it consumes within that test or in `beforeAll`, not depend on mutable globals initialized by another `it` block.

**Why:** Filtering a database-backed test skipped an earlier test that populated a shared patient ID, causing a misleading request-validation failure unrelated to idempotency.

**How to apply:** Use the shared seeded tenant, doctor, facility, and branch only when they are created in suite setup; create test-specific patient/encounter records inside the test that uses them.
