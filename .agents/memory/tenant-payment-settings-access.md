---
name: Tenant payment settings access
description: Permission and API boundaries for bank-transfer settings in tenant finance.
---

Tenant bank-transfer instructions and revision snapshots must be returned only through payment-specific endpoints guarded by payment-specific permissions. General invoice-settings reads must not include bank names, account-holder names, IBANs, or transfer snapshots.

**Why:** Invoice readers may not be authorized to see banking details. A shared finance settings response would silently widen access.

**How to apply:** When adding or changing tenant bank-transfer settings, preserve the separate DTO, response projection, and permission boundary from ordinary invoice settings.
