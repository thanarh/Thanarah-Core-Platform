---
name: MongoDB migration activation gate
description: The safety conditions for testing and activating Mongo persistence candidates in Thanarah.
---

The user now requires MongoDB for the entire platform, superseding the earlier hybrid target. Keep incomplete Mongo adapters unregistered until their individual behavior and dependent transaction guarantees are proven. Use disposable synthetic fixtures for testing; the architectural decision alone does not authorize production access or production data transfer.

**Why:** replacing the storage target must not weaken authorization, transaction consistency, or recovery guarantees. Earlier instructions to retain MySQL describe the historical safety baseline, not the current product target.

**How to apply:** require port-specific contract and dependent transaction/race/failover tests before activation, preserving established behavior. Existing MySQL behavior and disposable differential tests may inform contracts, but do not request a persistent MySQL connection as a product prerequisite. Production cutover still needs separate authorization.

Refresh rotation needs a concurrent same-token test in addition to sequential rotation/replay coverage; the competing requests must demonstrate the intended reuse/compromise result rather than only successful commit behavior.

**Why:** a sequential replay test does not exercise the race where two requests both discover the same token as current.

**How to apply:** for any refresh-token persistence candidate, run simultaneous rotations using the same presented hash against a disposable replica set and assert both results plus the final session and token-history state.

When translating Mongo errors inside a transaction-backed repository, convert duplicate-key errors to the repository's safe conflict error inside the transaction callback. The shared transaction boundary sanitizes unknown callback errors, so translating them only after it returns loses the duplicate-key signal.

**Why:** duplicate audit IDs were surfaced as generic storage unavailability when the transaction manager sanitized the driver's duplicate-key error before repository-level translation.

**How to apply:** catch and translate known Mongo error codes at the operation site inside `withTransaction`; let the manager sanitize only genuinely unexpected failures.
