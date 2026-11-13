import { Injectable } from '@nestjs/common';
import type { Document, Filter, UpdateFilter } from 'mongodb';
import { z } from 'zod';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import { parseMongoDocument } from './mongo-tenant-authorization.context';

const json: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(json),
    z.record(z.string(), json),
  ]),
);
const operationSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    resourceType: z.literal('encounter'),
    resourceId: z.string().uuid(),
    operationType: z.string().min(1).max(64),
    actorUserId: z.string().uuid().nullable(),
    historyEventId: z.string().uuid(),
    auditEventType: z.string().min(1).max(64),
    auditMetadata: json,
    auditDeliveryStatus: z.enum([
      'PENDING',
      'DELIVERED',
      'FAILED',
      'RECONCILED',
      'REVIEW_REQUIRED',
    ]),
    attemptCount: z.number().int().nonnegative(),
    lastAttemptAt: z.date().nullable(),
    lastFailureClassification: z.string().max(64).nullable(),
    reconciliationOutcome: z.string().max(64).nullable(),
    mutationState: z.enum(['PREPARED', 'CONFIRMED', 'NOT_APPLIED', 'AMBIGUOUS']),
    expectedVersion: z.number().int().nonnegative().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type MongoEncounterOperation = z.infer<typeof operationSchema>;
type Stored = MongoEncounterOperation & { _id: string };
type Where = {
  [K in keyof MongoEncounterOperation]?:
    | MongoEncounterOperation[K]
    | { in?: MongoEncounterOperation[K][]; lt?: MongoEncounterOperation[K] };
} & { OR?: Where[] };
type Changes = Omit<Partial<MongoEncounterOperation>, 'attemptCount'> & {
  attemptCount?: number | { increment: number };
};
type Create = Pick<
  MongoEncounterOperation,
  | 'id'
  | 'tenantId'
  | 'resourceType'
  | 'resourceId'
  | 'operationType'
  | 'actorUserId'
  | 'historyEventId'
  | 'auditEventType'
  | 'auditMetadata'
> &
  Partial<MongoEncounterOperation>;

/** Durable, atomic operation ledger; no clinical mutation runs inside its writes. */
@Injectable()
export class MongoEncounterOperationStore {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  readonly encounterOperation = {
    findUnique: async (input: { where: { id: string } }): Promise<MongoEncounterOperation | null> =>
      this.run(async () => {
        const row = await (
          await this.manager.getDatabase()
        )
          .collection<Stored>('encounter_operations')
          .findOne({ _id: input.where.id });
        return row ? this.record(row) : null;
      }),
    findMany: async (input: {
      where: Where;
      orderBy: { createdAt: 'asc' | 'desc' };
      take: number;
    }): Promise<MongoEncounterOperation[]> =>
      this.run(async () => {
        const rows = await (
          await this.manager.getDatabase()
        )
          .collection<Stored>('encounter_operations')
          .find(this.filter(input.where))
          .sort({ createdAt: input.orderBy.createdAt === 'asc' ? 1 : -1, _id: 1 })
          .limit(input.take)
          .toArray();
        return rows.map((row) => this.record(row));
      }),
    create: async (input: { data: Create }): Promise<MongoEncounterOperation> =>
      this.run(async () => {
        const now = new Date();
        const row = parseMongoDocument(operationSchema, {
          auditDeliveryStatus: 'PENDING',
          attemptCount: 0,
          lastAttemptAt: null,
          lastFailureClassification: null,
          reconciliationOutcome: null,
          mutationState: 'CONFIRMED',
          expectedVersion: null,
          createdAt: now,
          updatedAt: now,
          ...input.data,
        });
        await (
          await this.manager.getDatabase()
        )
          .collection<Stored>('encounter_operations')
          .insertOne({ _id: row.id, ...row });
        return row;
      }),
    updateMany: async (input: { where: Where; data: Changes }): Promise<{ count: number }> =>
      this.run(async () => {
        const { attemptCount, ...fields } = input.data;
        const set = parseMongoDocument(operationSchema.partial(), {
          ...fields,
          ...(typeof attemptCount === 'number' ? { attemptCount } : {}),
          updatedAt: new Date(),
        });
        const update: UpdateFilter<Stored> = { $set: set };
        if (typeof attemptCount === 'object') {
          if (!Number.isInteger(attemptCount.increment) || attemptCount.increment <= 0)
            throw new PlatformDocumentValidationError();
          update.$inc = { attemptCount: attemptCount.increment };
        }
        const result = await (
          await this.manager.getDatabase()
        )
          .collection<Stored>('encounter_operations')
          .updateMany(this.filter(input.where), update);
        return { count: result.matchedCount };
      }),
  };

  async isReady(): Promise<boolean> {
    return this.manager.configured && this.manager.checkReadiness();
  }

  private record(raw: Stored): MongoEncounterOperation {
    const { _id, ...row } = raw;
    if (_id !== row.id) throw new PlatformDocumentValidationError();
    return parseMongoDocument(operationSchema, row);
  }

  private filter(input: Where): Filter<Stored> {
    const filter: Document = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === 'OR') {
        filter.$or = (value as Where[]).map((row) => this.filter(row));
        continue;
      }
      if (!(key in operationSchema.shape)) throw new PlatformDocumentValidationError();
      const field = key === 'id' ? '_id' : key;
      if (
        value &&
        typeof value === 'object' &&
        !(value instanceof Date) &&
        ('in' in value || 'lt' in value)
      ) {
        filter[field] = {
          ...('in' in value ? { $in: value.in } : {}),
          ...('lt' in value ? { $lt: value.lt } : {}),
        };
      } else filter[field] = value;
    }
    return filter;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PlatformDocumentValidationError) throw error;
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)
        throw new PlatformDocumentConflictError();
      throw new PlatformMongoUnavailableError();
    }
  }
}
