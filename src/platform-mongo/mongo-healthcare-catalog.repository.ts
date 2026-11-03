import { Injectable } from '@nestjs/common';
import type { Collection } from 'mongodb';
import type {
  HealthcareCatalogKindValue,
  HealthcareCatalogListFilter,
  HealthcareCatalogMutationResult,
  HealthcareCatalogPersistencePort,
  HealthcareCatalogRecord,
  TenantCatalogStatusValue,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import {
  departmentSchema,
  documentTimestamps,
  newStableId,
  specialtySchema,
} from './platform-mongo.models';
import type {
  DepartmentDocument,
  SpecialtyDocument,
  TenantDocument,
} from './platform-mongo.models';

type HealthcareDocument = DepartmentDocument | SpecialtyDocument;

@Injectable()
export class MongoHealthcareCatalogRepository implements HealthcareCatalogPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async create(
    kind: HealthcareCatalogKindValue,
    tenantId: string,
    input: { name: string; description?: string | null },
  ): Promise<HealthcareCatalogMutationResult> {
    return this.write(kind, async (collection, db) => {
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: tenantId }, { projection: { status: 1 } });
      if (tenant?.status !== 'ACTIVE') return { kind: 'tenant-inactive' };
      const now = new Date();
      const document = this.parse(kind, {
        _id: newStableId(),
        ...documentTimestamps(now),
        schemaVersion: 1,
        tenantId,
        name: input.name,
        description: input.description ?? null,
        status: 'ACTIVE',
        statusChangedAt: now,
        suspendedAt: null,
        deactivatedAt: null,
      });
      try {
        await collection.insertOne(document);
      } catch (error) {
        if (this.isDuplicateKey(error)) return { kind: 'name-conflict' };
        throw error;
      }
      return { kind: 'changed', record: this.toRecord(kind, document) };
    });
  }

  findById(
    kind: HealthcareCatalogKindValue,
    tenantId: string,
    id: string,
  ): Promise<HealthcareCatalogRecord | null> {
    return this.read(kind, async (collection) => {
      const document = await collection.findOne({ _id: id, tenantId });
      return document ? this.toRecord(kind, document) : null;
    });
  }

  list(
    kind: HealthcareCatalogKindValue,
    tenantId: string,
    query: HealthcareCatalogListFilter,
  ): Promise<HealthcareCatalogRecord[]> {
    return this.read(kind, async (collection) => {
      const documents = await collection
        .find({ tenantId, ...(query.status ? { status: query.status } : {}) })
        .sort({ createdAt: -1, _id: -1 })
        .skip(query.offset)
        .limit(query.limit)
        .toArray();
      return documents.map((document) => this.toRecord(kind, document));
    });
  }

  async update(
    kind: HealthcareCatalogKindValue,
    tenantId: string,
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<HealthcareCatalogMutationResult> {
    return this.write(kind, async (collection, db) => {
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: tenantId }, { projection: { status: 1 } });
      if (tenant?.status !== 'ACTIVE') return { kind: 'tenant-inactive' };
      try {
        const $set: Partial<HealthcareDocument> = { updatedAt: new Date() };
        if (input.name !== undefined) $set.name = input.name;
        if (input.description !== undefined) $set.description = input.description;
        const document = await collection.findOneAndUpdate(
          { _id: id, tenantId },
          { $set },
          { returnDocument: 'after' },
        );
        return document
          ? { kind: 'changed', record: this.toRecord(kind, document) }
          : { kind: 'not-found' };
      } catch (error) {
        if (this.isDuplicateKey(error)) return { kind: 'name-conflict' };
        throw error;
      }
    });
  }

  async changeStatusIfCurrent(
    kind: HealthcareCatalogKindValue,
    tenantId: string,
    id: string,
    expectedStatus: TenantCatalogStatusValue,
    nextStatus: TenantCatalogStatusValue,
    changedAt: Date,
  ): Promise<HealthcareCatalogMutationResult> {
    return this.write(kind, async (collection, db) => {
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: tenantId }, { projection: { status: 1 } });
      if (tenant?.status !== 'ACTIVE') return { kind: 'tenant-inactive' };
      const $set: Partial<HealthcareDocument> = {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
      };
      if (nextStatus === 'SUSPENDED') $set.suspendedAt = changedAt;
      if (nextStatus === 'DEACTIVATED') $set.deactivatedAt = changedAt;
      const document = await collection.findOneAndUpdate(
        { _id: id, tenantId, status: expectedStatus },
        { $set },
        { returnDocument: 'after' },
      );
      return document
        ? { kind: 'changed', record: this.toRecord(kind, document) }
        : { kind: 'not-changed' };
    });
  }

  private collectionName(kind: HealthcareCatalogKindValue): 'departments' | 'specialties' {
    return kind === 'department' ? 'departments' : 'specialties';
  }

  private parse(kind: HealthcareCatalogKindValue, value: unknown): HealthcareDocument {
    const result =
      kind === 'department' ? departmentSchema.safeParse(value) : specialtySchema.safeParse(value);
    if (!result.success) throw new PlatformDocumentValidationError();
    return result.data;
  }

  private toRecord(
    kind: HealthcareCatalogKindValue,
    document: HealthcareDocument,
  ): HealthcareCatalogRecord {
    const value = this.parse(kind, document);
    return {
      id: value._id,
      tenantId: value.tenantId,
      name: value.name,
      description: value.description,
      status: value.status,
      statusChangedAt: value.statusChangedAt,
      suspendedAt: value.suspendedAt,
      deactivatedAt: value.deactivatedAt,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }

  private async read<T>(
    kind: HealthcareCatalogKindValue,
    operation: (collection: Collection<HealthcareDocument>) => Promise<T>,
  ): Promise<T> {
    return this.run(kind, operation);
  }

  private async write<T>(
    kind: HealthcareCatalogKindValue,
    operation: (
      collection: Collection<HealthcareDocument>,
      db: Awaited<ReturnType<PlatformMongoClientManager['getDatabase']>>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.run(kind, async (collection, db) => operation(collection, db));
  }

  private async run<T>(
    kind: HealthcareCatalogKindValue,
    operation: (
      collection: Collection<HealthcareDocument>,
      db: Awaited<ReturnType<PlatformMongoClientManager['getDatabase']>>,
    ) => Promise<T>,
  ): Promise<T> {
    try {
      const db = await this.manager.getDatabase();
      return await operation(db.collection<HealthcareDocument>(this.collectionName(kind)), db);
    } catch (error) {
      if (error instanceof PlatformDocumentValidationError) throw error;
      throw new PlatformMongoUnavailableError();
    }
  }

  private isDuplicateKey(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
  }
}
