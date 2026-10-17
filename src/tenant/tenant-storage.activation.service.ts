import { Injectable } from '@nestjs/common';
import { Prisma, TenantStorageProvider, TenantStorageTargetStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { MongoTenantPatientStorage } from './mongo-tenant-patient.storage';
import { MongoTenantAppointmentStorage } from './mongo-tenant-appointment.storage';
import { MongoTenantEncounterStorage } from './mongo-tenant-encounter.storage';
import { TenantStorageUnavailableError } from './tenant-storage.errors';
import {
  TENANT_STORAGE_TARGET_SELECT,
  type TenantStorageTargetRecord,
} from './tenant-storage.registry';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Coordinates MongoDB index readiness with control-plane activation.
 * The registry routing identity (tenant, target, provider, connection reference,
 * and database name) is checked again inside the tenant-locked transaction.
 * Supported application paths register routing metadata but do not edit it;
 * any future metadata mutation must preserve this invariant.
 * MongoDB index DDL and the Prisma transaction cannot commit atomically; Patient
 * write paths also verify the required indexes and fail closed if they later drift.
 */
@Injectable()
export class TenantStorageActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientStorage: MongoTenantPatientStorage,
    private readonly appointmentStorage: MongoTenantAppointmentStorage,
    private readonly encounterStorage: MongoTenantEncounterStorage,
  ) {}

  async setTargetStatus(
    tenantId: string,
    targetId: string,
    status: TenantStorageTargetStatus,
  ): Promise<TenantStorageTargetRecord | null> {
    this.assertIdentifiers(tenantId, targetId);

    let verifiedTarget: TenantStorageTargetRecord | null = null;
    if (status === TenantStorageTargetStatus.ACTIVE) {
      verifiedTarget = await this.findTarget(tenantId, targetId);
      if (!verifiedTarget) return null;
      await this.ensureTenantStorageIndexes(verifiedTarget);
    }

    return this.prisma.$transaction(
      async (transaction) => {
        await this.lockTenant(transaction, tenantId);
        const current = await transaction.tenantStorageTarget.findFirst({
          where: {
            id: targetId,
            tenantId,
            provider: TenantStorageProvider.MONGODB,
          },
          select: TENANT_STORAGE_TARGET_SELECT,
        });
        if (!current) return null;

        if (status === TenantStorageTargetStatus.ACTIVE) {
          if (!verifiedTarget) return null;
          this.assertSameRoutingIdentity(verifiedTarget, current);
        }

        if (status === TenantStorageTargetStatus.ACTIVE && current.isPrimary) {
          const otherPrimary = await transaction.tenantStorageTarget.findFirst({
            where: {
              tenantId,
              provider: TenantStorageProvider.MONGODB,
              status: TenantStorageTargetStatus.ACTIVE,
              isPrimary: true,
              id: { not: targetId },
            },
            select: { id: true },
          });
          if (otherPrimary) throw new TenantStorageUnavailableError();
        }

        await transaction.tenantStorageTarget.updateMany({
          where: {
            id: targetId,
            tenantId,
            provider: TenantStorageProvider.MONGODB,
          },
          data: { status, updatedAt: new Date() },
        });
        return transaction.tenantStorageTarget.findFirst({
          where: {
            id: targetId,
            tenantId,
            provider: TenantStorageProvider.MONGODB,
          },
          select: TENANT_STORAGE_TARGET_SELECT,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async setPrimaryTarget(
    tenantId: string,
    targetId: string,
  ): Promise<TenantStorageTargetRecord | null> {
    this.assertIdentifiers(tenantId, targetId);
    const target = await this.findTarget(tenantId, targetId, TenantStorageTargetStatus.ACTIVE);
    if (!target) return null;
    await this.ensureTenantStorageIndexes(target);

    return this.prisma.$transaction(
      async (transaction) => {
        await this.lockTenant(transaction, tenantId);
        const current = await transaction.tenantStorageTarget.findFirst({
          where: {
            id: targetId,
            tenantId,
            provider: TenantStorageProvider.MONGODB,
            status: TenantStorageTargetStatus.ACTIVE,
          },
          select: TENANT_STORAGE_TARGET_SELECT,
        });
        if (!current) return null;
        this.assertSameRoutingIdentity(target, current);

        await transaction.tenantStorageTarget.updateMany({
          where: {
            tenantId,
            provider: TenantStorageProvider.MONGODB,
            status: TenantStorageTargetStatus.ACTIVE,
            isPrimary: true,
            id: { not: targetId },
          },
          data: { isPrimary: false, updatedAt: new Date() },
        });
        await transaction.tenantStorageTarget.updateMany({
          where: {
            id: targetId,
            tenantId,
            provider: TenantStorageProvider.MONGODB,
            status: TenantStorageTargetStatus.ACTIVE,
          },
          data: { isPrimary: true, updatedAt: new Date() },
        });
        return transaction.tenantStorageTarget.findFirst({
          where: {
            id: targetId,
            tenantId,
            provider: TenantStorageProvider.MONGODB,
          },
          select: TENANT_STORAGE_TARGET_SELECT,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private findTarget(
    tenantId: string,
    targetId: string,
    status?: TenantStorageTargetStatus,
  ): Promise<TenantStorageTargetRecord | null> {
    return this.prisma.tenantStorageTarget.findFirst({
      where: {
        id: targetId,
        tenantId,
        provider: TenantStorageProvider.MONGODB,
        ...(status ? { status } : {}),
      },
      select: TENANT_STORAGE_TARGET_SELECT,
    });
  }

  private async ensureTenantStorageIndexes(target: TenantStorageTargetRecord): Promise<void> {
    try {
      await this.patientStorage.ensureIndexesForTarget(target);
      await this.appointmentStorage.ensureIndexesForTarget(target);
      await this.encounterStorage.ensureIndexesForTarget(target);
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  private assertSameRoutingIdentity(
    verified: TenantStorageTargetRecord,
    current: TenantStorageTargetRecord,
  ): void {
    if (
      verified.id !== current.id ||
      verified.tenantId !== current.tenantId ||
      verified.provider !== current.provider ||
      verified.connectionReference !== current.connectionReference ||
      verified.databaseName !== current.databaseName
    ) {
      throw new TenantStorageUnavailableError();
    }
  }

  private async lockTenant(transaction: Prisma.TransactionClient, tenantId: string): Promise<void> {
    await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT \`id\` FROM \`Tenant\` WHERE \`id\` = ${tenantId} FOR UPDATE`,
    );
  }

  private assertIdentifiers(tenantId: string, targetId: string): void {
    if (!UUID_PATTERN.test(tenantId)) throw new Error('Invalid tenant identifier');
    if (!UUID_PATTERN.test(targetId)) {
      throw new Error('Invalid tenant storage target identifier');
    }
  }
}
