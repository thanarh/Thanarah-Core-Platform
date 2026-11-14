---
name: Modal scroll preservation
description: Why restoring a dialog's click-time scroll offset can still return the page to the top.
---

Validate dialog scroll preservation with a visible trigger at a nonzero page
offset. Capturing scroll position in the click handler is insufficient when the
browser or automation first scrolls an off-screen trigger into view.

**Why:** The browser can move the page before any click-handler or modal focus
event runs. The handler then records the already-changed offset; removing body
scroll locks and restoring that snapshot does not recover the original position.

**How to apply:** Keep global account-dialog triggers accessible while scrolling,
and test page offset before opening, while open, and after closing. Distinguish
pre-click trigger scrolling from body-overflow changes and native focus
restoration before changing modal behavior.
