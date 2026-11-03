import { Injectable } from '@nestjs/common';
import type { Collection } from 'mongodb';
import type {
  FeatureCreateInput,
  FeatureListFilter,
  FeaturePersistencePort,
  FeatureRecord,
  FeatureStatusValue,
  FeatureUpdateInput,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import { platformFeatureSchema } from './platform-mongo.models';
import type { PlatformFeatureDocument } from './platform-mongo.models';
import { newStableId } from './platform-mongo.models';

const KEY_COLLATION = { locale: 'en', strength: 1 } as const;

@Injectable()
export class MongoPlatformFeatureRepository implements FeaturePersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async create(input: FeatureCreateInput): Promise<FeatureRecord> {
    const now = new Date();
    const document = this.parse({
      _id: newStableId(),
      ...input,
      description: input.description ?? null,
      status: 'ACTIVE',
      statusChangedAt: now,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    });
    return this.write(async (collection) => {
      await collection.insertOne(document);
      return this.toRecord(document);
    });
  }

  findById(id: string): Promise<FeatureRecord | null> {
    return this.read(async (collection) => {
      const document = await collection.findOne({ _id: id });
      return document ? this.toRecord(this.parse(document)) : null;
    });
  }

  findByKey(key: string): Promise<FeatureRecord | null> {
    return this.read(async (collection) => {
      const document = await collection.findOne({ key }, { collation: KEY_COLLATION });
      return document ? this.toRecord(this.parse(document)) : null;
    });
  }

  list(filter: FeatureListFilter): Promise<FeatureRecord[]> {
    return this.read(async (collection) => {
      const documents = await collection
        .find(filter.status ? { status: filter.status } : {})
        .sort({ createdAt: -1, _id: -1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .toArray();
      return documents.map((document) => this.toRecord(this.parse(document)));
    });
  }

  updateIfCurrentStatus(
    id: string,
    expectedStatus: FeatureStatusValue,
    input: FeatureUpdateInput,
  ): Promise<FeatureRecord | null> {
    return this.read(async (collection) => {
      const document = await collection.findOneAndUpdate(
        { _id: id, status: expectedStatus },
        { $set: { ...input, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return document ? this.toRecord(this.parse(document)) : null;
    });
  }

  changeStatusIfCurrent(
    id: string,
    expectedStatus: FeatureStatusValue,
    nextStatus: FeatureStatusValue,
    changedAt: Date,
  ): Promise<FeatureRecord | null> {
    return this.read(async (collection) => {
      const document = await collection.findOneAndUpdate(
        { _id: id, status: expectedStatus },
        { $set: { status: nextStatus, statusChangedAt: changedAt, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return document ? this.toRecord(this.parse(document)) : null;
    });
  }

  private async read<T>(
    operation: (collection: Collection<PlatformFeatureDocument>) => Promise<T>,
  ): Promise<T> {
    try {
      const db = await this.manager.getDatabase();
      return await operation(db.collection<PlatformFeatureDocument>('platform_features'));
    } catch (error) {
      if (error instanceof PlatformDocumentValidationError) throw error;
      throw new PlatformMongoUnavailableError();
    }
  }

  private async write<T>(
    operation: (collection: Collection<PlatformFeatureDocument>) => Promise<T>,
  ): Promise<T> {
    try {
      const db = await this.manager.getDatabase();
      return await operation(db.collection<PlatformFeatureDocument>('platform_features'));
    } catch (error) {
      if (error instanceof PlatformDocumentValidationError) throw error;
      if (isDuplicateKey(error)) throw new PlatformDocumentConflictError();
      throw new PlatformMongoUnavailableError();
    }
  }

  private parse(value: unknown): PlatformFeatureDocument {
    const parsed = platformFeatureSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private toRecord(document: PlatformFeatureDocument): FeatureRecord {
    return {
      id: document._id,
      key: document.key,
      name: document.name,
      description: document.description,
      status: document.status,
      statusChangedAt: document.statusChangedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}
