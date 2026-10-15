---
name: MySQL index names
description: Keep verbose Prisma-generated index names within MySQL identifier limits.
---

Use explicit concise Prisma `map` names for indexes or constraints whose generated names are long, and verify the migration against MySQL rather than relying only on schema validation.

**Why:** disposable MySQL rejected a generated composite index identifier longer than its 64-character limit even though Prisma schema validation succeeded.

**How to apply:** map long composite indexes, unique constraints, and foreign keys to short stable identifiers before testing migrations against the target MySQL version.
