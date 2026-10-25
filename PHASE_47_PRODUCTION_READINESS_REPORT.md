# Phase 47 — Production Readiness Audit

**Assessment date:** 2026-10-25  
**Verdict:** **NOT READY**

## Executive summary

The repository has strong automated evidence for authentication/session handling and tenant isolation, including disposable MySQL/MongoDB HTTP integration tests. The full unit suite, build, and type checks pass.

Production readiness is still blocked by missing operational proof: no repository backup/restore implementation or runbook was found; no successful restore test, approved RPO/RTO, retention policy, or backup isolation evidence was provided; and the MongoDB provider/topology decision remains pending. Production environment configuration was not inspected, and no production services or data were accessed. The application currently validates central MySQL and authentication settings in production, but does not require persistent tenant storage configuration; `/ready` checks MySQL only.

Dependency scanners still report critical development-tool and high-severity runtime/dependency-tree findings. Safe compatible Fastify/Nest adapter, Swagger, and Vite updates were made. Major Prisma, Zod, and Vitest changes were not forced because they require compatibility validation; the package manager repeatedly failed to resolve the Vitest update.

## Findings

### Critical

1. **Backup and recovery are not proven.** No automated backup/restore implementation or operational runbook was found in the repository. There is no evidence here of a successful disposable restore for central MySQL and every registered tenant MongoDB database, independent backup storage, encryption/access controls, retention, failure alerts, or approved RPO/RTO. External operations may exist, but they were not verified. Patient-data recovery must not be assumed.
2. **Critical development dependency findings remain.** The dependency scan reports two critical advisories for `tinypool@1.1.1`, pulled in by the development-only Vitest 3.2.7 toolchain. The scanner identifies a major-version fix. This is not in the production runtime tree, but remains a developer/test-environment supply-chain risk. Updating Vitest and its coverage plugin failed repeatedly inside npm's dependency resolver (`Cannot read properties of null (reading 'edgesOut')`); no force/bypass was used.

### High

1. **Tenant storage can be absent while production starts.** `src/config/env.schema.ts` defaults tenant storage to `disabled` and does not require `TENANT_STORAGE_PROVIDER=mongodb` or a Mongo URI in production. `src/app.controller.ts` reports readiness from central MySQL only. As a result, production may start and report ready while tenant-owned clinical storage is disabled or unavailable. Requiring a Mongo provider here would encode the still-pending provider decision, so it was not changed in this audit.
2. **Tenant provider/topology and operational controls remain unapproved/unverified.** `TENANT_MONGODB_DEPLOYMENT_DECISION.md` documents a pending decision and states the tested deployment topology is standalone only. Production provider, topology, TLS, network restrictions, database least privilege, region/data-residency, healthcare agreement, capacity, backup, and recovery evidence remain open. This report does not select a provider or claim regulatory compliance.
3. **High dependency findings remain.** After the safe updates, `npm audit --omit=dev` reported **8 high and 2 moderate findings**. The affected production tree includes Prisma 6 / `@prisma/config` and `deepmerge-ts`, Zod 3, and transitive packages including `brace-expansion`, `fast-uri`, `js-yaml`, `source-map-js`, and `undici`. Scanner advisories may not all be reachable through application input paths; applicability has not been established for each. Prisma 7 and Zod 4 are major changes and were deferred rather than applied speculatively.
4. **Production deployment evidence is incomplete.** README deployment instructions identify cPanel/Namecheap and a build/start command, but the environment-variable table is incomplete and does not document a tested migration sequence, rollback procedure, tenant-database monitoring, alerting, or recovery process. Live cPanel configuration, permissions, TLS, monitoring, and restart behavior were not inspected.

### Medium

1. **Readiness does not represent all required dependencies.** `/ready` is explicitly a central-database check; it does not report tenant MongoDB availability. Keep it distinct from liveness, but production orchestration needs a health signal appropriate to the approved tenant-storage design.
2. **Audit persistence needs operational verification.** The encounter documentation describes central audit persistence as best-effort while clinical history is recorded with the tenant record. Verify audit-failure alerting, reconciliation ownership, retention, and evidence export operationally before relying on it for production oversight.
3. **Remaining development advisories.** The full dependency scanner also reports vulnerable development-tree packages. See scanner totals below; test/development reachability differs from production runtime exposure.

### Low

1. **Configuration documentation is incomplete.** `.env.example` lists more variables than the README production table, increasing the chance of an incomplete manual deployment.
2. **Production readiness has not been exercised against the actual host.** No production access was allowed or attempted, so cPanel/Namecheap runtime compatibility and monitoring remain unverified.

## Positive evidence

- Access tokens are signed with HS256 and checked for issuer, audience, expiry, and required claims. Production validation requires a JWT secret of at least 32 characters.
- The platform guard checks user status, token version, session ownership, revocation/compromise state, and expiry.
- Refresh tokens rotate through persisted hashes; reuse handling marks compromised sessions. Password login uses a dummy hash for nonexistent users and generic invalid-credential failures.
- Refresh cookies are `HttpOnly`; production validation requires `AUTH_REFRESH_COOKIE_SECURE=true`. Production CORS is not permissive. Login and refresh have endpoint-specific throttles, and a global throttler is enabled.
- Tenant controllers use authentication, trusted tenant context/membership validation, and permission guards. The disposable integration suite exercised tenant boundaries, missing/inactive targets, storage outages, and fail-closed behavior.
- Clinical patient, appointment, and encounter data are stored in tenant-scoped MongoDB targets in the implemented path; platform identity and authorization use central MySQL. This is code/test evidence, not approval of the production provider or topology.
- No SAST or HoundDog findings were returned in the final scan. No claim of comprehensive security or compliance follows from those results.

## Changes made

Only dependency manifests and lockfile were changed:

- Updated `@nestjs/platform-fastify` to 11.2.7, `fastify` to 5.12.7, and `@fastify/static` to 10.1.7.
- Added a scoped npm override so the Nest Fastify adapter uses the same patched Fastify version as the application; without it, duplicate Fastify types caused the build to fail.
- Updated `@nestjs/swagger` to 11.4.7 and added Vite 7.3.7 as a development dependency to address its patched Vite advisory.
- Updated `package-lock.json` accordingly.
- No application behavior, MongoDB provider/topology, migrations, production configuration, or credentials were changed. No Git staging or commit was performed.

## Verification

| Check | Result |
|---|---|
| `npm run build` | Passed |
| `npm run type-check` | Passed |
| `npm run type-check:tenant-contracts` | Passed |
| `npm test -- --reporter=dot` | Passed: 100 files, 899 tests |
| `npm run test:phase30` | Passed: 1 disposable-database HTTP integration file, 37 tests |
| Dependency audit after updates | 2 critical, 22 high, 14 moderate, 2 low findings |
| `npm audit --omit=dev` | 0 critical, 8 high, 2 moderate findings |
| SAST | 0 findings |
| HoundDog | 0 findings |
| `git diff --check` | Passed |

The two critical scanner findings are in the development-only Vitest/Tinypool tree, not the production-only audit. Scanner totals count advisory findings and are not counts of distinct exploitable application paths.

## Production environment variable checklist

Use names only in deployment planning; values must remain in the hosting secret/configuration manager.

- Application/runtime: `NODE_ENV`, `PORT`
- Central database: `DATABASE_URL`
- Tenant storage: `TENANT_STORAGE_PROVIDER`, `TENANT_STORAGE_MONGO_URI`
- Authentication: `JWT_ACCESS_SECRET`, `AUTH_ACCESS_TOKEN_TTL_MINUTES`, `AUTH_REFRESH_TOKEN_TTL_DAYS`, `AUTH_MAX_FAILED_LOGIN_ATTEMPTS`, `AUTH_LOGIN_LOCK_MINUTES`
- Refresh cookie: `AUTH_REFRESH_COOKIE_NAME`, `AUTH_REFRESH_COOKIE_DOMAIN`, `AUTH_REFRESH_COOKIE_SECURE`, `AUTH_REFRESH_COOKIE_SAME_SITE`
- Proxy/rate limits: `AUTH_TRUSTED_PROXIES`, `THROTTLE_TTL`, `THROTTLE_LIMIT`

Code currently requires production `DATABASE_URL`, a sufficiently long `JWT_ACCESS_SECRET`, and secure refresh cookies. It does **not** enforce production tenant-storage configuration; resolve that only after the provider/topology decision is approved.

## Safe cPanel/Namecheap deployment and rollback checklist

Do not deploy until all blockers above have named operational owners and evidence.

1. Obtain written approval for the tenant-storage provider/topology, region, TLS/network policy, least-privilege accounts, applicable healthcare agreement, retention, and RPO/RTO.
2. Provision isolated staging services and verify all listed variables by name and validation behavior without exposing their values.
3. Create independent backups for central MySQL and all tenant MongoDB databases; restore them into disposable environments and record integrity checks, timing, and evidence.
4. Review the cumulative Prisma migrations and schema compatibility against a disposable copy. Never treat an application rollback as a database rollback.
5. Run the build, type checks, full test suite, and disposable-database integration tests on the exact release candidate.
6. In an approved maintenance window, take and verify fresh backups, deploy the reviewed build using the documented cPanel Node.js process, and observe startup, readiness, tenant-storage health, logs, and alerts.
7. For application rollback, restore the previous application build only if its schema and data expectations remain compatible. Never overwrite live databases or apply a destructive restore as an untested rollback procedure.
8. Record post-deployment verification and keep the previous build and verified recovery artifacts until the release is accepted.

## Prioritized remediation plan and owners

1. **Prove recoverability** — Platform/Database Operations: define backup coverage, encryption/access, isolation, retention, alerts, RPO/RTO; successfully restore central and tenant data in disposable environments.
2. **Approve tenant storage** — Product/Security/Infrastructure owners: decide provider/topology and associated healthcare, residency, TLS, network, capacity, and least-privilege requirements. Do not infer approval from this audit.
3. **Close production configuration/readiness gaps** — Backend and Infrastructure owners: after the storage decision, fail production startup or readiness safely when required tenant storage is absent; document and test cPanel configuration, health checks, migrations, and rollback.
4. **Remediate remaining dependency findings** — Backend/Security owners: resolve the two critical dev-tool findings and review runtime Prisma/Zod/transitive advisories. Validate compatible releases and rerun tests/audits; do not force major upgrades.
5. **Verify operational oversight** — Security/Operations owners: confirm audit reconciliation, monitoring, alert routing, retention, and incident-response ownership.

## Audit boundaries

No production cPanel/MySQL or tenant MongoDB connection was made. No production migration, deployment, credential operation, or data access occurred. The attached Phase 47 instruction file and existing project files were preserved. The pending MongoDB provider/topology decision was not changed.
