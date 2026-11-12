---
name: MySQL index names
description: Keep verbose Prisma-generated index names within MySQL identifier limits.
---

Use explicit concise Prisma `map` names for indexes or constraints whose generated names are long, and verify the migration against MySQL rather than relying only on schema validation.

**Why:** disposable MySQL rejected a generated composite index identifier longer than its 64-character limit even though Prisma schema validation succeeded.

**How to apply:** map long composite indexes, unique constraints, and foreign keys to short stable identifiers before testing migrations against the target MySQL version.

Preserve existing custom SQL names with Prisma `map` metadata when a live migration-to-schema comparison shows naming-only drift; do not rename or recreate database constraints merely to match generated names.

**Why:** naming-only drift can make Prisma propose dropping and recreating otherwise equivalent foreign keys, even though no data-model change is needed.

**How to apply:** compare a freshly migrated disposable MySQL database with the Prisma model. If the only differences are names and the definitions match, align the model metadata with historical migrations and require an empty diff.
