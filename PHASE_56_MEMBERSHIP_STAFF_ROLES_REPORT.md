# Phase 56 — Membership, Staff, Roles, and Scope Administration

## Summary

Phase 56 closes the verified gap between existing tenant membership/staff APIs and the Arabic RTL administration UI. The new `/team-setup/` workspace lets authorized tenant users inspect membership status, manage permitted staff profiles and role assignments, and assign or remove staff facility and branch scopes.

The phase deliberately does not create a tenant-level membership invitation or lifecycle permission. Invitations, activation, suspension, and removal remain protected by the existing platform-admin permission. No new role permissions, tenant lifecycle policy, schema, or migration were introduced.

## Implementation

- Added `GET /api/v1/tenants/:tenantId/memberships`, protected by platform authentication, trusted tenant context, and `tenant.members.read`.
- The directory returns membership state and timestamps, member name, and platform-account state. It does not return email, credential, token, or session data.
- Added `public/team-setup/` as an authenticated, responsive Arabic RTL team administration workflow, linked from the existing appointment workspace.
- Extended the shared browser API client for existing membership-role, staff-profile, staff-role, and staff-scope endpoints.
- The UI displays membership status without offering invitation or membership lifecycle mutations. Staff profile create/edit/suspend/activate/deactivate and role/scope assignment controls follow the existing permission codes and active-membership checks.
- Kept facility and branch scope assignments independent. Server authorization, tenant boundaries, owner-role protections, and validation remain authoritative.
- No schema or migration changes; no production database, migration, deployment, staging, commit, or staging operation.

## Permissions and boundaries

| Capability | Existing permission or boundary |
|---|---|
| Read membership directory and membership roles | `tenant.members.read` |
| Assign/remove membership roles | `tenant.members.roles.manage` with readable roles |
| Read and manage staff profiles | `tenant.staff.read`, `tenant.staff.manage` |
| Read and assign/remove staff roles | `tenant.staff.roles.read`, `tenant.staff.roles.manage` |
| Read and assign/remove facility/branch scopes | `tenant.staff.scope.read`, `tenant.staff.scope.manage` |
| Invite, activate, suspend, or remove a membership | Existing platform-admin permission `platform.manage`; not offered in this tenant UI |

## Acceptance and verification

- Extended the disposable Chromium journey in `test/phase30-patient.integration.spec.ts`. It selects an authorized tenant, assigns a role to a member, confirms the assigned role contributes server-resolved permissions, creates a staff profile, assigns facility and branch scopes, reloads and verifies persistence, cleans up disposable rows, and checks the limited-user denial path.
- Added API-client and HTTP authorization/routing coverage for the membership directory.
- `npm run test:phase42` passed against disposable MySQL/MongoDB with authenticated Chromium: 39/39 tests passed.
- Focused membership/staff HTTP and API-client tests: 33/33 passed.
- Main TypeScript check, tenant-contract TypeScript check, Nest build, JavaScript syntax checks, and `git diff --check` passed.

| Check | Result |
|---|---|
| Full unit/HTTP suite | **103 files; 923/923 tests passed** |
| Disposable MySQL/MongoDB integration and Chromium suite | **39/39 passed** |
| Focused membership/staff HTTP and API-client tests | **33/33 passed** |
| Main TypeScript check | Passed |
| Tenant-contract TypeScript check | Passed |
| Nest build | Passed |
| Formatting | Passed |
| Full lint | Passed with one pre-existing warning in `test/encounter-operation-reconciliation.spec.ts` |
| JavaScript syntax checks | Passed |
| `git diff --check` | Passed |
| Prisma validation | Not run; schema and migrations were unchanged |

The preview browser is unauthenticated, so it can verify the sign-in screen but not the signed-in team UI. The authenticated workflow was verified through the isolated Chromium integration journey.

## Remaining gaps

- Tenant invitation and membership lifecycle remain platform-admin operations; no tenant-admin policy or permission was invented.
- Tenant creation and owner transfer/removal remain outside this phase.
- Doctor/service catalog administration remains pending.
- Broader role/location combinations, accessibility review, supported-browser coverage, and rollout review remain.
- Other production-readiness roadmap gates remain open. This report does not claim production readiness or regulatory compliance.
