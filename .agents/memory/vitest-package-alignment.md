---
name: Vitest package alignment
description: Replit npm peer-resolution behavior when upgrading Vitest and its coverage provider.
---

Upgrade `vitest` and `@vitest/coverage-v8` to matching exact versions in the same package-manager operation. On the current Node 22/npm 10.9.9 toolchain, attempting Vitest 4.1.12 with mismatched or optional peer packages caused Arborist to fail with `Cannot read properties of null (reading 'edgesOut')`; aligning both packages to the registry's matching Vitest 5.1.0 release installed cleanly and passed the project test suite.

**Why:** This npm Arborist exception is a peer-graph resolution failure, not a package firewall block. Forcing or bypassing the resolver would hide the mismatch and weaken dependency verification.

**How to apply:** When updating Vitest, inspect the exact peers and update Vitest plus its coverage provider together; do not use force flags to work around an Arborist peer-set error.
