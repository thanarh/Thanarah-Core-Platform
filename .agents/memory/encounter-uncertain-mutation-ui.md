---
name: Encounter uncertain-mutation UI
description: Keep clinical drafts and their operation reference together when a mutation outcome is uncertain.
---

Every encounter mutation form that can receive an ambiguous response must retain the original idempotency key and route reference in its own error handler, in addition to retaining the user's draft. Reuse the shared status-recovery behavior; do not infer application state or create a replacement key in the browser.

**Why:** the clinical editor preserved entered data but did not register its uncertain operation, so the status-check action was missing even though the API helper had returned the reference.

**How to apply:** when adding or changing encounter mutation forms, test each editor's error handler in an authenticated browser and verify the status action, draft preservation, server status result, and retry gate.
