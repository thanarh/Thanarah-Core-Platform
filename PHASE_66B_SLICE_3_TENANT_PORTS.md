# Phase 66B — Slice 3: Tenant and Membership Ports

**Date:** 2026-11-03
**Status:** Implemented incrementally; Prisma/MySQL remains the only active adapter.

## Source audit and scope

- The central `Tenant` model is the application's organization record; there is no separate organization repository or hostname/domain-resolution repository in this source tree.
- Added separate application-owned `TenantPersistencePort` and `TenantMembershipPersistencePort` contracts. They retain the existing record fields, nullable timestamps, status values, and membership result states without exposing Prisma or MongoDB types.
- `TenantRepository` remains the tenant/organization Prisma adapter. `TenantMembershipRepository` remains the membership Prisma adapter.
- Migrated `TenantService`, `TenantMembershipService`, `TenantMembershipValidatorService`, and `TenantWorkspaceController` to explicit port-token injection.
- `TenantMembershipService` now uses the existing `PlatformUserPersistencePort` for identity lookup instead of injecting `PlatformUserRepository`.

## Safety boundaries

- Tenant membership lookups, list filters, and lifecycle writes continue to include the requested tenant ID.
- Active context resolution still requires a matching active membership and active tenant; invalid or mismatched membership records fail closed.
- Membership status changes retain the existing transaction, tenant row lock, optimistic status match, owner-assignment protection, and timestamp updates in the Prisma adapter.
- Tenant status changes retain the existing expected-status update and lifecycle timestamps.
- Pagination, stable ordering, uniqueness handling, audit behavior, and public service behavior remain unchanged.
- Prisma adapters are bound with `useExisting`; MongoDB repositories remain unregistered.

## Scope not covered

No separate organization persistence model or tenant hostname-resolution repository exists to port. Other tenant-role, staff, facility, catalog, entitlement, quota, subscription, scheduling, storage, and encounter persistence boundaries remain out of scope. Migration readiness remains **NO-GO**.
