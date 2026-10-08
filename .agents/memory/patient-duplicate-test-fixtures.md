---
name: Patient duplicate test fixtures
description: Avoid accidental conflicts between same-tenant Patient fixtures after deterministic duplicate checks are active.
---

Give unrelated same-tenant integration fixtures distinct identities under every strong duplicate rule: full name plus phone or email, and first/last name plus date of birth.

**Why:** Existing fixture helpers reused names and birth dates; real Mongo integration correctly began rejecting later fixtures as possible duplicates.

**How to apply:** When adding Patient integration fixtures, vary the name, contact value, or birth date unless the test intentionally exercises duplicate detection.
