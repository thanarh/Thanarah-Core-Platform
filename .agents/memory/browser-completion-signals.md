---
name: Browser completion signals
description: Avoid false failures and premature persistence assertions in authenticated browser journeys.
---

Browser waits must tolerate the short interval after navigation when the document has no body. Mutation completion checks must use a signal produced by that operation, not a name or status already visible before submission.

**Why:** A long authenticated administrative journey failed during document replacement; a separate subscription check previously matched existing plan/status text and queried storage before the request finished.

**How to apply:** Guard DOM predicates against transient documents and wait for a mutation-specific success signal or the changed record before asserting persisted state. Preserve detailed browser exceptions rather than suppressing them.

When a successful write refreshes the displayed records, show success only after that refresh finishes successfully. Clear previous success at the next mutation and block duplicate submissions until the refresh settles.

**Why:** An assignment success message appeared while the subscription list was still stale, so the next browser action could silently click a missing button. The same message remained visible after refresh failure.

**How to apply:** Test delayed and failed refreshes explicitly. A passing rerun alone does not disprove this timing bug; require a completion signal tied to the refreshed view.

In multi-step Chromium journeys, handle confirmation dialogs through the shared CDP dialog helper rather than replacing `window.confirm`. A global stub can suppress later dialogs that the same test still expects.

**Why:** The doctor-service removal confirmation and a later doctor lifecycle confirmation share one browser page and one dialog listener.

**How to apply:** Keep native dialogs enabled across the journey and explicitly accept each expected prompt through CDP.
