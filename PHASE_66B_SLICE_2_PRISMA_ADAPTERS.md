# Phase 66B — Slice 2: Prisma Adapter Mapping

**Date:** 2026-11-02

| Port | Adapter | Persistence behavior retained |
|---|---|---|
| `PlatformUserPersistencePort` | `PlatformUserRepository` | Existing User projections; `findUnique` identity/email lookup; transactional failed-login increment and threshold lock; single-update reset. |
| `PlatformSessionPersistencePort` | `PlatformSessionRepository` | Existing session queries, ordering and scoped revocation; refresh rotation and history writes stay in one Prisma transaction; same session-row lock order, `ReadCommitted` isolation, retry rules, and result mapping. |
| `PlatformAuthorizationPersistencePort` | `PlatformAuthorizationRepository` | Existing user-role and role-permission projections; same role IDs/codes and de-duplicated permission list. |

All three tokens are bound with `useExisting` in `AuthPersistenceModule`; each class remains the sole Prisma-backed adapter for its boundary. No MongoDB implementation is registered.

## Transaction ownership and risk

- Login lockout remains owned by `PlatformUserRepository.recordFailedLogin`.
- Session revocation retains its existing single-statement conditional update.
- Refresh rotation, refresh-history creation, and reuse compromise retain the current transaction in `PlatformSessionRepository.rotateByRefreshTokenHash`.
- No session/history operation was split across independently injected repositories.
- Tests use mocked Prisma clients. Real MySQL concurrent refresh behavior and rollback after a database transaction failure were not independently verified in this slice.
