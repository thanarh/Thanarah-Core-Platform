import { Injectable } from '@nestjs/common';
import { Prisma, TenantStorageProvider, TenantStorageTargetStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { isValidTenantMongoDatabaseName } from './tenant-mongo.constants';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantStorageUnavailableError } from './tenant-storage.errors';
import type {
  TenantDatabaseRegistry,
  TenantStoragePlacement,
  TenantStoragePlacementId,
} from './tenant-storage.contract';

export const TENANT_STORAGE_TARGET_RESOLVER = Symbol('TENANT_STORAGE_TARGET_RESOLVER');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const TENANT_STORAGE_TARGET_SELECT = {
  id: true,
  tenantId: true,
  provider: true,
  connectionReference: true,
  databaseName: true,
  status: true,
  isPrimary: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantStorageTargetSelect;

export type TenantStorageTargetRecord = Prisma.TenantStorageTargetGetPayload<{
  select: typeof TENANT_STORAGE_TARGET_SELECT;
}>;

export interface TenantStorageTargetResolver {
  findActivePrimaryTarget(
    context: TrustedTenantContext,
    placementId: string,
  ): Promise<TenantStorageTargetRecord | null>;
}

/**
 * Central control-plane metadata only. The registry stores an allowlisted
 * connection reference and database name, never a connection string.
 */
@Injectable()
export class TenantStorageRegistryService
  implements TenantDatabaseRegistry, TenantStorageTargetResolver
{
  constructor(private readonly prisma: PrismaService) {}

  async getPlacements(context: TrustedTenantContext): Promise<readonly TenantStoragePlacement[]> {
    this.assertContext(context);
    const targets = await this.prisma.tenantStorageTarget.findMany({
      where: {
        tenantId: context.tenantId,
        provider: TenantStorageProvider.MONGODB,
        status: TenantStorageTargetStatus.ACTIVE,
        isPrimary: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 2,
      select: { id: true },
    });

    if (targets.length > 1) throw new TenantStorageUnavailableError();
    const target = targets[0];
    return target ? [{ placementId: target.id as TenantStoragePlacementId }] : [];
  }

  async findActivePrimaryTarget(
    context: TrustedTenantContext,
    placementId: string,
  ): Promise<TenantStorageTargetRecord | null> {
    this.assertContext(context);
    if (!UUID_PATTERN.test(placementId)) return null;

    return this.prisma.tenantStorageTarget.findFirst({
      where: {
        id: placementId,
        tenantId: context.tenantId,
        provider: TenantStorageProvider.MONGODB,
        status: TenantStorageTargetStatus.ACTIVE,
        isPrimary: true,
      },
      select: TENANT_STORAGE_TARGET_SELECT,
    });
  }

  /** Registers an already-provisioned target as inactive; it never creates a Mongo database. */
  registerTarget(tenantId: string, databaseName: string): Promise<TenantStorageTargetRecord> {
    this.assertTenantId(tenantId);
    if (!isValidTenantMongoDatabaseName(databaseName)) {
      throw new Error('Invalid tenant storage database name');
    }

    return this.prisma.tenantStorageTarget.create({
      data: {
        tenantId,
        provider: TenantStorageProvider.MONGODB,
        connectionReference: 'primary',
        databaseName,
        status: TenantStorageTargetStatus.INACTIVE,
        isPrimary: false,
      },
      select: TENANT_STORAGE_TARGET_SELECT,
    });
  }

  private assertContext(context: TrustedTenantContext): void {
    if (!context || !isWellFormedTrustedTenantContext(context)) {
      throw new TenantContextInvalidError();
    }
  }

  private assertTenantId(tenantId: string): void {
    if (!UUID_PATTERN.test(tenantId)) throw new Error('Invalid tenant identifier');
  }
}
