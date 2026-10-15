---
name: Additive scheduling migrations
description: Migration history rules for facility scheduling policy schema and permission changes.
---

Keep policy and audit schema changes, new permission catalog rows, and owner/admin grants in a follow-on migration rather than editing an older appointment migration. Catalog tests should assemble the relevant migration history cumulatively.

**Why:** deployment targets may already have recorded older migrations as applied; editing their contents changes checksums and can hide a required catalog update.

**How to apply:** when adding authorization capabilities after a feature foundation ships, add the permission and role grants in a new migration, then ensure migration-catalog tests inspect the new migration as well as earlier catalog data.
