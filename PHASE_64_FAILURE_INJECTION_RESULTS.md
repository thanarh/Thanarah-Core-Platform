# Phase 64 — MongoDB Failure-Injection Results

**Date:** 2026-10-31
**Environment:** Disposable unauthenticated MongoDB 7.0.17 replica set, bound to loopback on ports 45271–45273; synthetic documents only.
**Result:** Two bounded injected-error cases and a separate controlled failover case passed. Ambiguous post-commit acknowledgement loss and transaction interruption by primary stepdown remain unverified.

## Results

| Scenario | Result | Evidence and limits |
|---|---|---|
| Retryable write after an injected connection close | **PASS, pre-execution failure only** | MongoDB `failCommand` closed the connection before one retryable insert executed. The application-managed client returned successfully and exactly one document existed. A subsequent insert passed after the failpoint was disabled. This does not simulate losing the acknowledgement after the write commits. |
| Transaction retry after an injected transient transaction error | **PASS, injected error only** | A one-use `TransientTransactionError` was injected on an insert inside `withTransaction`. The callback ran more than once; exactly one document committed. The failpoint was disabled in `finally`, and a normal insert then passed. |
| Controlled primary stepdown and client recovery | **PASS, separate from an in-flight transaction** | The primary was stepped down; the manager's replica-set seed-list client discovered a replacement primary and completed one synthetic write. |
| Uncertain acknowledgement after commit | **NOT RUN** | No safe, deterministic post-commit response-loss injector was available in this loopback lab. The pre-execution connection-close test is not equivalent. |
| Transaction interrupted by an actual primary stepdown | **NOT RUN** | Transient transaction retry was tested, and stepdown recovery was tested separately. The stepdown did not occur during an active application transaction. |
| Network timeout/topology error sanitized in a live app request | **NOT RUN** | Existing unit tests cover sanitized manager connection failures; no live application request was forced through an exhausted selection timeout or topology outage. |

## Retry safety

The injected retryable insert was acknowledged and then read back exactly once. The transaction helper retried only after receiving the injected transient-transaction label and committed one row. Neither result proves that an arbitrary application command is safe to retry after an ambiguous acknowledgement. Before retrying a business operation, the application must establish whether it committed using an idempotency key/operation ledger or another approved invariant; do not blindly retry non-idempotent writes.

All injected failpoints were disabled in `finally` blocks and followed by successful writes to check that the failure state was cleared. Test data was contained in the dedicated Phase 64 database and removed during cleanup.
