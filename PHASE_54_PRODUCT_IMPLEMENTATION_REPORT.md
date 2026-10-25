# Phase 54 — Patient Management Workflow

## Summary

Phase 54 selected the patient-management frontend as a verified roadmap gap. Patient CRUD, search, lifecycle operations, tenant authorization, duplicate safeguards, and MongoDB storage already existed; adding another API would have duplicated supported behavior. This phase adds a connected, usable Arabic/RTL patient directory and verifies it against disposable tenant databases through an authenticated browser.

The completed core workflow covers directory search and status filtering, patient registration, protected profile reads, editing, activation/deactivation, pagination, loading and recoverable error states, and session/workspace selection. It is not a claim of production readiness or completion of the wider tenant setup experience.

## Implementation

- Added `public/patients/` with the Arabic/RTL directory, patient profile, registration/edit form, lifecycle controls, pagination, empty/loading/error states, and responsive layouts.
- Extended the existing `public/appointments/api.js` shared authenticated client with patient list/get/create/update/activate/deactivate calls. The UI reuses its in-memory access token and refresh-cookie session behavior.
- The patient UI gates directory/profile access with `tenant.patients.read` and mutation controls with `tenant.patients.manage`. It does not persist patient data to browser storage or put patient identifiers in the URL.
- Directory rows show basic contact information. Sensitive identity fields are requested for and rendered only in the permission-protected patient profile.
- No patient backend route, schema, migration, tenant-storage behavior, or healthcare policy was added. Existing tenant MongoDB routing, patient indexes, validation, and audit behavior remain authoritative.

## API, permissions, and isolation

The UI uses the existing tenant routes:

| Operation | Route | Required permission |
|---|---|---|
| Search/list | `GET /api/v1/tenants/:tenantId/patients` | `tenant.patients.read` |
| Read profile | `GET /api/v1/tenants/:tenantId/patients/:patientId` | `tenant.patients.read` |
| Register | `POST /api/v1/tenants/:tenantId/patients` | `tenant.patients.manage` |
| Edit | `PATCH /api/v1/tenants/:tenantId/patients/:patientId` | `tenant.patients.manage` |
| Activate/deactivate | `POST /api/v1/tenants/:tenantId/patients/:patientId/{activate,deactivate}` | `tenant.patients.manage` |

The server resolves the trusted tenant target; the browser supplies no storage routing. Patient records remain tenant-isolated in MongoDB. Safe Arabic client messages cover patient validation, duplicate, missing-record, and lifecycle conflicts without showing raw server error text.

## Acceptance and verification

- Authenticated Chromium acceptance in `test/phase30-patient.integration.spec.ts` passed against disposable MySQL and MongoDB. It exercised workspace selection, registration, profile read, edit, deactivate/reactivate, directory search, reload/session restoration, and persisted profile values. The temporary synthetic patient record was removed after the flow.
- The same disposable suite verifies existing patient API behavior including cross-tenant isolation, duplicate handling, lifecycle transitions, tenant storage/index safeguards, and concurrent duplicate/identity-changing writes.
- `test/appointments-api.spec.ts` covers shared-client patient routes, tenant-scoped query encoding, methods, and authenticated requests.
- Preview screenshots of `/patients/` show the expected sign-in screen because the preview browser has no authenticated identity; the signed-in workspace itself was verified by the isolated Chromium test.

| Check | Result |
|---|---|
| Full unit/HTTP suite | **103 files; 919/919 tests passed** |
| Disposable MySQL/MongoDB integration and browser suite | **39/39 tests passed** |
| Focused shared API-client tests | **5/5 passed** |
| Main TypeScript check | Passed |
| Tenant-contract TypeScript check | Passed |
| Build | Passed |
| Formatting | Passed |
| Lint | Passed; one existing warning remains in `test/encounter-operation-reconciliation.spec.ts` |
| Prisma validation | Passed using a local placeholder URL; no database connection was made |
| `git diff --check` | Passed |

## Remaining work and boundaries

- The core patient-management workflow is implemented; broader role-denied browser coverage, accessibility review, supported-browser coverage, and rollout usability review remain.
- Tenant creation, facility/branch/staff setup, and catalog administration remain without complete management screens.
- Production tenant-storage provider/topology, recovery operations, monitoring, deployment, and other roadmap release gates remain unresolved.
- No production database was accessed, no migration or deployment was performed, and no files were staged or committed. No production-readiness claim is made.

## Next target

The next coherent frontend gap in the roadmap is tenant setup and administration: provision a synthetic tenant and manage its facilities, branches, memberships, staff scopes, roles, and catalogs through authorized UI/API workflows. That work depends on the roadmap’s owner and infrastructure decisions and should continue to use existing APIs where adequate.
