# Phase 51 — Security Hardening & Dependency Remediation

**Assessment:** NOT READY  
**Scope:** Current Thanarah worktree and disposable test infrastructure only. No production service, production database, migration, or deployment was accessed.

## Executive summary

The review confirmed and fixed a credentialed CORS policy defect: staging previously reflected arbitrary request origins. CORS now permits reflected credentialed origins only in development; staging and production fail closed. Focused HTTP tests verify this behavior.

Dependency exposure remains unresolved. The current npm audit reports **4 high and 2 moderate production dependency findings**, plus **2 critical and 2 moderate development/test findings**. Attempting a compatible Vitest/coverage update failed in npm's dependency resolver (`Cannot read properties of null (reading 'edgesOut')`). No resolver bypass, forced install, or Phase 51 dependency update was applied.

Phase 50's recovery and storage readiness blockers remain. Passing tests do not demonstrate approved production topology, isolated backups, operational recovery, or regulatory compliance.

## Baseline and scan results

Audits were run against the current `package.json` and `package-lock.json`:

| Source / scope | Critical | High | Moderate | Result |
|---|---:|---:|---:|---|
| `npm audit --omit=dev` (production tree) | 0 | 4 | 2 | Findings remain |
| `npm audit` (full tree) | 2 | 4 | 4 | Findings remain |
| Replit dependency audit | 2 | 2 | 4 | Findings remain; count differs from npm's audit |
| Replit SAST | 0 | 0 | 0 | No findings |
| Replit HoundDog | 0 | 0 | 0 | No findings |

The two audit tools report different severity totals. The detailed dependency paths and advisory information below use npm audit's output; scanner totals are kept separate rather than combined.

### Production dependency paths

- **Prisma 6**: direct `prisma` → `@prisma/config` → `deepmerge-ts` (high advisories). npm reports the available fix through Prisma 7.10.1, a major upgrade requiring compatibility work.
- **Zod 3**: direct `zod` high advisory; npm reports Zod 4.6.7 as the fix, a major upgrade.
- **Swagger**: direct `@nestjs/swagger` → `js-yaml` moderate advisory. npm reports `@nestjs/swagger` 12.0.4 as the fix, a major upgrade. The js-yaml advisory itself lists 5.4.1, but no override was retained because the prior scoped override attempt was removed and dependency installation/resolution was not cleanly validated.

`npm audit --omit=dev` reports six production-tree vulnerabilities across those paths: four high and two moderate. These totals include package-chain entries and do not mean six independent root causes.

### Development/test dependency paths

- **Vitest 3.2.7**: critical advisory paths through `tinypool` and `@vitest/mocker`; `@vitest/coverage-v8` is also affected. npm suggests Vitest 5.0.5 (major); the scanner advisory details identify patched Vitest 4.1.11/4.1.12 versions for individual mocker issues, and tinypool fixes in 2.1.1/2.1.2. The project-wide upgrade still needs compatibility and test validation.
- Full-tree npm audit adds two critical and two moderate findings beyond the production audit. No safe compatible update was completed in this phase.

### Resolver constraint

An attempted Vitest/coverage update stopped at npm's resolver error: `Cannot read properties of null (reading 'edgesOut')`. A js-yaml override was briefly tried and removed. No `--force`, `--legacy-peer-deps`, or disabled lifecycle scripts were used. `package.json` was not upgraded for Phase 51; the existing lockfile changes are retained from prior work and were not reverted.

## Confirmed finding fixed

### Credentialed CORS origin reflection in staging

Previously, the environment check disabled CORS only in production, leaving staging permissive. Since credentials were enabled, staging could reflect an arbitrary `Origin` and grant credentialed browser access.

**Fix:** Added `src/config/cors.policy.ts` and wired it into `src/main.ts`. Only development uses reflected origins. Staging and production return no CORS allow-origin/credentials headers for an untrusted origin. `test/cors-policy.spec.ts` verifies this with registered Fastify HTTP routes and asserts the development-only behavior.

**Deployment note:** No staging/production origin allowlist is currently configured by this policy. Cross-origin browser clients in those environments will not be allowed until an explicit trusted-origin policy is designed and tested. Do not restore arbitrary-origin reflection.

## Authentication, tenant boundaries, and attack surface

Code and existing focused tests were reviewed for login/lockout, JWT validation, refresh rotation and reuse, session checks/revocation, cookie attributes, tenant-context construction, authorization, request validation, throttling, error handling, and logging.

- JWT signing and verification require a 32-character minimum secret; issuer, audience, algorithm, expiration, and claim checks are enforced. Production environment validation requires the secret.
- Refresh cookies are HttpOnly, have configured Secure/SameSite attributes, and production requires Secure. Login/refresh throttling, failed-login lockout, refresh rotation/reuse handling, and logout/logout-all have existing tests.
- Platform and tenant authorization remain separate. Tenant context is derived from authenticated membership, checked against the route tenant ID, and required permissions are resolved server-side. Existing HTTP and disposable database tests exercise tenant boundaries and ignore hostile client-supplied authorization fields.
- Request bodies on clinical routes use Zod schemas; a global throttler is active. Pino redacts authorization and cookie headers; error handling returns sanitized dependency errors. The scans found no SAST or HoundDog issues.
- No evidence-backed SSRF, unsafe URL-fetch, or command-execution feature was found in the searched application code. This is not a claim that every possible attack surface has been formally certified.

No additional authentication or tenant authorization defect was confirmed in this pass. Existing test coverage is not a substitute for a broader independent penetration test.

## Verification

| Check | Result |
|---|---|
| Focused CORS HTTP tests | **3/3 passed** |
| Full unit / HTTP suite | **103 files, 917/917 tests passed** |
| Disposable MySQL/MongoDB integration suite | **39/39 passed** |
| Existing authenticated browser recovery workflow | Passed within the disposable integration suite |
| TypeScript application check | Passed |
| Tenant-contract TypeScript check | Passed |
| ESLint | Passed; one existing warning in `test/encounter-operation-reconciliation.spec.ts` |
| Prettier check | Passed |
| Production build | Passed |
| Prisma schema validation | Passed using a local-format placeholder URL; no connection was made |
| JavaScript syntax checks | Passed |
| `git diff --check` | Passed |
| Local running app `/health` | HTTP 200 |
| Local running app `/ready` | HTTP 503, sanitized because no database is configured in this development environment |

## Remaining risks and readiness decision

1. **Unresolved production high advisories:** Prisma 6 / `@prisma/config` / `deepmerge-ts` and Zod 3 remain. Swagger's js-yaml moderate finding also remains. Plan and test the necessary major upgrades.
2. **Unresolved development critical advisories:** Vitest 3.2.7 and its vulnerable transitive packages remain because the resolver failed. Diagnose the npm resolver issue without bypassing it, then upgrade and rerun the full test matrix.
3. **Recovery and deployment readiness:** The Phase 50 report's provider/topology and recovery approvals, protected backup isolation, key custody, operational schedule/alerting/retention, restore rehearsal, and activation controls remain unverified or absent.
4. **CORS integration:** Before a cross-origin staging or production client is used, define and test an explicit trusted-origin allowlist. Current behavior intentionally fails closed.
5. **Readiness:** **NOT READY.** Do not deploy or claim production readiness until the high/critical dependency findings are addressed and the previously documented recovery and provider decisions are approved and verified.

No production access, production migration, deployment, Git staging, commit, stash, reset, or history rewrite was performed. Existing Phase 46 tests, Phase 49 artifacts, reports, attachments, and worktree changes were preserved.
