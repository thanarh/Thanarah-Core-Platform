import type { TrustedTenantContext } from './tenant-context.contract';

declare const tenantStoragePlacementIdBrand: unique symbol;

/** Opaque registry-owned placement reference, not a database name or URI. */
export type TenantStoragePlacementId = string & {
  readonly [tenantStoragePlacementIdBrand]: true;
};

export interface TenantStoragePlacement {
  readonly placementId: TenantStoragePlacementId;
}

export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/**
 * A resolved tenant can span multiple placements. An empty route is invalid
 * for an operation and must fail closed rather than fall back to global data.
 */
export interface TenantStorageRoute {
  readonly placements: NonEmptyReadonlyArray<TenantStoragePlacement>;
}

/** Server-side placement metadata lookup; never accepts a database name from a caller. */
export interface TenantDatabaseRegistry {
  getPlacements(context: TrustedTenantContext): Promise<readonly TenantStoragePlacement[]>;
}

/** Resolves a non-empty route from trusted context through registry/policy infrastructure. */
export interface TenantStorageResolver {
  resolve(context: TrustedTenantContext): Promise<TenantStorageRoute>;
}

/**
 * Generic tenant-owned repositories require explicit trusted scope for every
 * operation. Implementations must constrain queries to context.tenantId and
 * must not accept an independent tenant selector or use an unscoped fallback.
 * Add operations here only when they preserve that requirement.
 */
export interface TenantScopedRepository<TEntity, TEntityId = string> {
  findById(context: TrustedTenantContext, id: TEntityId): Promise<TEntity | null>;
}
