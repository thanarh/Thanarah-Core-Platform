---
name: Shared fences and strict owning schemas
description: Why cross-module locking writes must remain valid under the document owner's schema.
---

Cross-module reference locks must use the owning domain's existing reference
version protocol, not add an unrelated feature-specific field to the parent.

**Why:** Company operations initially wrote a feature-specific fence into
platform-user documents. Internal operations still worked, but the owning
identity adapter strictly rejected the documents on the next login. Sparse
integration fixtures missed this until the authenticated browser journey.

**How to apply:** Use full owning-domain schemas when seeding shared identities
in integration tests, and validate those documents after reference writes.
Cross-feature tests must include subsequent authentication or owning-adapter
reads; a successful mutation alone is not evidence of compatibility.
