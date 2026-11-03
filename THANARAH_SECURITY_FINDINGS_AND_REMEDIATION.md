# Thanarah Security Findings and Remediation

**Updated:** 2026-11-03  
**Disposition:** Unresolved findings; no dependency changes applied.

## Scanner totals and scope

The 2026-11-03 Replit dependency audit reported **2 critical, 2 high, and 11 moderate** findings. Replit SAST and HoundDog reported zero findings. Earlier npm audit results documented in `PHASE_51_SECURITY_HARDENING_REPORT.md` have different totals (full tree: 2 critical, 4 high, 4 moderate; production tree: 0 critical, 4 high, 2 moderate). These tools' totals are not interchangeable and may count package paths/advisories differently.

## Enumerated package/advisory findings

The fresh scan reports 15 advisory/package instances: 2 critical, 2 high, and 11 moderate. Dependency paths and runtime/development scope below were reconciled with `npm explain`; all findings are recorded against `package-lock.json`.

| Finding | Dependency path / scope | Reported issue | Fix and compatibility status |
|---|---|---|---|
| Critical: `tinypool` 1.1.1 — GHSA-5gmw-xhrv-c9v3 | `vitest` → `tinypool`; development/test | Prototype-pollution gadget can influence worker options and lead to code execution | 2.1.1 reported; major update; not applied |
| Critical: `tinypool` 1.1.1 — GHSA-85c8-ppgw-ccpr | `vitest` → `tinypool`; development/test | Prototype-pollution gadget can redirect worker loading | 2.1.2 reported; major update; not applied |
| High: `deepmerge-ts` 7.1.5 — GHSA-ggr8-5vv4-36mx | `prisma` → `@prisma/config` → `deepmerge-ts`; development/tooling | Recursive object graphs can exhaust the stack | 8.0.0 reported; major update; not applied |
| High: `zod` 3.25.76 — GHSA-mrhx-c7xc-m3w5 | Root direct dependency; runtime | Oversized invalid arrays can exhaust memory | 4.6.6 reported; major update; not applied |
| Moderate: `@vitest/mocker` 3.2.7 — GHSA-82fw-gwwq-j7x9 | `vitest` → `@vitest/mocker`; development/test | Redirect mock path validation gap | 4.1.11 reported; major update; not applied |
| Moderate: `@vitest/mocker` 3.2.7 — GHSA-qxg6-89mg-rqv8 | `vitest` → `@vitest/mocker`; development/test | Manual mock URL code injection | 4.1.12 reported; major update; not applied |
| Moderate: `vitest` 3.2.7 — GHSA-82fw-gwwq-j7x9 | Root direct dev dependency | Same mocker redirect path validation advisory | 4.1.11 reported; major update; not applied |
| Moderate: `deepmerge` 4.3.1 — GHSA-gcqx-w48m-w2h4 | `@nestjs/cli` → `fork-ts-checker-webpack-plugin` → `deepmerge`; development/tooling | Prototype poisoning | No fix version reported by this scan |
| Moderate: `glob` 13.0.6 — GHSA-3g3m-2fjr-6pw4 | `@fastify/static` and Nest CLI dependency paths; runtime/tooling | Abort can leave filesystem traversal running | 14.0.2 reported; major update; not applied |
| Moderate: `glob` 10.5.0 — GHSA-3g3m-2fjr-6pw4 | `testcontainers` → `archiver` → `archiver-utils` → `glob`; development/test | Abort can leave filesystem traversal running | 14.0.2 reported; major update; not applied |
| Moderate: `js-yaml` 5.3.0 — GHSA-r3ph-w7gj-g6xm | `@nestjs/swagger` 11.4.7 pins `js-yaml` exactly at 5.3.0; runtime | Denial of service in YAML parsing | 5.4.1 reported; same major, but exact parent pin means an override or Swagger update is required. Not applied without isolated compatibility evidence |
| Moderate: `minimatch` 10.2.6 — GHSA-g3hv-75wg-m249 | TypeScript ESLint toolchain; development | Pattern amplification / resource exhaustion | 11.0.1 reported; major update; not applied |
| Moderate: `minimatch` 9.0.9 — GHSA-g3hv-75wg-m249 | `testcontainers` → `archiver` → `archiver-utils` → `glob` → `minimatch`; development/test | Pattern amplification / resource exhaustion | 11.0.1 reported; major update; not applied |
| Moderate: `minimatch` 5.1.9 — GHSA-g3hv-75wg-m249 | `testcontainers` → `archiver` → `readdir-glob` → `minimatch`; development/test | Pattern amplification / resource exhaustion | 11.0.1 reported; major update; not applied |
| Moderate: `minimatch` 3.1.5 — GHSA-g3hv-75wg-m249 | ESLint configuration; development | Pattern amplification / resource exhaustion | 11.0.1 reported; major update; not applied |

## Actions and decision

- No dependency version or lockfile change was made in this continuation.
- The only reported non-major fix is `js-yaml` 5.4.1; the installed parent pins 5.3.0 exactly, so applying it needs an override or parent update. It remains unapplied without isolated compatibility evidence.
- No critical/high finding is dismissed because it is in development tooling.
- Do not apply major upgrades without isolated compatibility assessment and full regression evidence.

The project remains **NOT READY** from a dependency-security perspective. Findings are enumerated but not remediated.
