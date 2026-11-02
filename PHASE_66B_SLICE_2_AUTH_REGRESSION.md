# Phase 66B — Slice 2: Authentication Regression Results

**Date:** 2026-11-02

## Focused checks

| Coverage | Existing regression evidence |
|---|---|
| Login success and token claims | `test/platform-security.spec.ts`, `test/auth-foundation.spec.ts` |
| Invalid credentials, lockout threshold/timing, and reset after success | `test/auth-correction.spec.ts`, `test/platform-security.spec.ts` |
| Session creation and logout/logout-all revocation scope | `test/platform-security.spec.ts`, `test/platform-session.repository.spec.ts`, `test/auth.e2e.spec.ts`, `test/auth.controller.spec.ts` |
| Refresh rotation and refresh-history reuse detection | `test/platform-session.repository.spec.ts`, `test/auth-foundation.spec.ts` |
| Retryable transaction error and sanitized non-retryable failure | `test/platform-session.repository.spec.ts`, `test/auth-foundation.spec.ts`, `test/auth-correction.spec.ts` |
| Token-version and guard state checks | `test/auth-foundation.spec.ts` |
| DI token-to-Prisma adapter bindings | `test/platform-persistence-ports.di.spec.ts` |

Focused run: **8 test files passed; 93 tests passed**.

## Not verified

- **Concurrent refresh requests against MySQL: NOT VERIFIED.** Existing tests verify row-lock ordering, stale-token reuse mapping, and retry behavior with a mocked client; they do not reproduce real concurrent database transactions.
- **Database rollback on transaction failure: NOT VERIFIED.** Mocked transaction failures verify sanitized failure handling and propagation, but do not prove MySQL rolled back writes.
- No MongoDB session/history adapter tests were run or applicable; no such adapter is registered.

## Full checks

Full suite: **934 passed, 12 skipped** across 105 passing test files and 2 skipped opt-in integration files. TypeScript, build, lint, formatting, and diff validation passed; lint has one pre-existing warning documented in `PHASE_66B_REGRESSION_TEST_RESULTS.md`.

Migration readiness remains **NO-GO**.
