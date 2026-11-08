---
name: Browser focus during page loads
description: Focus and keyboard checks for static workspaces that rerender after parallel API responses.
---

**Rule:** When testing keyboard focus on controls inside a workspace that rerenders after asynchronous data loads, wait for the relevant rendered data to settle before asserting `document.activeElement`.

**Why:** A late response can replace the workspace root after a control is focused, resetting focus even though the control is keyboard-accessible once rendering completes.

**How to apply:** Wait for a page-specific loaded state and a short quiet interval before focus assertions; distinguish a render race from a broken keyboard control.
