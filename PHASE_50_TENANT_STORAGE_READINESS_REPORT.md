# Phase 50 — Tenant Storage Infrastructure Readiness and Security Audit

**Assessment date:** 2026-10-25  
**Verdict:** **NOT READY for production**

## Executive summary

Tenant storage readiness and tenant-boundary controls are implemented and have strong disposable-environment evidence. Production MongoDB configuration now fails closed unless TLS is enabled and certificate/hostname validation remains enabled. Tenant target activation verifies required indexes before making a target active, and concurrent primary changes are serialized.

The application is not production-ready. The MongoDB provider/topology and recovery objectives remain unapproved; production backup isolation, key custody, scheduling, alerting, retention, and runbook evidence are absent. The Phase 49 artifact and restore test are not connected to a production recovery/activation workflow. The latest dependency audit also retains production high-severity advisories and critical development-tool advisories.

## Scope and safety boundaries

- Reviewed the Phase 50 requirements and the Phase 47–49 reports, then verified the current implementation and tests.
- Used only local checks and disposable MySQL 8.0.41 / MongoDB 7.0.17 containers. No production services, data, environment values, or migration targets were accessed.
- No production migrations or deployment were run. No MongoDB provider or topology was selected.
- No Git staging, commit, stash, reset, or history operation was performed.
- Did not force dependency upgrades that require major-version changes.

## Changes delivered

- Production configuration rejects disabled or in-memory tenant storage, missing MongoDB configuration, MongoDB URIs without TLS, and URI options that disable certificate or hostname validation. Standard `mongodb+srv` URIs are accepted with the MongoDB driver’s TLS defaults; standard `mongodb` URIs must explicitly enable `tls=true` or `ssl=true`.
- Added configuration tests for validated TLS, SRV defaults, TLS aliases, and explicit validation bypasses.
- Added an HTTP test proving client-supplied tenant/target/database/connection identifiers are rejected and create no patient record in either tenant database.
- Added a real MongoDB activation test: a duplicate patient-number index failure leaves the target inactive; after removing the bad disposable database contents, activation succeeds. Concurrent primary changes leave exactly one active primary.
- Applied npm’s non-forced compatible audit fixes to 16 transitive packages. No direct dependency version was changed; the lockfile was updated.

## Findings

### Critical — recovery is not production-proven

Phase 49 proves restoration of the tested disposable central MySQL database and registered tenant MongoDB fixtures, including collections, documents, indexes, registry remapping, and tenant lookup denial. It does not prove production recovery.

The recovery artifacts are not integrated with scheduled production backups, independent storage, production key custody, access authorization/auditing, retention, alerting, or a rehearsed operations runbook. The artifact verification result is not coupled to tenant-target activation. The restore test also documents that a cross-store atomic snapshot is not guaranteed.

**Required before production:** approve backup coverage and ownership, isolation from the primary failure domain, encryption/key custody, retention, alerting, consistency policy, RPO/RTO, and restore/activation controls; then rehearse restoration in an approved disposable environment. Do not treat Phase 49 as a production recovery guarantee.

### High — provider and operational decisions remain open

The production MongoDB provider/topology, region/residency, network restrictions, least-privilege identity, healthcare agreement, capacity, and operational ownership remain unapproved or unverified. This report does not choose them or make compliance claims. The TLS validation is a configuration guard; an actual production TLS handshake, certificate chain, and hostname match were not tested.

### High — production dependency advisories remain

After the compatible, non-forced updates:

| Audit scope | Critical | High | Moderate | Total |
|---|---:|---:|---:|---:|
| Production dependencies (`npm audit --omit=dev`) | 0 | 4 | 2 | 6 |
| Full tree (`npm audit`) | 2 | 4 | 4 | 10 |

Production advisories include Prisma / `@prisma/config` / `deepmerge-ts`, Zod 3, and `@nestjs/swagger`’s `js-yaml` dependency. The audit offers fixes through major upgrades to Prisma 7, Zod 4, and Swagger 12. Those changes were not forced because they require compatibility work and validation.

The two critical full-tree advisories are in the development/test tooling (`vitest`, `tinypool`); related findings include `@vitest/mocker` and `@vitest/coverage-v8`. The offered fix is Vitest 5, a major upgrade. It was not forced. Audit counts are advisory records, not counts of distinct exploitable application paths; reachability was not established for every finding.

The normal `npm audit fix` updated 16 compatible transitive packages but exited nonzero because the remaining fixes require breaking changes. `npm audit fix --force` was not run.

### Medium — recovery activation remains an operational trust boundary

Runtime activation checks indexes and serializes target changes, but recovery-artifact verification is not an activation prerequisite. Until that lifecycle is integrated, operators must keep restored targets isolated and inactive until independently verified; the current artifact module alone does not enforce this workflow.

### Medium — actual production deployment evidence is unavailable

The local application starts in development mode without configured databases. Local `/health` returned HTTP 200 and `/ready` returned a sanitized HTTP 503 with `DATABASE_UNAVAILABLE`, as expected without a central database. This verifies the local preview behavior, not production host configuration, credentials, connectivity, monitoring, or deployment operations.

## Positive evidence

- Trusted tenant context and registry resolution, rather than client-supplied physical storage identifiers, determine database routing.
- Existing and new disposable tests cover tenant isolation, inactive/missing targets, storage outages, index readiness, activation failure, concurrent primary changes, and sanitized errors.
- In disposable integration tests, healthy central MySQL and tenant MongoDB produce `/ready` HTTP 200 with both dependencies available. Central MySQL or tenant MongoDB outages produce `/ready` HTTP 503 while `/health` remains HTTP 200.
- Production configuration requires persistent tenant storage and validated MongoDB TLS without selecting a provider or topology.
- Phase 49 restoration evidence remains limited to its disposable fixtures and is recorded separately in `PHASE_49_DISPOSABLE_RECOVERY_REPORT.md`.

## Verification

| Check | Result |
|---|---|
| Full unit suite | Passed: 102 files, 914 tests |
| Disposable MySQL/MongoDB integration suite | Passed: 39/39 tests |
| Real activation failure and concurrent primary changes | Passed against disposable MongoDB |
| Tenant routing-ID spoof rejection | Passed; rejected request created no record in either tenant database |
| Healthy and failed dependency readiness cases | Passed in disposable integration tests |
| Nest build | Passed as part of `npm run test:phase30` |
| Main TypeScript check | Passed |
| Tenant-contract TypeScript check | Passed |
| ESLint | Passed with 0 errors and 1 existing warning in `test/encounter-operation-reconciliation.spec.ts` |
| Prettier check | Passed |
| Prisma schema validation | Passed |
| Browser JavaScript syntax checks | Passed for appointment and encounter scripts |
| `git diff --check` | Passed |
| Local workflow startup | Passed |
| Local `/health` and `/ready` | HTTP 200 and HTTP 503 (`DATABASE_UNAVAILABLE`) without a configured central database |
| Production dependency audit after compatible updates | 0 critical, 4 high, 2 moderate advisories |
| Full dependency audit after compatible updates | 2 critical, 4 high, 4 moderate advisories |

## Readiness gate

**Do not deploy or declare production readiness.** First obtain the required provider/topology and recovery approvals, implement and rehearse isolated production backup/restore with controlled key custody and activation gating, and validate deployment operations in approved staging. Separately plan and test major dependency upgrades for Prisma, Zod, Swagger, and Vitest before adopting them.
