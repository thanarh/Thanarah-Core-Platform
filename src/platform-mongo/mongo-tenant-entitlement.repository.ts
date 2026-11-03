import { Injectable } from '@nestjs/common';
import type { ClientSession, Db } from 'mongodb';
import type { ZodType } from 'zod';
import type {
  PlanFeatureEntitlementLookup,
  TenantEntitlementPersistencePort,
  TenantQuotaPersistencePort,
  TenantQuotaPlanFeatureLookup,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
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

const SNAPSHOT_OPTIONS = { readConcern: { level: 'snapshot' as const } };
const KEY_COLLATION = { locale: 'en', strength: 1 } as const;

@Injectable()
export class MongoTenantEntitlementRepository
  implements TenantEntitlementPersistencePort, TenantQuotaPersistencePort
{
  constructor(private readonly manager: PlatformMongoClientManager) {}

  resolveFeatureOnPlan(planId: string, featureKey: string): Promise<PlanFeatureEntitlementLookup> {
    return this.read(async (db, session) => {
      const planDocument = await db
        .collection<PlatformPlanDocument>('platform_plans')
        .findOne({ _id: planId }, { session });
      if (!planDocument) return { kind: 'plan-not-found' };
      const plan = this.parse(platformPlanSchema, planDocument);
      if (plan.status !== 'ACTIVE') return { kind: 'plan-unavailable' };

      const featureDocuments = await db
        .collection<PlatformFeatureDocument>('platform_features')
        .find({ key: featureKey }, { collation: KEY_COLLATION, session })
        .limit(2)
        .toArray();
      if (featureDocuments.length > 1) return { kind: 'plan-feature-ambiguous' };
      const featureDocument = featureDocuments[0];
      if (!featureDocument) return { kind: 'feature-not-found' };
      const feature = this.parse(platformFeatureSchema, featureDocument);

      const associations = await db
        .collection<PlatformPlanFeatureDocument>('platform_plan_features')
        .find({ planId, featureId: feature._id }, { session })
        .limit(2)
        .toArray();
      if (associations.length > 1) return { kind: 'plan-feature-ambiguous' };
      const associationDocument = associations[0];
      if (!associationDocument) {
        if (feature.status !== 'ACTIVE') return { kind: 'feature-unavailable' };
        return { kind: 'plan-feature-missing' };
      }
      const association = this.parse(platformPlanFeatureSchema, associationDocument);
      if (feature.status !== 'ACTIVE') return { kind: 'feature-unavailable' };
      if (!association.enabled) return { kind: 'plan-feature-disabled' };
      return { kind: 'entitled', featureId: feature._id };
    });
  }

  findActivePlanFeatureQuotaLimits(
    planId: string,
    featureId: string,
  ): Promise<TenantQuotaPlanFeatureLookup> {
    return this.read(async (db, session) => {
      const associationDocument = await db
        .collection<PlatformPlanFeatureDocument>('platform_plan_features')
        .findOne({ planId, featureId }, { session });
      if (!associationDocument) return { kind: 'unavailable' };
      const association = this.parse(platformPlanFeatureSchema, associationDocument);
      if (!association.enabled) return { kind: 'unavailable' };

      const [planDocument, featureDocument] = await Promise.all([
        db.collection<PlatformPlanDocument>('platform_plans').findOne({ _id: planId }, { session }),
        db
          .collection<PlatformFeatureDocument>('platform_features')
          .findOne({ _id: featureId }, { session }),
      ]);
      if (!planDocument || !featureDocument) throw new PlatformDocumentValidationError();
      const plan = this.parse(platformPlanSchema, planDocument);
      const feature = this.parse(platformFeatureSchema, featureDocument);
      if (plan.status !== 'ACTIVE' || feature.status !== 'ACTIVE') {
        return { kind: 'unavailable' };
      }
      return { kind: 'ready', quotaLimits: association.quotaLimits };
    });
  }

  private async read<T>(operation: (db: Db, session: ClientSession) => Promise<T>): Promise<T> {
    try {
      return await this.manager.withTransaction(
        async (session) => operation(await this.manager.getDatabase(), session),
        SNAPSHOT_OPTIONS,
      );
    } catch (error) {
      if (error instanceof PlatformDocumentValidationError) throw error;
      throw new PlatformMongoUnavailableError();
    }
  }

  private parse<T>(schema: ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }
}
