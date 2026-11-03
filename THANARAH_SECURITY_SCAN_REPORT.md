# Thanarah Security Scan Report

**Scanned:** 2026-11-03 (fresh scan during migration continuation)
**Scope:** Dependency audit, static analysis, and privacy/dataflow scan.

| Scanner | Result |
|---|---|
| Dependency audit | 2 critical, 2 high, 11 moderate; 0 low; 0 informational |
| SAST | 0 findings |
| HoundDog | 0 findings |

## Critical and high dependency findings

- **Critical — `tinypool` 1.1.1:** two prototype-pollution-to-code-execution advisories. Scanner fixes are 2.1.1 and 2.1.2, both major-version updates.
- **High — `deepmerge-ts` 7.1.5:** recursive object graphs can exhaust the stack. Scanner fix is 8.0.0, a major update.
- **High — `zod` 3.25.76:** oversized invalid arrays can exhaust memory. Scanner fix is 4.6.6, a major update.

The fresh audit enumerated all 15 advisory/package instances (2 critical, 2 high, 11 moderate), including the `vitest` / `@vitest/mocker` 3.2.7 advisories, `glob`, `minimatch`, `deepmerge`, and `js-yaml`. Exact package paths, scopes, advisory IDs, and fix lines are in `THANARAH_SECURITY_FINDINGS_AND_REMEDIATION.md`. Only `js-yaml` has a reported non-major fix; it was not changed pending a compatibility check.

## Action taken

No dependency was changed. The fixes require major-version upgrades that can affect test tooling, schema validation, and build behavior. Approval is pending before applying those breaking upgrades. Existing type-check, Nest build, and full tests passed on the current dependency set; this does not remove the reported vulnerabilities.
