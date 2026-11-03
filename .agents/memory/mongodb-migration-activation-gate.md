---
name: MongoDB migration activation gate
description: The safety conditions for testing and activating Mongo persistence candidates in Thanarah.
---

Keep every Mongo adapter unregistered until its individual behavior and dependent transaction parity are proven. Use disposable synthetic fixtures for Mongo testing; do not access production, transfer data, or switch active persistence as part of parity work.

**Why:** the user authorized the migration work while requiring the existing Prisma/MySQL path to remain active until behavior and transaction guarantees are evidenced.

**How to apply:** treat replica-set tests as candidate evidence only. Require port-specific contract tests, source-database differential evidence, and dependent transaction/race/failover tests before considering registration or cutover.
