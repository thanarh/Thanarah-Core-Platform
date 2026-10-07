---
name: Doctor catalog assignments
description: Durable Doctor relationships to healthcare catalogs and organizational scope.
---

Doctors are Staff profiles, not alternate identities or authorization principals. Facility and Branch scope remains assigned to Staff; a Doctor with no active organizational scope may still exist administratively. Doctor operational availability requires the Tenant, Staff, and Doctor to be ACTIVE.

Department and Specialty are independent, many-to-many relationships. Never infer one from the other. New assignments require an active catalog entry in the same tenant, while existing links remain visible and removable if a catalog entry is later suspended or deactivated.

**Why:** Keeping identity, authorization, and organizational scope on existing tenant models avoids parallel systems; independent explicit catalog links prevent data drift and preserve historical context.

**How to apply:** Build future Doctor workflows through Staff identity and scope, check effective availability as the conjunction above, and manage Department and Specialty assignments separately.
