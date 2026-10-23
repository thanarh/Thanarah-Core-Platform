---
name: Failure-injection isolation
description: Keep disposable database failure tests bounded and prevent injected faults leaking into later tests.
---

Database failpoint tests must clear the server-side failpoint in a `finally` block, and their timeout must account for the database driver's own selection/retry timeout. Run independent outage requests concurrently when that preserves the scenario, rather than letting each consume a full driver timeout serially.

**Why:** A sequential MongoDB outage probe exceeded Vitest's default timeout and left the server failpoint active long enough to make unrelated following integration cases fail.

**How to apply:** When injecting database errors, use disposable infrastructure, bound the total operation time, reset the fault even on assertion failures, and verify a normal request succeeds after reset before continuing.

For owner-token locks, record the attempted owner before issuing the insert so cleanup can remove a lock whose insert may have committed before its acknowledgement failed. If MongoDB definitively reports a duplicate key, remove that attempted owner from the cleanup list; otherwise cleanup can report an outage or disturb failure handling for a lock this request never owned.

**Why:** MongoDB write-concern errors can leave the caller uncertain about whether a lock insert persisted, while duplicate-key errors definitively mean the competing owner's lock must remain untouched.

**How to apply:** Track uncertain writes by their unique ownership token before sending them, and release only with an owner-scoped filter. Test both acknowledged duplicate acquisition and an injected write-concern failure.
