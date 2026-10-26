---
name: Disposable integration fixtures
description: Keep database-backed integration tests independently runnable under name filters.
---

Each integration test that may be selected with a Vitest name filter must create the records it consumes within that test or in suite setup, not depend on mutable globals initialized by another `it` block. When extending a legacy journey that is not independently runnable, verify the complete suite and do not treat a filtered failure as evidence against the change.

**Why:** Filtered browser/integration runs can skip setup performed by an earlier test and fail before exercising the changed behavior, producing misleading request or authorization failures.

**How to apply:** Prefer self-contained fixtures and suite-level setup for shared immutable records. Until a legacy test is isolated, use the complete disposable suite as the acceptance check for changes inside that journey.
