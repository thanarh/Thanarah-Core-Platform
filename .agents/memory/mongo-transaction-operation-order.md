---
name: Mongo transaction operation order
description: Avoid parallel collection operations on one MongoDB transaction session.
---

Within a MongoDB transaction, issue database operations sequentially on the shared session; do not use `Promise.all` for transaction-bound reads or writes.

**Why:** the Node MongoDB driver does not support parallel operations in a transaction. A parallel pair of reference reads caused the membership transaction to fail, and the transaction manager sanitized the underlying error as storage unavailability.

**How to apply:** inspect every `withTransaction` callback and helper it invokes. Keep only non-transactional independent I/O parallel; preserve serial session use for transaction work.
