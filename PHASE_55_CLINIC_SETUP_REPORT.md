# Phase 55 — Clinic Setup Workflow

## Summary

Phase 55 selected facility and branch administration as a focused, verified roadmap gap. Existing tenant-scoped APIs already supported reading, creating, renaming, and changing lifecycle state for facilities and branches, but there was no connected management screen. This phase adds one authenticated Arabic/RTL workflow on top of those APIs; it does not expand into general tenant provisioning or healthcare policy design.

The workflow uses persisted central facility/branch records. Authorized users can select a server-listed workspace, review all facility and branch lifecycle states, create and rename facilities, create and rename branches nested under an active facility, and activate, temporarily suspend, or terminally deactivate records when their permissions allow. It includes loading, empty, validation, permission-denied, and recoverable-error states, filters, pagination, and responsive layouts.

## Verified gap and scope choice

Before implementation, the facility and branch controllers, DTOs, services, repositories, permission checks, and schema were inspected alongside the roadmap and Phase 54 report. The existing routes enforce active tenant membership and permissions, validate names and identifiers, write audit events, scope branches to their parent facility, and prevent branch operations when the parent is unavailable. The existing DTOs only require a name, so no new clinic policy or schema was needed.

The facility/branch workflow was chosen over the broader tenant, membership, staff, role, and catalog administration surface because it was a concrete missing UI with complete supporting APIs and no need to invent operating rules or choose an external provider. The Phase 55 workflow intentionally does not imply that the wider tenant setup gate is complete.

## Implementation

- Added `public/clinic-setup/` with an RTL Arabic facility and nested branch workspace.
- Extended `public/appointments/api.js` with facility and branch create, update, list, and lifecycle methods. Setup-specific branch listing does not silently hide suspended or deactivated branches.
- Workspace selection and permission codes come from the existing authenticated session/workspace API. The page does not persist credentials or tenant context in browser storage.
- The UI gates each read, create, update, suspend, activate, and deactivate action using the selected workspace’s server-issued permission codes. It explains when facility-read permission is missing and avoids querying facility data in that state.
- Facility lifecycle actions require confirmation; terminal deactivation is identified as irreversible. Branch operations are available only when their selected parent facility is active.
- No backend route, schema, migration, tenant-storage behavior, or policy default was added. Existing server authorization, validation, audit, and parent-scope checks remain authoritative.

## API, permissions, storage, and isolation

The page uses the existing routes under `/api/v1/tenants/:tenantId`:

| Operation | Route | Required permission |
|---|---|---|
| List/read facilities | `GET /facilities` and `GET /facilities/:facilityId` | `tenant.facilities.read` |
| Create/update facility | `POST /facilities` and `PATCH /facilities/:facilityId` | `tenant.facilities.create` / `tenant.facilities.update` |
| Facility lifecycle | `POST /facilities/:facilityId/{activate,suspend,deactivate}` | Matching `tenant.facilities.activate`, `.suspend`, or `.deactivate` |
| List/read branches | `GET /facilities/:facilityId/branches` and `GET /facilities/:facilityId/branches/:branchId` | `tenant.branches.read` |
| Create/update branch | `POST /facilities/:facilityId/branches` and `PATCH /facilities/:facilityId/branches/:branchId` | `tenant.branches.create` / `tenant.branches.update` |
| Branch lifecycle | `POST /facilities/:facilityId/branches/:branchId/{activate,suspend,deactivate}` | Matching `tenant.branches.activate`, `.suspend`, or `.deactivate` |

The browser sends the tenant path required by the existing API contract, but server guards resolve and validate the authenticated membership, tenant context, and permissions; browser-supplied roles or permissions are never trusted. Branch routes retain their facility parent in every request. The APIs persist facility and branch metadata in the existing central relational database; no tenant MongoDB patient or clinical data is involved.

## Acceptance and verification

- Authenticated Chromium acceptance in `test/phase30-patient.integration.spec.ts` passed against disposable MySQL and MongoDB. It created and renamed a facility and nested branch, suspended and reactivated both, reloaded the page and verified persisted names/status, checked cross-tenant facility/branch reads, and verified the visible denial state for an appointments-only user.
- The browser journey deleted its temporary facility and branch after verification.
- Focused integration HTTP checks confirmed facility read/create and branch read are denied to a user lacking those permissions.
- `test/appointments-api.spec.ts` covers tenant-scoped routes, encoded identifiers, lifecycle action validation, cookie credentials, and inclusion of inactive records in setup branch lists.
- The local preview screenshot shows the expected sign-in page because the preview browser has no authenticated identity. The signed-in workflow and permission-denied view were verified with the isolated authenticated Chromium journey.

| Check | Result |
|---|---|
| Full unit/HTTP suite | **103 files; 920/920 tests passed** |
| Disposable MySQL/MongoDB integration and browser suite (`npm run test:phase42`) | **39/39 tests passed** |
| Focused shared API-client tests | **6/6 passed** |
| Main TypeScript check | Passed |
| Tenant-contract TypeScript check | Passed |
| Nest build | Passed |
| Formatting | Passed |
| Full lint | Passed; one pre-existing warning remains in `test/encounter-operation-reconciliation.spec.ts` |
| JavaScript syntax checks | Passed |
| `git diff --check` | Passed |
| Prisma validation | Not run; there were no Prisma schema or migration changes |

## Remaining gaps and decisions

- Tenant creation, membership invitation/activation, owner transfer/removal, staff profile and scope, role/permission assignment, doctor/catalog maintenance, and other setup screens remain outside this phase.
- The facility and branch schemas currently capture names only. Addresses, time zones, operating hours, and scheduling policy values require product-owner decisions before adding fields or defaults.
- Broader role/location coverage, accessibility review, supported-browser coverage, and rollout usability review remain.
- Production tenant-storage topology, recovery, monitoring, dependency/security, CORS allowlists, deployment, and other roadmap release gates remain unresolved.
- No production database was accessed, no migration or deployment was performed, and no files were staged or committed. This report makes no production-readiness or compliance claim.

## Next highest-priority workflow

Continue the broader tenant setup gate with an authorized operator workflow for membership activation and staff scopes/roles, using the existing APIs and permissions. Keep doctor/service catalog administration separate where operating rules require owner decisions. Do not add unsupported facility policy fields or defaults as part of that work.
