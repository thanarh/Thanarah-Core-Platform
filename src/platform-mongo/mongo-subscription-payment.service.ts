import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { Binary } from 'mongodb';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import type { ReceiptUpload } from '../common/receipt-upload';
import type {
  SubscriptionPaymentSettingsView,
  SubscriptionTransferView,
  TenantSubscriptionTransferView,
  SubscriptionPaymentService,
} from '../subscriptions/subscription-payment.service';
import {
  subscriptionTransferListSchema,
  subscriptionTransferIdSchema,
  subscriptionTransferAmountSchema,
  updateSubscriptionPaymentSettingsSchema,
  reviewSubscriptionTransferSchema,
} from '../subscriptions/subscription-payment.dto';
import type {
  UpdateSubscriptionPaymentSettingsInput,
  SubscriptionTransferListInput,
  ReviewSubscriptionTransferInput,
} from '../subscriptions/subscription-payment.dto';
import {
  SubscriptionPaymentInputError,
  SubscriptionPaymentSettingsConflictError,
  SubscriptionPaymentStorageUnavailableError,
  SubscriptionTransferConflictError,
  SubscriptionTransferNotFoundError,
  SubscriptionTransferPaymentUnavailableError,
} from '../subscriptions/subscription-payment.errors';
import { SubscriptionNotFoundError } from '../subscriptions/subscription.errors';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import { PlatformDocumentConflictError } from './platform-mongo.errors';
import {
  MongoTenantAuthorizationContext as Context,
  parseMongoDocument,
} from './mongo-tenant-authorization.context';
import { mongoBusinessTransaction } from './mongo-business-transaction';
import { subscriptionSchema, platformPlanSchema } from './platform-mongo.models';
import type { SubscriptionDocument, PlatformPlanDocument } from './platform-mongo.models';

const historyEvent = z
  .object({
    action: z.enum(['UPDATED', 'SUBMITTED', 'APPROVED', 'REJECTED']),
    actorUserId: z.string().uuid(),
    at: z.string().datetime(),
    reason: z.string().max(500).nullable().optional(),
  })
  .strict();
const settingsSchema = z
  .object({
    _id: z.literal('default'),
    enabled: z.boolean(),
    bankName: z.string().max(100).nullable(),
    accountHolder: z.string().max(191).nullable(),
    iban: z.string().max(64).nullable(),
    currencyCode: z.string().length(3).nullable(),
    version: z.number().int().positive(),
    updatedAt: z.date(),
    updatedBy: z.string().uuid(),
    history: z.array(historyEvent),
    referenceVersion: z.number().int().nonnegative().optional(),
  })
  .strict();
const transferSchema = z
  .object({
    _id: z.string().uuid(),
    tenantId: z.string().uuid(),
    subscriptionId: z.string().uuid(),
    status: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED']),
    amountMinor: z
      .string()
      .regex(/^[1-9]\d{0,17}$/u)
      .nullable(),
    currencyCode: z.string().length(3).nullable(),
    receiptFileName: z.string().min(1).max(120),
    receiptMimeType: z.string().min(1).max(50),
    receiptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    receiptBytes: z.custom<Binary>((value) => value instanceof Binary),
    submittedBy: z.string().uuid(),
    submittedAt: z.date(),
    reviewedBy: z.string().uuid().nullable(),
    reviewedAt: z.date().nullable(),
    reviewReason: z.string().max(500).nullable(),
    version: z.number().int().positive(),
    history: z.array(historyEvent),
    idempotencyKeyHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
  })
  .strict();
type Settings = z.infer<typeof settingsSchema>;
type Transfer = z.infer<typeof transferSchema>;
type ReceiptRecord = Awaited<ReturnType<SubscriptionPaymentService['getTransferReceipt']>>;

@Injectable()
export class MongoSubscriptionPaymentService implements Pick<
  SubscriptionPaymentService,
  keyof SubscriptionPaymentService
> {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  getSettings(): Promise<SubscriptionPaymentSettingsView> {
    return this.run(async (tx) => this.settingsView(await this.settings(tx)));
  }

  updateSettings(
    input: UpdateSubscriptionPaymentSettingsInput,
    actor: AuthenticatedPlatformUser,
  ): Promise<SubscriptionPaymentSettingsView> {
    const parsed = updateSubscriptionPaymentSettingsSchema.safeParse(input);
    if (!parsed.success || !actor?.userId) throw new SubscriptionPaymentInputError();
    return this.run(
      async (tx) => {
        const current = await this.settings(tx);
        if ((current?.version ?? 0) !== parsed.data.expectedVersion)
          throw new SubscriptionPaymentSettingsConflictError();
        const now = new Date();
        const { expectedVersion, ...data } = parsed.data;
        const updated = parseMongoDocument(settingsSchema, {
          _id: 'default',
          ...data,
          version: expectedVersion + 1,
          updatedAt: now,
          updatedBy: actor.userId,
          history: [
            ...(current?.history ?? []),
            { action: 'UPDATED', actorUserId: actor.userId, at: now.toISOString() },
          ],
          ...(current?.referenceVersion !== undefined
            ? { referenceVersion: current.referenceVersion }
            : {}),
        });
        const collection = tx.db.collection<Settings>('subscription_payment_settings');
        if (current) {
          const result = await collection.replaceOne(
            { _id: 'default', version: expectedVersion },
            updated,
            { session: tx.session },
          );
          if (result.matchedCount !== 1) throw new SubscriptionPaymentSettingsConflictError();
        } else {
          try {
            await collection.insertOne(updated, { session: tx.session });
          } catch (error) {
            this.writeError(error);
          }
        }
        return this.settingsView(updated);
      },
      () => new SubscriptionPaymentSettingsConflictError(),
    );
  }

  listTransfers(
    input: SubscriptionTransferListInput,
  ): Promise<{ items: SubscriptionTransferView[]; total: number; limit: number; offset: number }> {
    const parsed = subscriptionTransferListSchema.safeParse(input);
    if (!parsed.success) throw new SubscriptionPaymentInputError();
    const { limit, offset, ...filter } = parsed.data;
    return this.run(async (tx) => {
      const collection = tx.db.collection<Transfer>('subscription_transfers');
      const rows = await collection
        .find(filter, { session: tx.session })
        .sort({ submittedAt: -1, _id: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
      const total = await collection.countDocuments(filter, { session: tx.session });
      return { items: rows.map((row) => this.present(row)), total, limit, offset };
    });
  }

  async getTenantPortal(
    tenantId: string,
  ): ReturnType<SubscriptionPaymentService['getTenantPortal']> {
    const subscription = await this.run(async (tx) => {
      const raw = await tx.db
        .collection<SubscriptionDocument>('subscriptions')
        .findOne(
          { tenantId },
          { session: tx.session, sort: { startsAt: -1, createdAt: -1, _id: -1 } },
        );
      if (!raw) return null;
      const row = parseMongoDocument(subscriptionSchema, raw);
      const rawPlan = await tx.db
        .collection<PlatformPlanDocument>('platform_plans')
        .findOne({ _id: row.planId }, { session: tx.session });
      if (!rawPlan) throw new SubscriptionPaymentStorageUnavailableError();
      const plan = parseMongoDocument(platformPlanSchema, rawPlan);
      return {
        id: row._id,
        planName: plan.name,
        planKey: plan.key,
        status: row.status,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        cancelledAt: row.cancelledAt,
      };
    });
    const [settings, transfers] = await Promise.all([
      this.getSettings(),
      this.listTransfers({ tenantId, limit: 50, offset: 0 }),
    ]);
    return {
      subscription,
      bankTransfer: {
        enabled: settings.enabled,
        bankName: settings.bankName,
        accountHolder: settings.accountHolder,
        iban: settings.iban,
        currencyCode: settings.currencyCode,
      },
      transfers: transfers.items.map((row) => this.tenantView(row)),
    };
  }

  async submitTenantTransfer(
    tenantId: string,
    receipt: ReceiptUpload,
    actor: AuthenticatedPlatformUser,
    idempotencyKey?: string,
  ): Promise<TenantSubscriptionTransferView> {
    const now = new Date();
    const subscription = await this.run((tx) =>
      tx.db.collection<SubscriptionDocument>('subscriptions').findOne(
        {
          tenantId,
          status: 'ACTIVE',
          startsAt: { $lte: now },
          $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
        },
        { session: tx.session, sort: { startsAt: -1, _id: -1 } },
      ),
    );
    if (!subscription) throw new SubscriptionTransferPaymentUnavailableError();
    return this.tenantView(
      await this.submitTransfer(subscription._id, receipt, {}, actor, idempotencyKey, tenantId),
    );
  }

  submitTransfer(
    subscriptionId: string,
    receipt: ReceiptUpload,
    fields: Record<string, string>,
    actor: AuthenticatedPlatformUser,
    idempotencyKey?: string,
    expectedTenantId?: string,
  ): Promise<SubscriptionTransferView> {
    if (
      !subscriptionTransferIdSchema.safeParse(subscriptionId).success ||
      !actor?.userId ||
      (idempotencyKey && !/^[\x21-\x7e]{1,128}$/u.test(idempotencyKey))
    )
      throw new SubscriptionPaymentInputError();
    const parsed = subscriptionTransferAmountSchema.safeParse({
      ...(fields.amountMinor ? { amountMinor: fields.amountMinor } : {}),
      ...(fields.currencyCode ? { currencyCode: fields.currencyCode } : {}),
    });
    if (!parsed.success) throw new SubscriptionPaymentInputError();
    const keyHash = idempotencyKey
      ? createHash('sha256').update(`${actor.userId}:${idempotencyKey}`).digest('hex')
      : null;
    return this.run(
      async (tx) => {
        const settings = await this.settings(tx);
        if (
          !settings?.enabled ||
          !settings.bankName ||
          !settings.accountHolder ||
          !settings.iban ||
          !settings.currencyCode ||
          (parsed.data.currencyCode && parsed.data.currencyCode !== settings.currencyCode)
        )
          throw new SubscriptionTransferPaymentUnavailableError();
        // Conflict with independent settings edits and subscription status changes.
        await tx.touch('subscription_payment_settings', 'default', { version: settings.version });
        const now = new Date();
        const filter = {
          ...(expectedTenantId
            ? {
                tenantId: expectedTenantId,
                status: 'ACTIVE',
                startsAt: { $lte: now },
                $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
              }
            : {}),
        };
        if (!(await tx.touch('subscriptions', subscriptionId, filter)))
          throw new SubscriptionNotFoundError();
        const subscription = await tx.db
          .collection<SubscriptionDocument>('subscriptions')
          .findOne({ _id: subscriptionId }, { session: tx.session });
        if (!subscription) throw new SubscriptionNotFoundError();
        const collection = tx.db.collection<Transfer>('subscription_transfers');
        if (keyHash) {
          const raw = await collection.findOne(
            { tenantId: subscription.tenantId, idempotencyKeyHash: keyHash },
            { session: tx.session },
          );
          if (raw) {
            const row = parseMongoDocument(transferSchema, raw);
            if (
              row.subscriptionId !== subscriptionId ||
              row.receiptSha256 !== receipt.sha256 ||
              (row.amountMinor ?? undefined) !== parsed.data.amountMinor ||
              row.currencyCode !== (parsed.data.currencyCode ?? null)
            )
              throw new SubscriptionTransferConflictError();
            return this.present(row);
          }
        }
        if (
          await collection.findOne(
            {
              tenantId: subscription.tenantId,
              subscriptionId,
              status: { $in: ['PENDING_REVIEW', 'APPROVED'] },
            },
            { session: tx.session },
          )
        )
          throw new SubscriptionTransferConflictError();
        const row = parseMongoDocument(transferSchema, {
          _id: randomUUID(),
          tenantId: subscription.tenantId,
          subscriptionId,
          status: 'PENDING_REVIEW',
          amountMinor: parsed.data.amountMinor ?? null,
          currencyCode: parsed.data.currencyCode ?? null,
          receiptFileName: receipt.fileName,
          receiptMimeType: receipt.mimeType,
          receiptSha256: receipt.sha256,
          receiptBytes: new Binary(Buffer.from(receipt.bytes)),
          submittedBy: actor.userId,
          submittedAt: now,
          reviewedBy: null,
          reviewedAt: null,
          reviewReason: null,
          version: 1,
          idempotencyKeyHash: keyHash,
          history: [
            { action: 'SUBMITTED', actorUserId: actor.userId, at: now.toISOString(), reason: null },
          ],
        });
        try {
          await collection.insertOne(row, { session: tx.session });
        } catch (error) {
          this.writeError(error);
        }
        return this.present(row);
      },
      () => new SubscriptionTransferConflictError(),
    );
  }

  reviewTransfer(
    transferId: string,
    input: ReviewSubscriptionTransferInput,
    status: 'APPROVED' | 'REJECTED',
    actor: AuthenticatedPlatformUser,
  ): Promise<SubscriptionTransferView> {
    const parsed = reviewSubscriptionTransferSchema.safeParse(input);
    if (
      !subscriptionTransferIdSchema.safeParse(transferId).success ||
      !parsed.success ||
      !actor?.userId
    )
      throw new SubscriptionPaymentInputError();
    return this.run(async (tx) => {
      const collection = tx.db.collection<Transfer>('subscription_transfers');
      const raw = await collection.findOne({ _id: transferId }, { session: tx.session });
      if (!raw) throw new SubscriptionTransferNotFoundError();
      const current = parseMongoDocument(transferSchema, raw);
      if (
        !(await tx.touch('subscriptions', current.subscriptionId, { tenantId: current.tenantId }))
      )
        throw new SubscriptionTransferNotFoundError();
      if (current.status !== 'PENDING_REVIEW' || current.version !== parsed.data.expectedVersion)
        throw new SubscriptionTransferConflictError();
      const now = new Date();
      const updated = parseMongoDocument(transferSchema, {
        ...current,
        status,
        reviewedBy: actor.userId,
        reviewedAt: now,
        reviewReason: parsed.data.reason,
        version: parsed.data.expectedVersion + 1,
        history: [
          ...current.history,
          {
            action: status,
            actorUserId: actor.userId,
            at: now.toISOString(),
            reason: parsed.data.reason,
          },
        ],
      });
      const result = await collection.replaceOne(
        {
          _id: transferId,
          tenantId: current.tenantId,
          version: parsed.data.expectedVersion,
          status: 'PENDING_REVIEW',
        },
        updated,
        { session: tx.session },
      );
      if (result.matchedCount !== 1) throw new SubscriptionTransferConflictError();
      return this.present(updated);
    });
  }

  getTransferReceipt(transferId: string): Promise<ReceiptRecord> {
    if (!subscriptionTransferIdSchema.safeParse(transferId).success)
      throw new SubscriptionPaymentInputError();
    return this.run(async (tx) => {
      const raw = await tx.db
        .collection<Transfer>('subscription_transfers')
        .findOne({ _id: transferId }, { session: tx.session });
      if (!raw) throw new SubscriptionTransferNotFoundError();
      const row = parseMongoDocument(transferSchema, raw);
      return {
        ...this.present(row),
        amountMinor: row.amountMinor ? BigInt(row.amountMinor) : null,
        receiptBytes: Uint8Array.from(row.receiptBytes.value()),
        idempotencyKeyHash: row.idempotencyKeyHash,
      };
    });
  }

  private async settings(tx: Context): Promise<Settings | null> {
    const raw = await tx.db
      .collection<Settings>('subscription_payment_settings')
      .findOne({ _id: 'default' }, { session: tx.session });
    return raw ? parseMongoDocument(settingsSchema, raw) : null;
  }

  private settingsView(row: Settings | null): SubscriptionPaymentSettingsView {
    return row
      ? {
          enabled: row.enabled,
          bankName: row.bankName,
          accountHolder: row.accountHolder,
          iban: row.iban,
          currencyCode: row.currencyCode,
          version: row.version,
          updatedAt: row.updatedAt,
          updatedBy: row.updatedBy,
          history: row.history,
        }
      : {
          enabled: false,
          bankName: null,
          accountHolder: null,
          iban: null,
          currencyCode: null,
          version: 0,
          updatedAt: null,
          updatedBy: null,
          history: [],
        };
  }

  private present(raw: Transfer): SubscriptionTransferView {
    const row = parseMongoDocument(transferSchema, raw);
    return {
      id: row._id,
      tenantId: row.tenantId,
      subscriptionId: row.subscriptionId,
      status: row.status,
      amountMinor: row.amountMinor,
      currencyCode: row.currencyCode,
      receiptFileName: row.receiptFileName,
      receiptMimeType: row.receiptMimeType,
      receiptSha256: row.receiptSha256,
      submittedBy: row.submittedBy,
      submittedAt: row.submittedAt,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      reviewReason: row.reviewReason,
      version: row.version,
      history: row.history,
    };
  }

  private tenantView(row: SubscriptionTransferView): TenantSubscriptionTransferView {
    return {
      id: row.id,
      subscriptionId: row.subscriptionId,
      status: row.status,
      submittedAt: row.submittedAt,
      reviewedAt: row.reviewedAt,
      reviewReason: row.reviewReason,
      receiptFileName: row.receiptFileName,
    };
  }

  private writeError(error: unknown): never {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)
      throw new PlatformDocumentConflictError();
    throw error;
  }

  private async run<T>(
    operation: (tx: Context) => Promise<T>,
    conflict?: () => HttpException,
  ): Promise<T> {
    try {
      return await mongoBusinessTransaction(this.manager, operation);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof PlatformDocumentConflictError && conflict) throw conflict();
      throw new SubscriptionPaymentStorageUnavailableError();
    }
  }
}
