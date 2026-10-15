---
name: Appointment timezone contract
description: Rules for interpreting appointment date filters and local appointment times.
---

Appointment date-only filters must use the active scheduling policy timezone for the selected facility. If no active policy defines a timezone, return an explicit unavailable-policy error; do not silently use UTC or the browser timezone for server filtering. The browser timezone may be used only as a clearly labeled display/input fallback. Reject nonexistent and ambiguous local appointment times around daylight-saving transitions.

**Why:** A host or browser timezone is not a reliable substitute for a facility's business calendar, and silent fallback can shift appointment searches or choose the wrong instant.

**How to apply:** Keep local-date-to-UTC conversion policy-backed on the server, expose effective timezone metadata without policy rules, and label any browser-timezone fallback in the UI.
