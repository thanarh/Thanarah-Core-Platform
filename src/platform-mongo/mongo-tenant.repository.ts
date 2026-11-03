import { Injectable } from '@nestjs/common';
import type { Collection } from 'mongodb';
import type {
  TenantListFilter,
  TenantPersistencePort,
  TenantRecord,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import { documentTimestamps, newStableId, tenantSchema } from './platform-mongo.models';
import type { TenantDocument } from './platform-mongo.models';

@Injectable()
export class MongoTenantRepository implements TenantPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async create(input: {
    slug: string;
    legalName: string;
    displayName: string;
  }): Promise<TenantRecord> {
    const now = new Date();
    const document: TenantDocument = {
      _id: newStableId(),
      ...documentTimestamps(now),
      schemaVersion: 1,
      ...input,
      status: 'ACTIVE',
      statusChangedAt: now,
      suspendedAt: null,
      deactivatedAt: null,
    };
    return this.write(async (collection) => {
      const parsed = this.parse(document);
      await collection.insertOne(parsed);
      return this.toRecord(parsed);
    });
  }

  findById(id: string): Promise<TenantRecord | null> {
    return this.read(async (collection) => {
      const document = await collection.findOne({ _id: id });
      return document ? this.toRecord(document) : null;
    });
  }

  findBySlug(slug: string): Promise<TenantRecord | null> {
    return this.read(async (collection) => {
      const document = await collection.findOne({ slug });
      return document ? this.toRecord(document) : null;
    });
  }

  list(filter: TenantListFilter): Promise<TenantRecord[]> {
    return this.read(async (collection) => {
      const documents = await collection
        .find(filter.status ? { status: filter.status } : {})
        .sort({ createdAt: -1, _id: -1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .toArray();
      return documents.map((document) => this.toRecord(document));
    });
  }

  async changeStatusIfCurrent(
    id: string,
    expectedStatus: TenantRecord['status'],
    nextStatus: TenantRecord['status'],
    changedAt: Date,
  ): Promise<TenantRecord | null> {
    return this.write(async (collection) => {
      const set: Partial<TenantDocument> = {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
      };
      if (nextStatus === 'SUSPENDED') set.suspendedAt = changedAt;
      if (nextStatus === 'DEACTIVATED') set.deactivatedAt = changedAt;
      const updated = await collection.findOneAndUpdate(
        { _id: id, status: expectedStatus },
        { $set: set },
        { returnDocument: 'after' },
      );
      return updated ? this.toRecord(updated) : null;
    });
  }

  private async read<T>(
    operation: (collection: Collection<TenantDocument>) => Promise<T>,
  ): Promise<T> {
    try {
      const db = await this.manager.getDatabase();
      return await operation(db.collection<TenantDocument>('tenants'));
    } catch (error) {
      this.rethrow(error);
    }
  }

  private write<T>(operation: (collection: Collection<TenantDocument>) => Promise<T>): Promise<T> {
    return this.read(operation);
  }

  private parse(value: unknown): TenantDocument {
    const parsed = tenantSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private toRecord(value: unknown): TenantRecord {
    const document = this.parse(value);
    return {
      id: document._id,
      slug: document.slug,
      legalName: document.legalName,
      displayName: document.displayName,
      status: document.status,
      statusChangedAt: document.statusChangedAt,
      suspendedAt: document.suspendedAt,
      deactivatedAt: document.deactivatedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private rethrow(error: unknown): never {
    if (
      error instanceof PlatformDocumentValidationError ||
      error instanceof PlatformDocumentConflictError
    ) {
      throw error;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    ) {
      throw new PlatformDocumentConflictError();
    }
    throw new PlatformMongoUnavailableError();
  }
}
