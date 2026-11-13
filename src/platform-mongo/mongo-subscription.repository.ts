import { Injectable } from '@nestjs/common';
import { PlanStatus, SubscriptionStatus, TenantStatus } from '../common/domain-enums';
import type { ClientSession, Collection, Db, TransactionOptions } from 'mongodb';
import type {
  CreateSubscriptionRecordInput,
  CreateSubscriptionResult,
  SubscriptionLifecycleActionValue,
  SubscriptionListFilter,
  SubscriptionPersistencePort,
  SubscriptionRecord,
  SubscriptionStatusValue,
  TransitionSubscriptionResult,
} from '../persistence/platform-persistence.ports';
import { decideSubscriptionTransition } from '../subscriptions/subscription.rules';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import { MongoTenantAuthorizationContext } from './mongo-tenant-authorization.context';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import { documentTimestamps, newStableId, subscriptionSchema } from './platform-mongo.models';
import type {
  PlatformPlanDocument,
  SubscriptionDocument,
  TenantDocument,
} from './platform-mongo.models';

const TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

@Injectable()
export class MongoSubscriptionRepository implements SubscriptionPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  findById(id: string): Promise<SubscriptionRecord | null> {
    return this.read(async (db) => {
      const document = await db
        .collection<SubscriptionDocument>('subscriptions')
        .findOne({ _id: id });
      return document ? this.toRecord(document) : null;
    });
  }

  list(filter: SubscriptionListFilter): Promise<SubscriptionRecord[]> {
    return this.read(async (db) => {
      const documents = await db
        .collection<SubscriptionDocument>('subscriptions')
        .find({
          ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
        })
        .sort({ createdAt: -1, _id: -1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .toArray();
      return documents.map((document) => this.toRecord(document));
    });
  }

  findCurrentForTenant(tenantId: string, asOf: Date): Promise<SubscriptionRecord[]> {
    return this.read(async (db) => {
      const documents = await db
        .collection<SubscriptionDocument>('subscriptions')
        .find({
          tenantId,
          status: SubscriptionStatus.ACTIVE,
          startsAt: { $lte: asOf },
          $or: [{ endsAt: null }, { endsAt: { $gt: asOf } }],
        })
        .sort({ startsAt: -1, _id: -1 })
        .limit(2)
        .toArray();
      return documents.map((document) => this.toRecord(document));
    });
  }

  createForActiveTenantAndPlan(
    input: CreateSubscriptionRecordInput,
  ): Promise<CreateSubscriptionResult> {
    return this.transaction(async (db, session) => {
      await this.lockTenant(db, session, input.tenantId);
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: input.tenantId }, { session, projection: { status: 1 } });
      if (!tenant) return { kind: 'tenant-not-found' };
      if (tenant.status !== TenantStatus.ACTIVE) return { kind: 'tenant-unavailable' };

      await new MongoTenantAuthorizationContext(db, session).touch('platform_plans', input.planId);
      const plan = await db
        .collection<PlatformPlanDocument>('platform_plans')
        .findOne({ _id: input.planId }, { session, projection: { status: 1 } });
      if (!plan) return { kind: 'plan-not-found' };
      if (plan.status !== PlanStatus.ACTIVE) return { kind: 'plan-unavailable' };

      const collection = db.collection<SubscriptionDocument>('subscriptions');
      if (
        input.status === SubscriptionStatus.ACTIVE &&
        (await this.findOverlap(collection, session, input.tenantId, input.startsAt, input.endsAt))
      ) {
        return { kind: 'period-conflict' };
      }
      const now = new Date();
      const document = this.parse({
        _id: newStableId(),
        ...documentTimestamps(now),
        schemaVersion: 1,
        tenantId: input.tenantId,
        planId: input.planId,
        status: input.status,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        cancelledAt: null,
      });
      await collection.insertOne(document, { session });
      return { kind: 'created', subscription: this.toRecord(document) };
    });
  }

  async transition(
    id: string,
    action: SubscriptionLifecycleActionValue,
    now: Date,
  ): Promise<TransitionSubscriptionResult> {
    const discovered = await this.read(async (db) =>
      db
        .collection<SubscriptionDocument>('subscriptions')
        .findOne({ _id: id }, { projection: { tenantId: 1 } }),
    );
    if (!discovered) return { kind: 'not-found' };

    return this.transaction(async (db, session) => {
      await this.lockTenant(db, session, discovered.tenantId);
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: discovered.tenantId }, { session, projection: { status: 1 } });
      if (!tenant) return { kind: 'not-found' };
      const collection = db.collection<SubscriptionDocument>('subscriptions');
      const current = await collection.findOne(
        { _id: id, tenantId: discovered.tenantId },
        { session },
      );
      if (!current) return { kind: 'not-found' };
      const decision = decideSubscriptionTransition(
        this.toRecord(current),
        action,
        tenant.status as TenantStatus,
        now,
      );
      if (decision.kind === 'invalid-transition') return { kind: 'transition-invalid' };
      if (decision.kind === 'tenant-unavailable') return { kind: 'tenant-unavailable' };
      if (
        decision.status === SubscriptionStatus.ACTIVE &&
        (await this.findOverlap(
          collection,
          session,
          current.tenantId,
          current.startsAt,
          current.endsAt,
          current._id,
        ))
      ) {
        return { kind: 'period-conflict' };
      }
      const updated = await collection.findOneAndUpdate(
        { _id: current._id, tenantId: current.tenantId, status: current.status },
        {
          $set: {
            status: decision.status,
            cancelledAt: decision.cancelledAt,
            updatedAt: now,
          },
        },
        { session, returnDocument: 'after' },
      );
      if (!updated) return { kind: 'transition-invalid' };
      return {
        kind: 'updated',
        subscription: this.toRecord(updated),
        previousStatus: current.status,
      };
    });
  }

  private async lockTenant(db: Db, session: ClientSession, tenantId: string): Promise<void> {
    try {
      await new MongoTenantAuthorizationContext(db, session).touch('tenants', tenantId);
    } catch (error) {
      if (this.isDuplicateKey(error)) throw new PlatformDocumentConflictError();
      throw error;
    }
  }

  private async findOverlap(
    collection: Collection<SubscriptionDocument>,
    session: ClientSession,
    tenantId: string,
    startsAt: Date,
    endsAt: Date | null,
    excludingId?: string,
  ): Promise<boolean> {
    return Boolean(
      await collection.findOne(
        {
          tenantId,
          status: SubscriptionStatus.ACTIVE,
          ...(excludingId ? { _id: { $ne: excludingId } } : {}),
          $and: [
            { $or: [{ endsAt: null }, { endsAt: { $gt: startsAt } }] },
            ...(endsAt ? [{ startsAt: { $lt: endsAt } }] : []),
          ],
        },
        { session, projection: { _id: 1 } },
      ),
    );
  }

  private async read<T>(operation: (db: Db) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.manager.getDatabase());
    } catch (error) {
      if (error instanceof PlatformDocumentValidationError) throw error;
      throw new PlatformMongoUnavailableError();
    }
  }

  private async transaction<T>(
    operation: (db: Db, session: ClientSession) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.manager.withTransaction(
          async (session) => operation(await this.manager.getDatabase(), session),
          TRANSACTION_OPTIONS,
        );
      } catch (error) {
        if (error instanceof PlatformDocumentValidationError) throw error;
        if (error instanceof PlatformDocumentConflictError && attempt < 2) continue;
        throw new PlatformMongoUnavailableError();
      }
    }
    throw new PlatformMongoUnavailableError();
  }

  private parse(value: unknown): SubscriptionDocument {
    const result = subscriptionSchema.safeParse(value);
    if (!result.success) throw new PlatformDocumentValidationError();
    return result.data;
  }

  private toRecord(document: SubscriptionDocument): SubscriptionRecord {
    const value = this.parse(document);
    return {
      id: value._id,
      tenantId: value.tenantId,
      planId: value.planId,
      status: value.status as SubscriptionStatusValue,
      startsAt: value.startsAt,
      endsAt: value.endsAt,
      cancelledAt: value.cancelledAt,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }

  private isDuplicateKey(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
  }
}
