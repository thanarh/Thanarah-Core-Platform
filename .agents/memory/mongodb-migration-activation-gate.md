---
name: MongoDB migration activation gate
description: The safety conditions for testing and activating Mongo persistence candidates in Thanarah.
---

Keep every Mongo adapter unregistered until its individual behavior and dependent transaction parity are proven. Use disposable synthetic fixtures for Mongo testing; do not access production, transfer data, or switch active persistence as part of parity work.

**Why:** the user authorized the migration work while requiring the existing Prisma/MySQL path to remain active until behavior and transaction guarantees are evidenced.

**How to apply:** treat replica-set tests as candidate evidence only. Require port-specific contract tests, source-database differential evidence, and dependent transaction/race/failover tests before considering registration or cutover.

Refresh rotation needs a concurrent same-token test in addition to sequential rotation/replay coverage; the competing requests must demonstrate the intended reuse/compromise result rather than only successful commit behavior.

**Why:** a sequential replay test does not exercise the race where two requests both discover the same token as current.

**How to apply:** for any refresh-token persistence candidate, run simultaneous rotations using the same presented hash against a disposable replica set and assert both results plus the final session and token-history state.
