import { Injectable } from '@nestjs/common';
import type { ClientSession, Db } from 'mongodb';
import type {
  PlanCreateInput,
  PlanFeatureConfigurationInput,
  PlanFeatureRecord,
  PlanListFilter,
  PlanPersistencePort,
  PlanRecord,
  PlanStatusValue,
  PlanUpdateInput,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import {
  platformFeatureSchema,
  platformPlanFeatureSchema,
  platformPlanSchema,
} from './platform-mongo.models';
import type {
  PlatformFeatureDocument,
  PlatformPlanDocument,
  PlatformPlanFeatureDocument,
} from './platform-mongo.models';
import { newStableId, stableAssignmentId } from './platform-mongo.models';

const KEY_COLLATION = { locale: 'en', strength: 1 } as const;
const SNAPSHOT_OPTIONS = { readConcern: { level: 'snapshot' as const } };

@Injectable()
export class MongoPlatformPlanRepository implements PlanPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async create(input: PlanCreateInput): Promise<PlanRecord> {
    const now = new Date();
    const document = this.parsePlan({
      _id: newStableId(),
      ...input,
      description: input.description ?? null,
      status: 'ACTIVE',
      statusChangedAt: now,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    });
    try {
      const db = await this.manager.getDatabase();
      await db.collection<PlatformPlanDocument>('platform_plans').insertOne(document);
      return this.toPlanRecord(document);
    } catch (error) {
      if (isDuplicateKey(error)) throw new PlatformDocumentConflictError();
      throw new PlatformMongoUnavailableError();
    }
  }

  findById(id: string): Promise<PlanRecord | null> {
    return this.transaction(async (db, session) => {
      const document = await db
        .collection<PlatformPlanDocument>('platform_plans')
        .findOne({ _id: id }, { session });
      return document ? this.toPlanRecord(this.parsePlan(document)) : null;
    });
  }

  findByKey(key: string): Promise<PlanRecord | null> {
    return this.transaction(async (db, session) => {
      const document = await db
        .collection<PlatformPlanDocument>('platform_plans')
        .findOne({ key }, { collation: KEY_COLLATION, session });
      return document ? this.toPlanRecord(this.parsePlan(document)) : null;
    });
  }

  list(filter: PlanListFilter): Promise<PlanRecord[]> {
    return this.transaction(async (db, session) => {
      const documents = await db
        .collection<PlatformPlanDocument>('platform_plans')
        .find(filter.status ? { status: filter.status } : {}, { session })
        .sort({ createdAt: -1, _id: -1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .toArray();
      return documents.map((document) => this.toPlanRecord(this.parsePlan(document)));
    });
  }

  updateIfCurrentStatus(
    id: string,
    expectedStatus: PlanStatusValue,
    input: PlanUpdateInput,
  ): Promise<PlanRecord | null> {
    return this.transaction(async (db, session) => {
      const document = await db
        .collection<PlatformPlanDocument>('platform_plans')
        .findOneAndUpdate(
          { _id: id, status: expectedStatus },
          { $set: { ...input, updatedAt: new Date() } },
          { returnDocument: 'after', session },
        );
      return document ? this.toPlanRecord(this.parsePlan(document)) : null;
    });
  }

  changeStatusIfCurrent(
    id: string,
    expectedStatus: PlanStatusValue,
    nextStatus: PlanStatusValue,
    changedAt: Date,
  ): Promise<PlanRecord | null> {
    return this.transaction(async (db, session) => {
      const document = await db.collection<PlatformPlanDocument>('platform_plans').findOneAndUpdate(
        { _id: id, status: expectedStatus },
        {
          $set: { status: nextStatus, statusChangedAt: changedAt, updatedAt: new Date() },
        },
        { returnDocument: 'after', session },
      );
      return document ? this.toPlanRecord(this.parsePlan(document)) : null;
    });
  }

  findPlanFeature(planId: string, featureId: string): Promise<PlanFeatureRecord | null> {
    return this.transaction(async (db, session) => {
      const association = await db
        .collection<PlatformPlanFeatureDocument>('platform_plan_features')
        .findOne({ planId, featureId }, { session });
      if (!association) return null;
      const plan = await db
        .collection<PlatformPlanDocument>('platform_plans')
        .findOne({ _id: planId }, { session });
      if (!plan) throw new PlatformDocumentValidationError();
      this.parsePlan(plan);
      return this.loadPlanFeatureRecord(db, session, this.parsePlanFeature(association));
    });
  }

  listFeatures(planId: string): Promise<PlanFeatureRecord[]> {
    return this.transaction(async (db, session) => {
      const associations = (
        await db
          .collection<PlatformPlanFeatureDocument>('platform_plan_features')
          .find({ planId }, { session })
          .sort({ createdAt: 1, featureId: 1 })
          .toArray()
      ).map((document) => this.parsePlanFeature(document));
      if (associations.length === 0) return [];
      const plan = await db
        .collection<PlatformPlanDocument>('platform_plans')
        .findOne({ _id: planId }, { session });
      if (!plan) throw new PlatformDocumentValidationError();
      this.parsePlan(plan);

      const featureIds = [...new Set(associations.map(({ featureId }) => featureId))];
      const features = (
        await db
          .collection<PlatformFeatureDocument>('platform_features')
          .find({ _id: { $in: featureIds } }, { session })
          .toArray()
      ).map((document) => this.parseFeature(document));
      this.assertReferencesResolved(
        featureIds,
        features.map(({ _id }) => _id),
      );
      const byId = new Map(features.map((feature) => [feature._id, feature]));
      return associations.map((association) =>
        this.mapPlanFeatureRecord(association, byId.get(association.featureId)!),
      );
    });
  }

  attachFeature(planId: string, featureId: string): Promise<PlanFeatureRecord> {
    return this.transaction(async (db, session) => {
      const plan = await db
        .collection<PlatformPlanDocument>('platform_plans')
        .findOne({ _id: planId }, { session });
      const feature = await db
        .collection<PlatformFeatureDocument>('platform_features')
        .findOne({ _id: featureId }, { session });
      if (!plan || !feature) throw new PlatformDocumentValidationError();
      this.parsePlan(plan);
      const parsedFeature = this.parseFeature(feature);

      const now = new Date();
      const association = this.parsePlanFeature({
        _id: stableAssignmentId(planId, featureId),
        planId,
        featureId,
        enabled: true,
        quotaLimits: null,
        createdAt: now,
        updatedAt: now,
      });
      try {
        await db
          .collection<PlatformPlanFeatureDocument>('platform_plan_features')
          .insertOne(association, { session });
      } catch (error) {
        if (isDuplicateKey(error)) throw new PlatformDocumentConflictError();
        throw error;
      }
      return this.mapPlanFeatureRecord(association, parsedFeature);
    });
  }

  updateFeatureConfiguration(
    planId: string,
    featureId: string,
    input: PlanFeatureConfigurationInput,
  ): Promise<PlanFeatureRecord | null> {
    return this.transaction(async (db, session) => {
      const changes: Partial<PlatformPlanFeatureDocument> = { updatedAt: new Date() };
      if (input.enabled !== undefined) changes.enabled = input.enabled;
      if (input.quotaLimits !== undefined) changes.quotaLimits = input.quotaLimits;
      const association = await db
        .collection<PlatformPlanFeatureDocument>('platform_plan_features')
        .findOneAndUpdate(
          { planId, featureId },
          { $set: changes },
          { returnDocument: 'after', session },
        );
      if (!association) return null;
      return this.loadPlanFeatureRecord(db, session, this.parsePlanFeature(association));
    });
  }

  async detachFeature(planId: string, featureId: string): Promise<boolean> {
    return this.transaction(async (db, session) => {
      const result = await db
        .collection<PlatformPlanFeatureDocument>('platform_plan_features')
        .deleteOne({ planId, featureId }, { session });
      return result.deletedCount === 1;
    });
  }

  private async transaction<T>(
    operation: (db: Db, session: ClientSession) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.manager.withTransaction(
        async (session) => operation(await this.manager.getDatabase(), session),
        SNAPSHOT_OPTIONS,
      );
    } catch (error) {
      if (
        error instanceof PlatformDocumentValidationError ||
        error instanceof PlatformDocumentConflictError
      ) {
        throw error;
      }
      if (isDuplicateKey(error)) throw new PlatformDocumentConflictError();
      throw new PlatformMongoUnavailableError();
    }
  }

  private async loadPlanFeatureRecord(
    db: Db,
    session: ClientSession,
    association: PlatformPlanFeatureDocument,
  ): Promise<PlanFeatureRecord> {
    const feature = await db
      .collection<PlatformFeatureDocument>('platform_features')
      .findOne({ _id: association.featureId }, { session });
    if (!feature) throw new PlatformDocumentValidationError();
    return this.mapPlanFeatureRecord(association, this.parseFeature(feature));
  }

  private toPlanRecord(document: PlatformPlanDocument): PlanRecord {
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

  private mapPlanFeatureRecord(
    association: PlatformPlanFeatureDocument,
    feature: PlatformFeatureDocument,
  ): PlanFeatureRecord {
    return {
      planId: association.planId,
      featureId: association.featureId,
      enabled: association.enabled,
      quotaLimits: association.quotaLimits,
      createdAt: association.createdAt,
      updatedAt: association.updatedAt,
      feature: {
        id: feature._id,
        key: feature.key,
        name: feature.name,
        description: feature.description,
        status: feature.status,
        statusChangedAt: feature.statusChangedAt,
        createdAt: feature.createdAt,
        updatedAt: feature.updatedAt,
      },
    };
  }

  private parsePlan(value: unknown): PlatformPlanDocument {
    const parsed = platformPlanSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private parsePlanFeature(value: unknown): PlatformPlanFeatureDocument {
    const parsed = platformPlanFeatureSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private parseFeature(value: unknown): PlatformFeatureDocument {
    const parsed = platformFeatureSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private assertReferencesResolved(references: readonly string[], found: readonly string[]): void {
    const foundIds = new Set(found);
    if (new Set(references).size !== foundIds.size || references.some((id) => !foundIds.has(id))) {
      throw new PlatformDocumentValidationError();
    }
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
