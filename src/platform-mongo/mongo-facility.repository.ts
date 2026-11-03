import { Injectable } from '@nestjs/common';
import type { Collection } from 'mongodb';
import type {
  FacilityListFilter,
  FacilityPersistencePort,
  FacilityRecord,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import { documentTimestamps, facilitySchema, newStableId } from './platform-mongo.models';
import type { FacilityDocument, TenantDocument } from './platform-mongo.models';

@Injectable()
export class MongoFacilityRepository implements FacilityPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async create(tenantId: string, input: { name: string }): Promise<FacilityRecord> {
    const now = new Date();
    const document: FacilityDocument = {
      _id: newStableId(),
      ...documentTimestamps(now),
      schemaVersion: 1,
      tenantId,
      ...input,
      status: 'ACTIVE',
      statusChangedAt: now,
      suspendedAt: null,
      deactivatedAt: null,
    };
    return this.write(async (collection) => {
      const db = await this.manager.getDatabase();
      if (
        !(await db
          .collection<TenantDocument>('tenants')
          .findOne({ _id: tenantId }, { projection: { _id: 1 } }))
      ) {
        throw new PlatformDocumentConflictError();
      }
      const parsed = this.parse(document);
      await collection.insertOne(parsed);
      return this.toRecord(parsed);
    });
  }

  findById(tenantId: string, id: string): Promise<FacilityRecord | null> {
    return this.read(async (collection) => {
      const document = await collection.findOne({ _id: id, tenantId });
      return document ? this.toRecord(document) : null;
    });
  }

  listForTenant(tenantId: string, filter: FacilityListFilter): Promise<FacilityRecord[]> {
    return this.read(async (collection) => {
      const documents = await collection
        .find({ tenantId, ...(filter.status ? { status: filter.status } : {}) })
        .sort({ createdAt: -1, _id: -1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .toArray();
      return documents.map((document) => this.toRecord(document));
    });
  }

  updateName(tenantId: string, id: string, name: string): Promise<FacilityRecord | null> {
    return this.write(async (collection) => {
      const updated = await collection.findOneAndUpdate(
        { _id: id, tenantId },
        { $set: { name, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return updated ? this.toRecord(updated) : null;
    });
  }

  changeStatusIfCurrent(
    tenantId: string,
    id: string,
    expectedStatus: FacilityRecord['status'],
    nextStatus: FacilityRecord['status'],
    changedAt: Date,
  ): Promise<FacilityRecord | null> {
    return this.write(async (collection) => {
      const set: Partial<FacilityDocument> = {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
      };
      if (nextStatus === 'SUSPENDED') set.suspendedAt = changedAt;
      if (nextStatus === 'DEACTIVATED') set.deactivatedAt = changedAt;
      const updated = await collection.findOneAndUpdate(
        { _id: id, tenantId, status: expectedStatus },
        { $set: set },
        { returnDocument: 'after' },
      );
      return updated ? this.toRecord(updated) : null;
    });
  }

  private async read<T>(
    operation: (collection: Collection<FacilityDocument>) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation((await this.manager.getDatabase()).collection('facilities'));
    } catch (error) {
      this.rethrow(error);
    }
  }

  private async write<T>(
    operation: (collection: Collection<FacilityDocument>) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation((await this.manager.getDatabase()).collection('facilities'));
    } catch (error) {
      this.rethrow(error);
    }
  }

  private parse(document: unknown): FacilityDocument {
    const result = facilitySchema.safeParse(document);
    if (!result.success) throw new PlatformDocumentValidationError();
    return result.data;
  }

  private toRecord(document: FacilityDocument): FacilityRecord {
    const parsed = this.parse(document);
    return {
      id: parsed._id,
      tenantId: parsed.tenantId,
      name: parsed.name,
      status: parsed.status,
      statusChangedAt: parsed.statusChangedAt,
      suspendedAt: parsed.suspendedAt,
      deactivatedAt: parsed.deactivatedAt,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    };
  }

  private rethrow(error: unknown): never {
    if (
      error instanceof PlatformDocumentValidationError ||
      error instanceof PlatformDocumentConflictError
    ) {
      throw error;
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      throw new PlatformDocumentConflictError();
    }
    throw new PlatformMongoUnavailableError();
  }
}
