---
name: Role-aware Thanarah UI
description: Project scope for role-related navigation and presentation changes.
---

Treat role changes to the interface as permission-aware navigation and presentation. Do not change backend role grants or authorization rules unless the user explicitly approves a concrete role-to-permission mapping.

**Why:** Navigation cleanup should not accidentally broaden or revoke access to clinical or administrative data.

**How to apply:** Use server-resolved tenant permission codes to show or hide workspace links. Keep server-side authorization unchanged and verify both UI and API access when changing permissions.
