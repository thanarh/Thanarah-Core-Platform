---
name: Disposable integration fixtures
description: Keep database-backed integration tests independently runnable under name filters.
---

Each integration test that may be selected with a Vitest name filter must create the records it consumes within that test or in suite setup, not depend on mutable globals initialized by another `it` block. When extending a legacy journey that is not independently runnable, verify the complete suite and do not treat a filtered failure as evidence against the change.

**Why:** Filtered browser/integration runs can skip setup performed by an earlier test and fail before exercising the changed behavior, producing misleading request or authorization failures.

**How to apply:** Prefer self-contained fixtures and suite-level setup for shared immutable records. Until a legacy test is isolated, use the complete disposable suite as the acceptance check for changes inside that journey.

For Nest integration tests running with `NODE_ENV=development`, point `MYSQL_DATABASE_URL` at the disposable MySQL instance; `DATABASE_URL` is not the development source. Give the disposable database a name containing an explicit `test` token so the development URL policy accepts it.

**Why:** A Replit-managed `DATABASE_URL` may be PostgreSQL, while development rejects unmarked MySQL database names. Setting only `DATABASE_URL` or naming the database `phase30_<random>` leaves Prisma disconnected without making the test's intent obvious.

**How to apply:** When a disposable app reports that its central DB is disconnected, inspect both the config-selected env key and the safe database-name policy before investigating container connectivity.
