# Thanarah Security Findings and Remediation

**Updated:** 2026-11-03  
**Disposition:** Unresolved findings; no dependency changes applied.

## Scanner totals and scope

The 2026-11-03 Replit dependency audit reported **2 critical, 2 high, and 11 moderate** findings. Replit SAST and HoundDog reported zero findings. Earlier npm audit results documented in `PHASE_51_SECURITY_HARDENING_REPORT.md` have different totals (full tree: 2 critical, 4 high, 4 moderate; production tree: 0 critical, 4 high, 2 moderate). These tools' totals are not interchangeable and may count package paths/advisories differently.

## Identified critical/high packages

| Finding | Dependency path / scope | Reported issue | Fix and compatibility status |
|---|---|---|---|
| Critical: `tinypool` 1.1.1 (two advisories) | Vitest test-runner dependency; development/test path | Prototype-pollution-to-code-execution advisories | Reported fixes 2.1.1 and 2.1.2; major-version line change. No compatibility or regression evidence; not applied |
| High: `deepmerge-ts` 7.1.5 | `prisma` → `@prisma/config` → `deepmerge-ts`; build/tooling dependency path | Recursive object graph can exhaust the stack | Scanner reports 8.0.0; major upgrade, with Prisma 7 also reported as a route. No compatibility proof; not applied |
| High: `zod` 3.25.76 | Direct application runtime dependency | Oversized invalid arrays can exhaust memory | Replit scan reports 4.6.6; prior npm report lists 4.6.7. Both are Zod 4 major upgrades. No compatibility proof; not applied |
| High findings in earlier npm audit | Production dependency tree; details in Phase 51 report | Four high npm findings were recorded, including the Prisma/deepmerge-ts and Zod paths | Replit and npm totals differ; all remain unresolved |

## Known moderate paths; incomplete inventory

- `vitest` / `@vitest/mocker` 3.2.7: prior reports identify two moderate advisories with fixes in the 4.1.x line; Vitest 4/5 changes require test-runner compatibility assessment.
- `@nestjs/swagger` → `js-yaml`: prior npm audit reports a moderate production-tree issue. The advisory fix for `js-yaml` was listed as 5.4.1; the package-level path was also reported as fixable via `@nestjs/swagger` 12.0.4, a major upgrade. No override or upgrade was retained.
- The current Replit scan's summarized report does not enumerate all 11 moderate findings individually. Earlier npm audit reports 2 moderate production and 2 moderate development/test findings, which do not reconcile with the Replit count. The remaining moderate package names, exact dependency paths, advisory IDs, and patched versions require a fresh package-level audit export before remediation can be considered complete.

## Actions and decision

- No dependency version or lockfile change was made in this continuation.
- A prior compatible Vitest update attempt failed in npm resolution (`Cannot read properties of null (reading 'edgesOut')`); no forced or legacy-peer-dependency bypass was used.
- No critical/high finding is dismissed because it is in development tooling.
- Do not apply major upgrades without isolated compatibility assessment and full regression evidence. A safe compatible patch/minor update may be applied only after its resolved version, path, and tests are verified.

The project remains **NOT READY** from a dependency-security perspective. This report does not claim the 11 moderate findings are fully enumerated or remediated.
