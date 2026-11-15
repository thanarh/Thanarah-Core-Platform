---
name: Replit preview cookie partitioning
description: Keep customer refresh sessions working in embedded Replit previews without weakening production cookie scope.
---

Use `SameSite=None; Secure; Partitioned` refresh cookies only when the app is in development and `REPLIT_DEV_DOMAIN` is present. Keep the configured cookie policy unchanged for local development and production, and use matching attributes when clearing the preview cookie.

**Why:** Replit previews run in an embedded cross-site frame, where strict cookies can be withheld from refresh requests. Applying `SameSite=None` globally would unnecessarily widen cross-site cookie exposure; partitioning limits the preview cookie to its top-level site.

**How to apply:** Detect the Replit preview environment explicitly, require secure transport for the partitioned cookie, and test both issuance and clearing attributes.
