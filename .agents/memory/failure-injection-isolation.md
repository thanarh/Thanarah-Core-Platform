---
name: Failure-injection isolation
description: Keep disposable database failure tests bounded and prevent injected faults leaking into later tests.
---

Database failpoint tests must clear the server-side failpoint in a `finally` block, and their timeout must account for the database driver's own selection/retry timeout. Run independent outage requests concurrently when that preserves the scenario, rather than letting each consume a full driver timeout serially.

**Why:** A sequential MongoDB outage probe exceeded Vitest's default timeout and left the server failpoint active long enough to make unrelated following integration cases fail.

**How to apply:** When injecting database errors, use disposable infrastructure, bound the total operation time, reset the fault even on assertion failures, and verify a normal request succeeds after reset before continuing.
