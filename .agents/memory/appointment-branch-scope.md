---
name: Appointment branch scope
description: Include the selected branch in appointment searches for branch-scoped staff.
---

Appointment lookup from the encounter workspace must pass the selected `branchId` when filtering eligible appointments. A facility-only query is not equivalent for branch-scoped staff and can be denied even when the user can read appointments in their assigned branch.

**Why:** The browser flow exposed that the appointment selector queried a whole facility while its users could be authorized only for one branch.

**How to apply:** Keep appointment branch selection wired to the API query, clear stale results when the branch changes, and verify with an authenticated branch-scoped user.
