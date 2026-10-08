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

const targetSelect = {
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
  select: typeof targetSelect;
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
      select: targetSelect,
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
      select: targetSelect,
    });
  }

  /** Enables a registered target only after external provisioning is complete. */
  setTargetStatus(
    tenantId: string,
    targetId: string,
    status: TenantStorageTargetStatus,
  ): Promise<TenantStorageTargetRecord | null> {
    this.assertTenantId(tenantId);
    this.assertTargetId(targetId);

    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.tenantStorageTarget.findFirst({
        where: { id: targetId, tenantId },
        select: targetSelect,
      });
      if (!current) return null;

      if (status === TenantStorageTargetStatus.ACTIVE && current.isPrimary) {
        const otherPrimary = await transaction.tenantStorageTarget.findFirst({
          where: {
            tenantId,
            status: TenantStorageTargetStatus.ACTIVE,
            isPrimary: true,
            id: { not: targetId },
          },
          select: { id: true },
        });
        if (otherPrimary) throw new TenantStorageUnavailableError();
      }

      await transaction.tenantStorageTarget.updateMany({
        where: { id: targetId, tenantId },
        data: { status, updatedAt: new Date() },
      });
      return transaction.tenantStorageTarget.findFirst({
        where: { id: targetId, tenantId },
        select: targetSelect,
      });
    });
  }

  /** Changes the active primary without deleting or moving any tenant data. */
  setPrimaryTarget(tenantId: string, targetId: string): Promise<TenantStorageTargetRecord | null> {
    this.assertTenantId(tenantId);
    this.assertTargetId(targetId);

    return this.prisma.$transaction(async (transaction) => {
      const target = await transaction.tenantStorageTarget.findFirst({
        where: {
          id: targetId,
          tenantId,
          provider: TenantStorageProvider.MONGODB,
          status: TenantStorageTargetStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (!target) return null;

      await transaction.tenantStorageTarget.updateMany({
        where: {
          tenantId,
          status: TenantStorageTargetStatus.ACTIVE,
          isPrimary: true,
          id: { not: targetId },
        },
        data: { isPrimary: false, updatedAt: new Date() },
      });
      await transaction.tenantStorageTarget.updateMany({
        where: { id: targetId, tenantId, status: TenantStorageTargetStatus.ACTIVE },
        data: { isPrimary: true, updatedAt: new Date() },
      });
      return transaction.tenantStorageTarget.findFirst({
        where: { id: targetId, tenantId },
        select: targetSelect,
      });
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

  private assertTargetId(targetId: string): void {
    if (!UUID_PATTERN.test(targetId)) throw new Error('Invalid tenant storage target identifier');
  }
}
