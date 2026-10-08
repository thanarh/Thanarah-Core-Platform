---
name: Vitest Nest provider identity
description: Avoid duplicate Nest injection tokens in container-backed integration tests using compiled output.
---

For Vitest integration tests that bootstrap Nest from compiled `dist`, load `AppModule` and runtime class or symbol provider tokens from the same Node CommonJS module cache. Keep type-only imports separate from runtime imports.

**Why:** Vitest's TypeScript loader and Node's compiled CommonJS loader can create distinct class or symbol identities for logically identical modules. Nest then treats the tokens as different, so provider overrides may miss and duplicate dependencies may load.

**How to apply:** For container-backed tests that run `nest build` before Vitest, create a workspace-rooted `createRequire` for runtime classes and injection tokens from `dist`; use Vitest imports only for types.
