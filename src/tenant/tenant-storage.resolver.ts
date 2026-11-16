import { Inject, Injectable } from '@nestjs/common';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  isWellFormedTrustedTenantStorageContext,
} from './tenant-context.contract';
import type { TrustedTenantStorageContext } from './tenant-context.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from './tenant-storage.errors';
import type {
  NonEmptyReadonlyArray,
  TenantDatabaseRegistry,
  TenantStoragePlacement,
  TenantStoragePlacementId,
  TenantStorageResolver,
  TenantStorageRoute,
} from './tenant-storage.contract';

export const TENANT_DATABASE_REGISTRY = Symbol('TENANT_DATABASE_REGISTRY');
export const TENANT_STORAGE_RESOLVER = Symbol('TENANT_STORAGE_RESOLVER');

const DEVELOPMENT_MEMORY_PLACEMENT: TenantStoragePlacement = {
  placementId: 'development-memory' as TenantStoragePlacementId,
};

/** Explicit development-only logical placement; it does not represent a database. */
@Injectable()
export class DevelopmentTenantDatabaseRegistry implements TenantDatabaseRegistry {
  async getPlacements(
    context: TrustedTenantStorageContext,
  ): Promise<readonly TenantStoragePlacement[]> {
    if (!isWellFormedTrustedTenantStorageContext(context)) throw new TenantContextInvalidError();
    return [DEVELOPMENT_MEMORY_PLACEMENT];
  }
}

/** No physical tenant database is configured in this environment. */
@Injectable()
export class UnconfiguredTenantDatabaseRegistry implements TenantDatabaseRegistry {
  async getPlacements(
    context: TrustedTenantStorageContext,
  ): Promise<readonly TenantStoragePlacement[]> {
    if (!isWellFormedTrustedTenantStorageContext(context)) throw new TenantContextInvalidError();
    return [];
  }
}

@Injectable()
export class TenantStorageResolverService implements TenantStorageResolver {
  constructor(
    @Inject(TENANT_DATABASE_REGISTRY)
    private readonly registry: TenantDatabaseRegistry,
  ) {}

  async resolve(context: TrustedTenantStorageContext): Promise<TenantStorageRoute> {
    if (!context) throw new TenantContextRequiredError();
    if (!isWellFormedTrustedTenantStorageContext(context)) throw new TenantContextInvalidError();

    let placements: readonly TenantStoragePlacement[];
    try {
      placements = await this.registry.getPlacements(context);
    } catch (error) {
      if (
        error instanceof TenantStorageNotConfiguredError ||
        error instanceof TenantStorageUnavailableError ||
        error instanceof TenantContextInvalidError
      ) {
        throw error;
      }
      throw new TenantStorageUnavailableError();
    }

    if (!Array.isArray(placements) || placements.length === 0) {
      throw new TenantStorageNotConfiguredError();
    }
    if (
      placements.some(
        (placement) =>
          !placement ||
          typeof placement.placementId !== 'string' ||
          placement.placementId.trim().length === 0,
      )
    ) {
      throw new TenantStorageUnavailableError();
    }

    const firstPlacement = placements[0];
    if (!firstPlacement) throw new TenantStorageNotConfiguredError();
    const resolvedPlacements: NonEmptyReadonlyArray<TenantStoragePlacement> = [
      firstPlacement,
      ...placements.slice(1),
    ];

    return {
      placements: resolvedPlacements,
    };
  }
}
