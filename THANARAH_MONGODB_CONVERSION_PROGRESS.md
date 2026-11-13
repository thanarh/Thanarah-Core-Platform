# Thanarah — MongoDB-only conversion progress

## Target and current boundary

The user explicitly requires MongoDB for the entire platform, superseding the
earlier hybrid target. The user also confirmed that the saved Mongo connection
is for development/testing. No production database was accessed or changed.

All 22 central persistence ports now use their MongoDB implementations.
StaffScope and Doctor adapters are implemented and registered. Subscription
payment settings/transfers, the encounter operation ledger, and storage-target
registration/activation use MongoDB as well.

The application does not register PrismaService. Domain enum values and registry
contracts are storage-independent. The compiled application test explicitly
rejects loading generated Prisma classes or the SQL client, both before and
after restarting the application.

Historical SQL source, migrations and legacy tests were retained; existing
SQL data was not copied, changed or deleted. This is a development-runtime
conversion, not a production data cutover or production acceptance.

## Guarantees exercised

- Active tenant and actor checks; tenant/identity mismatch rejection.
- Membership and staff permission aggregation through one transaction snapshot.
- Self-assignment prevention, OWNER-only grants, and OWNER removal protection.
- Staff, membership and user eligibility; missing/corrupt references fail closed.
- Idempotent and concurrent grants without duplicate assignment documents.
- Reference writes on actual parent documents, not only private lock records.
  A stale-snapshot test verifies retry after an independent tenant-status change.
- Scheduling version checks, concurrent updates, status transitions and revision
  ordering. A revision-insertion conflict rolls back the matching policy write.
- Explicit indexes for staff roles, policy uniqueness and revision history.
- Staff facility/branch scope validation, doctor/catalog/service references,
  assignment eligibility, tenant isolation and transactional rollback.
- OWNER membership lifecycle protection even when an ordinary role was granted
  before OWNER.
- Versioned transfer/settings updates, receipt persistence, idempotency and
  review without automatic subscription activation.
- Registry activation preflight, primary-target switching and operation-ledger
  recovery/CAS without SQL.
- Real authenticated API journey: separate platform administrator and clinic
  owner; tenant/membership/bootstrap, plan/subscription, facility/staff/scope,
  doctor/service, scheduling policy, patient/appointment/encounter.
- Real Chromium sign-in and appointment-workspace catalog loading against that
  disposable application, with authentication and authorization left enabled.
- Missing invariant index makes readiness fail while liveness stays healthy;
  explicit index repair restores readiness.
- Injected refresh dependency failure returns 503 without clearing the cookie;
  refresh recovery, restart persistence, refresh reuse detection and logout-all
  revocation are verified through HTTP.

These tests establish the exercised contracts, not exhaustive proof for every
writer interleaving, production topology or failure. No atomic transaction
between separate central and clinical clusters is claimed.

## Verification

| Check | Result |
| --- | --- |
| Role/policy replica-set contracts | 20 passed, 0 failed, 0 skipped |
| Staff scope / doctor replica-set contracts | 12 passed, 0 failed, 0 skipped |
| Transfer / registry / ledger replica-set contracts | 12 passed, 0 failed, 0 skipped |
| Existing platform Mongo replica-set suite | 27 passed, 0 failed, 0 skipped |
| Existing tenant Mongo integration suite | 6 passed, 0 failed, 0 skipped |
| Compiled Mongo-only API/browser/restart/outage journey | 1 passed |
| General suite | 1046 passed, 84 skipped, 0 failed |
| Type checks and tenant-contract type checks | Passed |
| Full ESLint | Passed with 0 errors and 91 warnings |
| Build, formatting, whitespace checks | Passed |
| Restarted development preview | Login screen rendered; authenticated workspace tested separately on the disposable Mongo application |
| Current development endpoints after restart | `/health` 200; `/ready` 200, central Mongo and tenant provider available |
| Approved development Mongo initialization | Central indexes and authorization reference catalogs initialized; accounts not created or changed |
| Subsequent approved development administrator setup | Active SUPER_ADMIN created using a securely supplied password; HTTP login returned 200 and verification-session logout returned 204 |

The 84 tests skipped by the general command are the 78 Mongo tests above plus
6 historical MySQL portal tests. Mongo tests were run explicitly with
`DOCKER_HOST=unix:///var/run/docker.sock bash scripts/test-phase65-replica-set.sh`.
After the adapter suites passed, the compiled journey was rerun with
`--runtime-only` while correcting fixture authentication and HTTP expectations.
Production credentials are never used by those tests. Their URI and database
names are restricted to the disposable loopback replica set; only their own
synthetic databases are removed during cleanup.
The historical SQL tests are not evidence of a Mongo-only runtime.

`npm run mongo:initialize:dev` succeeded on the user-designated development
connection. It initializes central indexes and idempotent role/permission
reference data without creating or changing accounts. It is blocked outside
development or without an explicit dev/test database name. No credential values
or connection details were printed.

## Acceptance boundary and remaining operational work

- Existing business data has not been migrated. Any production or existing-data
  cutover needs a source/target inventory, backup/restore proof, reconciliation,
  security review and separate approval.
- After separate user approval and secure password entry, the initial development
  administrator was created on the saved development connection. Active status
  and SUPER_ADMIN assignment were verified. After configuring the missing
  JWT signing secret and restarting, HTTP login returned 200 and logout of the
  verification session returned 204. No default password was used and no existing
  account was reset. This does not establish production authentication readiness.
- The historical SQL test suites are retained, not treated as current runtime
  requirements or a request for a MySQL connection.
- Broad production readiness, all possible failures and full historical
  MySQL/Mongo semantic equivalence are not claimed.

Phase 01 remains unaccepted. Phase 02, Geidea, production data transfer and
publishing remain deferred.
