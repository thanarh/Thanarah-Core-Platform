# Phase 66B — Slice 2: Platform Identity and Authentication Ports

**Date:** 2026-11-02
**Status:** Implemented incrementally; Prisma/MySQL remains the only active adapter. Migration readiness remains **NO-GO**.

## Implemented ports

| Port | Existing repository | Main consumers |
|---|---|---|
| `PlatformUserPersistencePort` | `PlatformUserRepository` | `AuthenticationService`, `PlatformAuthGuard` |
| `PlatformSessionPersistencePort` | `PlatformSessionRepository` | `PlatformSessionService`, `RefreshTokenService`, `PlatformAuthGuard` |
| `PlatformAuthorizationPersistencePort` | `PlatformAuthorizationRepository` | `PlatformAuthorizationService` |

The port contracts and injection tokens are application-owned in `src/persistence/platform-persistence.ports.ts`. They expose no Prisma or MongoDB types. `PlatformSessionPersistencePort` owns session and refresh-history operations together: no independent refresh-history repository was introduced because rotation and reuse handling are atomic across both models.

## Behavior retained

- Identity and login projections, normalized-email lookup behavior, and account status/token-version checks remain unchanged.
- Failed-login increments, threshold checks, lock timestamps, and reset behavior remain in `PlatformUserRepository`.
- Session listing remains ordered by `lastActivityAt DESC`; active-session filtering is unchanged.
- Session creation, scoped revocation, logout-all, refresh rotation, retry behavior, row-lock ordering, history writes, and reuse compromise remain in `PlatformSessionRepository`.
- Role/permission lookup projections and permission de-duplication are unchanged; issued token role IDs and claims are unchanged.
- Services and the auth guard now use the port types and explicit Nest injection tokens. `AuthPersistenceModule` binds the tokens to the existing repositories with `useExisting`.
- No MongoDB adapter is registered. No transaction ownership or public authentication policy was changed.

## Scope not covered

This slice does not port tenant membership/tenant-role authorization, catalog services' Prisma error handling or enum dependencies, or the remaining central persistence repositories. The other 16 of 22 central Prisma repositories remain unported.

This refactor does not establish that MongoDB can preserve these semantics. No data migration, dual-write, shadow-write, production change, deployment, or cutover was performed.
