# Thanarah — MongoDB-only conversion progress

## Target and current boundary

The user explicitly requires MongoDB for the entire platform, superseding the
earlier hybrid target. The user also confirmed that the saved Mongo connection
is for development/testing. No production database was accessed or changed.

This increment implements three previously missing persistence candidates:

- Membership role assignment/removal, role lookup, and permission resolution.
- Staff role assignment/removal and scoped listing.
- Facility scheduling policies and atomic policy revision history.

The candidates remain unregistered. The application still uses its existing
central Prisma providers, and the Mongo-only conversion is **not complete**.

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

The shared reference-write helper is not a claim that every existing candidate
already participates in a complete cross-port concurrency protocol.

## Verification

| Check | Result |
| --- | --- |
| New role/policy replica-set contracts | 19 passed, 0 failed, 0 skipped |
| Existing platform Mongo replica-set suite | 27 passed, 0 failed, 0 skipped |
| Existing tenant Mongo integration suite | 6 passed, 0 failed, 0 skipped |
| General suite | 1046 passed, 58 skipped, 0 failed |
| Type checks and tenant-contract type checks | Passed |
| ESLint on new/changed candidate code and the new tests | 0 errors, 0 warnings |
| Build, formatting, whitespace checks | Passed |
| Restarted app and preview | Login screen rendered; authenticated application UI was not verified in the development preview |
| Current app endpoints after restart | `/health` 200; `/ready` 503 because central runtime wiring still uses Prisma |

The 58 tests skipped by the general command are the 52 Mongo tests above plus
6 historical MySQL portal tests. Mongo tests were run explicitly with
`DOCKER_HOST=unix:///var/run/docker.sock bash scripts/test-phase65-replica-set.sh`.
The historical SQL tests are not evidence of a Mongo-only runtime.

The read-only check of the user-designated development Mongo connection succeeded:
ping, logical sessions and replica-set/sharded transaction capability were
available. No application records or indexes were written to that connection,
and no credentials or connection details were printed. This connectivity result
does not make the still-Prisma-backed application readiness endpoint Mongo-ready.

## Remaining before acceptance

1. Implement and verify StaffScope and Doctor candidates.
2. Complete existing candidate contracts and shared race/recovery guarantees.
3. Replace direct Prisma usage in subscription payment handling, encounter
   operation recovery, tenant storage registry and target activation.
4. Move runtime wiring, initialization/reference data, readiness and operational
   commands to MongoDB; remove the SQL runtime dependency without deleting history.
5. Pass the complete authenticated browser/API journey and restart/outage recovery
   using MongoDB only.

Phase 01 remains unaccepted. Phase 02, Geidea, production data transfer and
publishing remain deferred.
