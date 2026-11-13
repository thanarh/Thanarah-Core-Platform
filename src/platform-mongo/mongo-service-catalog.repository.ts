import { Injectable } from '@nestjs/common';
import type { Collection, ClientSession, Db } from 'mongodb';
import { MongoTenantAuthorizationContext as Context } from './mongo-tenant-authorization.context';
import type {
  ServiceCatalogMutationResult,
  ServiceCatalogPersistencePort,
  ServiceCatalogRecord,
  ServiceCatalogListFilter,
  TenantCatalogStatusValue,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentValidationError,
  PlatformDocumentConflictError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import { documentTimestamps, newStableId, serviceCatalogSchema } from './platform-mongo.models';
import type { ServiceCatalogDocument, TenantDocument } from './platform-mongo.models';

class ServiceWriteConflict extends PlatformDocumentConflictError {
  constructor(readonly kind: 'name-conflict' | 'code-conflict' | 'conflict') {
    super();
  }
}

@Injectable()
export class MongoServiceCatalogRepository implements ServiceCatalogPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async create(
    tenantId: string,
    input: { name: string; code?: string; description?: string | null },
  ): Promise<ServiceCatalogMutationResult> {
    return this.mutate(tenantId, async (collection, db, session) => {
      if (!(await this.isTenantActive(db, tenantId, session))) return { kind: 'tenant-inactive' };
      const now = new Date();
      const document = this.parse({
        _id: newStableId(),
        ...documentTimestamps(now),
        schemaVersion: 1,
        tenantId,
        name: input.name,
        code: input.code ?? null,
        description: input.description ?? null,
        status: 'ACTIVE',
        statusChangedAt: now,
        suspendedAt: null,
        deactivatedAt: null,
      });
      try {
        await collection.insertOne(document, { session });
      } catch (error) {
        const conflict = this.uniqueConflict(error);
        if (conflict) throw new ServiceWriteConflict(conflict);
        throw error;
      }
      return { kind: 'changed', record: this.toRecord(document) };
    });
  }

  findById(tenantId: string, id: string): Promise<ServiceCatalogRecord | null> {
    return this.run(async (collection) => {
      const document = await collection.findOne({ _id: id, tenantId });
      return document ? this.toRecord(document) : null;
    });
  }

  list(
    tenantId: string,
    query: ServiceCatalogListFilter,
  ): Promise<{ items: ServiceCatalogRecord[]; total: number }> {
    return this.run(async (collection) => {
      const filter = { tenantId, ...(query.status ? { status: query.status } : {}) };
      const [documents, total] = await Promise.all([
        collection
          .find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(query.offset)
          .limit(query.limit)
          .toArray(),
        collection.countDocuments(filter),
      ]);
      return { items: documents.map((document) => this.toRecord(document)), total };
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: { name?: string; code?: string | null; description?: string | null },
  ): Promise<ServiceCatalogMutationResult> {
    return this.mutate(tenantId, async (collection, db, session) => {
      if (!(await this.isTenantActive(db, tenantId, session))) return { kind: 'tenant-inactive' };
      const $set: Partial<ServiceCatalogDocument> = { updatedAt: new Date() };
      if (input.name !== undefined) $set.name = input.name;
      if (input.code !== undefined) $set.code = input.code;
      if (input.description !== undefined) $set.description = input.description;
      try {
        const document = await collection.findOneAndUpdate(
          { _id: id, tenantId },
          { $set },
          { session, returnDocument: 'after' },
        );
        return document
          ? { kind: 'changed', record: this.toRecord(document) }
          : { kind: 'not-found' };
      } catch (error) {
        const conflict = this.uniqueConflict(error);
        if (conflict) throw new ServiceWriteConflict(conflict);
        throw error;
      }
    });
  }

  async changeStatusIfCurrent(
    tenantId: string,
    id: string,
    expectedStatus: TenantCatalogStatusValue,
    nextStatus: TenantCatalogStatusValue,
    changedAt: Date,
  ): Promise<ServiceCatalogMutationResult> {
    return this.mutate(tenantId, async (collection, db, session) => {
      if (!(await this.isTenantActive(db, tenantId, session))) return { kind: 'tenant-inactive' };
      const $set: Partial<ServiceCatalogDocument> = {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
      };
      if (nextStatus === 'SUSPENDED') $set.suspendedAt = changedAt;
      if (nextStatus === 'DEACTIVATED') $set.deactivatedAt = changedAt;
      const document = await collection.findOneAndUpdate(
        { _id: id, tenantId, status: expectedStatus },
        { $set },
        { session, returnDocument: 'after' },
      );
      return document
        ? { kind: 'changed', record: this.toRecord(document) }
        : { kind: 'not-changed' };
    });
  }

  private async isTenantActive(
    db: Awaited<ReturnType<PlatformMongoClientManager['getDatabase']>>,
    tenantId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const tenant = await db
      .collection<TenantDocument>('tenants')
      .findOne({ _id: tenantId }, { session, projection: { status: 1 } });
    return tenant?.status === 'ACTIVE';
  }

  private async mutate(
    tenantId: string,
    operation: (
      collection: Collection<ServiceCatalogDocument>,
      db: Db,
      session: ClientSession,
    ) => Promise<ServiceCatalogMutationResult>,
  ): Promise<ServiceCatalogMutationResult> {
    try {
      return await Context.run(this.manager, async (tx) => {
        await tx.touch('tenants', tenantId);
        return operation(tx.db.collection<ServiceCatalogDocument>('services'), tx.db, tx.session);
      });
    } catch (error) {
      if (error instanceof ServiceWriteConflict) return { kind: error.kind };
      if (error instanceof PlatformDocumentValidationError) throw error;
      throw new PlatformMongoUnavailableError();
    }
  }

  private async run<T>(
    operation: (
      collection: Collection<ServiceCatalogDocument>,
      db: Awaited<ReturnType<PlatformMongoClientManager['getDatabase']>>,
    ) => Promise<T>,
  ): Promise<T> {
    try {
      const db = await this.manager.getDatabase();
      return await operation(db.collection<ServiceCatalogDocument>('services'), db);
    } catch (error) {
      if (error instanceof PlatformDocumentValidationError) throw error;
      throw new PlatformMongoUnavailableError();
    }
  }

  private parse(value: unknown): ServiceCatalogDocument {
    const result = serviceCatalogSchema.safeParse(value);
    if (!result.success) throw new PlatformDocumentValidationError();
    return result.data;
  }

  private toRecord(document: ServiceCatalogDocument): ServiceCatalogRecord {
    const value = this.parse(document);
    return {
      id: value._id,
      name: value.name,
      code: value.code,
      description: value.description,
      status: value.status,
      statusChangedAt: value.statusChangedAt,
      suspendedAt: value.suspendedAt,
      deactivatedAt: value.deactivatedAt,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }

  private uniqueConflict(error: unknown): 'name-conflict' | 'code-conflict' | 'conflict' | null {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 11000) {
      return null;
    }
    const keyPattern =
      'keyPattern' in error && typeof error.keyPattern === 'object' && error.keyPattern !== null
        ? error.keyPattern
        : {};
    if ('name' in keyPattern) return 'name-conflict';
    if ('code' in keyPattern) return 'code-conflict';
    return 'conflict';
  }
}
