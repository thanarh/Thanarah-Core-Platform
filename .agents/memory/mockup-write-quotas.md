---
name: Mockup write quotas
description: Handling isolated preview work when workspace package writes fail.
---

When a package install or file write fails with system error `-122` while the host filesystem reports free disk, treat it as a workspace write quota rather than ordinary disk exhaustion.

**Why:** package installers can partially reify the shared dependency tree before failing, while clearing a few temporary caches may not free enough quota for another install.

**How to apply:** stop package-install retries, avoid deleting the project's installed dependencies, and use an already available runtime or a static preview server for isolated mockups until the quota is resolved.
