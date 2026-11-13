import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { TenantStorageTargetStatus } from '../common/domain-enums';
import { MongoTenantPatientStorage } from '../tenant/mongo-tenant-patient.storage';
import { MongoTenantAppointmentStorage } from '../tenant/mongo-tenant-appointment.storage';
import { MongoTenantEncounterStorage } from '../tenant/mongo-tenant-encounter.storage';
import { MongoTenantClinicFinanceStorage } from '../tenant/mongo-tenant-clinic-finance.storage';
import type { TenantStorageTargetRecord } from '../tenant/tenant-storage.registry.contract';
import { TenantStorageUnavailableError } from '../tenant/tenant-storage.errors';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import type { MongoStorageTarget } from './mongo-tenant-storage-registry.service';
import { storageTargetRecord } from './mongo-tenant-storage-registry.service';
import { MongoTenantAuthorizationContext as Context } from './mongo-tenant-authorization.context';
import { mongoBusinessTransaction } from './mongo-business-transaction';

@Injectable()
export class MongoTenantStorageActivationService {
  constructor(
    private readonly manager: PlatformMongoClientManager,
    private readonly patientStorage: MongoTenantPatientStorage,
    private readonly appointmentStorage: MongoTenantAppointmentStorage,
    private readonly encounterStorage: MongoTenantEncounterStorage,
    private readonly clinicFinanceStorage: MongoTenantClinicFinanceStorage,
  ) {}

  setTargetStatus(
    tenantId: string,
    targetId: string,
    status: TenantStorageTargetStatus,
  ): Promise<TenantStorageTargetRecord | null> {
    return this.change(tenantId, targetId, status, false);
  }

  setPrimaryTarget(tenantId: string, targetId: string): Promise<TenantStorageTargetRecord | null> {
    return this.change(tenantId, targetId, 'ACTIVE', true);
  }

  private async change(
    tenantId: string,
    targetId: string,
    status: TenantStorageTargetStatus,
    primary: boolean,
  ): Promise<TenantStorageTargetRecord | null> {
    if (!z.string().uuid().safeParse(tenantId).success)
      throw new Error('Invalid tenant identifier');
    if (!z.string().uuid().safeParse(targetId).success)
      throw new Error('Invalid tenant storage target identifier');
    try {
      const verified =
        status === 'ACTIVE'
          ? await Context.run(this.manager, (tx) => this.find(tx, tenantId, targetId, primary))
          : null;
      if (status === 'ACTIVE' && !verified) return null;
      if (verified) {
        await this.patientStorage.ensureIndexesForTarget(verified);
        await this.appointmentStorage.ensureIndexesForTarget(verified);
        await this.encounterStorage.ensureIndexesForTarget(verified);
        await this.clinicFinanceStorage.ensureIndexesForTarget(verified);
      }
      return await mongoBusinessTransaction(this.manager, async (tx) => {
        if (!(await tx.touch('tenants', tenantId))) throw new TenantStorageUnavailableError();
        const current = await this.find(tx, tenantId, targetId, primary);
        if (!current) return null;
        if (status === 'ACTIVE' && (!verified || !this.sameRouting(verified, current)))
          throw new TenantStorageUnavailableError();
        const collection = tx.db.collection<MongoStorageTarget>('tenant_storage_targets');
        const now = new Date();
        if (primary) {
          await collection.updateMany(
            {
              tenantId,
              provider: 'MONGODB',
              status: 'ACTIVE',
              isPrimary: true,
              _id: { $ne: targetId },
            },
            { $set: { isPrimary: false, updatedAt: now } },
            { session: tx.session },
          );
        } else if (status === 'ACTIVE' && current.isPrimary) {
          if (
            await collection.findOne(
              {
                tenantId,
                provider: 'MONGODB',
                status: 'ACTIVE',
                isPrimary: true,
                _id: { $ne: targetId },
              },
              { session: tx.session },
            )
          )
            throw new TenantStorageUnavailableError();
        }
        const updated = await collection.findOneAndUpdate(
          { _id: targetId, tenantId, provider: 'MONGODB' },
          { $set: { status, ...(primary ? { isPrimary: true } : {}), updatedAt: now } },
          { session: tx.session, returnDocument: 'after' },
        );
        return updated ? storageTargetRecord(updated) : null;
      });
    } catch (error) {
      if (error instanceof TenantStorageUnavailableError) throw error;
      throw new TenantStorageUnavailableError();
    }
  }

  private async find(
    tx: Context,
    tenantId: string,
    targetId: string,
    active: boolean,
  ): Promise<TenantStorageTargetRecord | null> {
    const row = await tx.db.collection<MongoStorageTarget>('tenant_storage_targets').findOne(
      {
        _id: targetId,
        tenantId,
        provider: 'MONGODB',
        ...(active ? { status: 'ACTIVE' as const } : {}),
      },
      { session: tx.session },
    );
    return row ? storageTargetRecord(row) : null;
  }

  private sameRouting(a: TenantStorageTargetRecord, b: TenantStorageTargetRecord): boolean {
    return (
      a.id === b.id &&
      a.tenantId === b.tenantId &&
      a.provider === b.provider &&
      a.connectionReference === b.connectionReference &&
      a.databaseName === b.databaseName
    );
  }
}
