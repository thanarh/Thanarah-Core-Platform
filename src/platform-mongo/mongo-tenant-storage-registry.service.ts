import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { TrustedTenantStorageContext } from '../tenant/tenant-context.contract';
import {
  isWellFormedTrustedTenantStorageContext,
  TenantContextInvalidError,
} from '../tenant/tenant-context.contract';
import type {
  TenantDatabaseRegistry,
  TenantStoragePlacement,
  TenantStoragePlacementId,
} from '../tenant/tenant-storage.contract';
import type {
  TenantStorageTargetRecord,
  TenantStorageTargetResolver,
} from '../tenant/tenant-storage.registry.contract';
import { TenantStorageUnavailableError } from '../tenant/tenant-storage.errors';
import { isValidTenantMongoDatabaseName } from '../tenant/tenant-mongo.constants';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import { newStableId, documentTimestamps } from './platform-mongo.models';
import {
  MongoTenantAuthorizationContext as Context,
  parseMongoDocument,
} from './mongo-tenant-authorization.context';
import { mongoBusinessTransaction } from './mongo-business-transaction';

export const mongoStorageTargetSchema = z
  .object({
    _id: z.string().uuid(),
    tenantId: z.string().uuid(),
    provider: z.literal('MONGODB'),
    connectionReference: z.literal('primary'),
    databaseName: z.string().refine(isValidTenantMongoDatabaseName),
    status: z.enum(['ACTIVE', 'INACTIVE']),
    isPrimary: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type MongoStorageTarget = z.infer<typeof mongoStorageTargetSchema>;
export function storageTargetRecord(value: MongoStorageTarget): TenantStorageTargetRecord {
  const { _id, ...fields } = parseMongoDocument(mongoStorageTargetSchema, value);
  return { id: _id, ...fields };
}

@Injectable()
export class MongoTenantStorageRegistryService
  implements TenantDatabaseRegistry, TenantStorageTargetResolver
{
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async getPlacements(
    context: TrustedTenantStorageContext,
  ): Promise<readonly TenantStoragePlacement[]> {
    this.assertContext(context);
    return this.run(async (tx) => {
      const targets = await tx.db
        .collection<MongoStorageTarget>('tenant_storage_targets')
        .find(
          { tenantId: context.tenantId, provider: 'MONGODB', status: 'ACTIVE', isPrimary: true },
          { session: tx.session },
        )
        .sort({ createdAt: 1, _id: 1 })
        .limit(2)
        .toArray();
      if (targets.length > 1) throw new TenantStorageUnavailableError();
      const row = targets[0] ? parseMongoDocument(mongoStorageTargetSchema, targets[0]) : null;
      return row ? [{ placementId: row._id as TenantStoragePlacementId }] : [];
    });
  }

  async findActivePrimaryTarget(
    context: TrustedTenantStorageContext,
    placementId: string,
  ): Promise<TenantStorageTargetRecord | null> {
    this.assertContext(context);
    if (!z.string().uuid().safeParse(placementId).success) return null;
    return this.run(async (tx) => {
      const row = await tx.db.collection<MongoStorageTarget>('tenant_storage_targets').findOne(
        {
          _id: placementId,
          tenantId: context.tenantId,
          provider: 'MONGODB',
          status: 'ACTIVE',
          isPrimary: true,
        },
        { session: tx.session },
      );
      return row ? storageTargetRecord(row) : null;
    });
  }

  async registerTarget(tenantId: string, databaseName: string): Promise<TenantStorageTargetRecord> {
    if (!z.string().uuid().safeParse(tenantId).success)
      throw new Error('Invalid tenant identifier');
    if (!isValidTenantMongoDatabaseName(databaseName))
      throw new Error('Invalid tenant storage database name');
    return this.run(async (tx) => {
      if (!(await tx.touch('tenants', tenantId))) throw new TenantStorageUnavailableError();
      const row = parseMongoDocument(mongoStorageTargetSchema, {
        _id: newStableId(),
        tenantId,
        databaseName,
        provider: 'MONGODB',
        connectionReference: 'primary',
        status: 'INACTIVE',
        isPrimary: false,
        ...documentTimestamps(),
      });
      await tx.db
        .collection<MongoStorageTarget>('tenant_storage_targets')
        .insertOne(row, { session: tx.session });
      return storageTargetRecord(row);
    });
  }

  private async run<T>(operation: (tx: Context) => Promise<T>): Promise<T> {
    try {
      return await mongoBusinessTransaction(this.manager, operation);
    } catch (error) {
      if (error instanceof TenantStorageUnavailableError) throw error;
      throw new TenantStorageUnavailableError();
    }
  }

  private assertContext(context: TrustedTenantStorageContext): void {
    if (!context || !isWellFormedTrustedTenantStorageContext(context))
      throw new TenantContextInvalidError();
  }
}
