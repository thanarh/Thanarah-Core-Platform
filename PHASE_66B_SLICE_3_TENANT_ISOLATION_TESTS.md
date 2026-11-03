# Phase 66B — Slice 3: Tenant Isolation Test Results

**Date:** 2026-11-03

## Verified isolation conditions

- Tenant membership lookup is keyed by the exact `(tenantId, platformUserId)` pair.
- Active membership validation filters by both requested tenant and authenticated platform user, requires ACTIVE membership and ACTIVE tenant, and rejects returned records whose tenant or user does not match the requested pair.
- Membership ID lookup, listing, and lifecycle updates are scoped by the requested tenant ID.
- Lifecycle writes include tenant ID, membership ID, and current status in the conditional update; the transaction locks that tenant before mutation.
- Tenant workspace enumeration is filtered by the authenticated platform user, ACTIVE membership, and ACTIVE tenant.

## Negative regression evidence

- `test/tenant-authorization.spec.ts` verifies that a membership belonging to another tenant or another platform user cannot establish trusted context, and that missing/inactive membership fails closed.
- `test/tenant-membership.service.spec.ts` verifies that a membership ID addressed through a different tenant returns not found and that the requested tenant is passed to the scoped repository lookup.
- `test/tenant-membership.repository.spec.ts` verifies tenant-scoped lookups, list filters, conditional lifecycle writes, and active tenant/member query predicates.
- `test/tenant-workspace.controller.spec.ts` covers authenticated workspace listing.

These tests use mocks or synthetic data; they do not establish live database behavior or cross-adapter parity.
