---
name: Mongo-only runtime dependency boundary
description: Why avoiding a Prisma provider alone does not prove the running app is SQL-independent.
---

Prove the Mongo-only runtime without loading generated Prisma classes or the
SQL client, not merely by checking that PrismaService is absent from Nest.

**Why:** A legacy repository imported as a dependency-injection token still
loads its SQL dependencies even when the token resolves to a Mongo instance.
Generated enum imports can load the same client without issuing any queries.
Checking only the provider registry misses both cases.

**How to apply:** Keep historical SQL implementations outside the application's
runtime import graph. Use persistence-port tokens, Mongo implementations and
storage-independent domain values/contracts. A compiled application check
should reject generated SQL modules in the module cache before and after a
restart; historical test-only dependencies can remain separate.
