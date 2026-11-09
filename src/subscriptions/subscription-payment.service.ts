import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { Prisma, SubscriptionTransferStatus } from '@prisma/client';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PrismaService } from '../database/prisma.service';
import type { ReceiptUpload } from '../common/receipt-upload';
import {
  reviewSubscriptionTransferSchema,
  subscriptionTransferAmountSchema,
  subscriptionTransferIdSchema,
  subscriptionTransferListSchema,
  updateSubscriptionPaymentSettingsSchema,
} from './subscription-payment.dto';
import type {
  ReviewSubscriptionTransferInput,
  SubscriptionTransferListInput,
  UpdateSubscriptionPaymentSettingsInput,
} from './subscription-payment.dto';
import {
  SubscriptionPaymentInputError,
  SubscriptionPaymentSettingsConflictError,
  SubscriptionPaymentStorageUnavailableError,
  SubscriptionTransferConflictError,
  SubscriptionTransferNotFoundError,
  SubscriptionTransferPaymentUnavailableError,
} from './subscription-payment.errors';
import { SubscriptionNotFoundError } from './subscription.errors';

const SETTINGS_ID = 'default';

export interface SubscriptionPaymentSettingsView {
  enabled: boolean;
  bankName: string | null;
  accountHolder: string | null;
  iban: string | null;
  currencyCode: string | null;
  version: number;
  updatedAt: Date | null;
  updatedBy: string | null;
  history: unknown[];
}

type StoredTransfer = Prisma.SubscriptionTransferGetPayload<Record<string, never>>;

export type SubscriptionTransferView = Omit<
  StoredTransfer,
  'receiptBytes' | 'idempotencyKeyHash' | 'amountMinor'
> & { amountMinor: string | null };

@Injectable()
export class SubscriptionPaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(): Promise<SubscriptionPaymentSettingsView> {
    try {
      const settings = await this.prisma.subscriptionPaymentSettings.findUnique({
        where: { id: SETTINGS_ID },
      });
      return settings
        ? {
            enabled: settings.enabled,
            bankName: settings.bankName,
            accountHolder: settings.accountHolder,
            iban: settings.iban,
            currencyCode: settings.currencyCode,
            version: settings.version,
            updatedAt: settings.updatedAt,
            updatedBy: settings.updatedBy,
            history: asHistory(settings.history),
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
    } catch {
      throw new SubscriptionPaymentStorageUnavailableError();
    }
  }

  async updateSettings(
    input: UpdateSubscriptionPaymentSettingsInput,
    actor: AuthenticatedPlatformUser,
  ): Promise<SubscriptionPaymentSettingsView> {
    const parsed = updateSubscriptionPaymentSettingsSchema.safeParse(input);
    if (!parsed.success || !actor?.userId) throw new SubscriptionPaymentInputError();
    const data = parsed.data;
    const now = new Date();
    const event = { action: 'UPDATED', actorUserId: actor.userId, at: now.toISOString() };
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const current = await tx.subscriptionPaymentSettings.findUnique({
          where: { id: SETTINGS_ID },
        });
        if (!current) {
          if (data.expectedVersion !== 0) return null;
          return tx.subscriptionPaymentSettings.create({
            data: {
              id: SETTINGS_ID,
              enabled: data.enabled,
              bankName: data.bankName,
              accountHolder: data.accountHolder,
              iban: data.iban,
              currencyCode: data.currencyCode,
              version: 1,
              updatedAt: now,
              updatedBy: actor.userId,
              history: [event],
            },
          });
        }
        if (current.version !== data.expectedVersion) return null;
        const history = [...asHistory(current.history), event];
        const result = await tx.subscriptionPaymentSettings.updateMany({
          where: { id: SETTINGS_ID, version: data.expectedVersion },
          data: {
            enabled: data.enabled,
            bankName: data.bankName,
            accountHolder: data.accountHolder,
            iban: data.iban,
            currencyCode: data.currencyCode,
            version: data.expectedVersion + 1,
            updatedAt: now,
            updatedBy: actor.userId,
            history: history as Prisma.InputJsonValue,
          },
        });
        if (result.count !== 1) return null;
        return tx.subscriptionPaymentSettings.findUnique({ where: { id: SETTINGS_ID } });
      });
      if (!updated) throw new SubscriptionPaymentSettingsConflictError();
      return {
        enabled: updated.enabled,
        bankName: updated.bankName,
        accountHolder: updated.accountHolder,
        iban: updated.iban,
        currencyCode: updated.currencyCode,
        version: updated.version,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
        history: asHistory(updated.history),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isDuplicateKeyError(error)) throw new SubscriptionPaymentSettingsConflictError();
      throw new SubscriptionPaymentStorageUnavailableError();
    }
  }

  async listTransfers(input: SubscriptionTransferListInput): Promise<{
    items: SubscriptionTransferView[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const parsed = subscriptionTransferListSchema.safeParse(input);
    if (!parsed.success) throw new SubscriptionPaymentInputError();
    const { tenantId, subscriptionId, status, limit, offset } = parsed.data;
    const where: Prisma.SubscriptionTransferWhereInput = {
      ...(tenantId ? { tenantId } : {}),
      ...(subscriptionId ? { subscriptionId } : {}),
      ...(status ? { status } : {}),
    };
    try {
      const [records, total] = await this.prisma.$transaction([
        this.prisma.subscriptionTransfer.findMany({
          where,
          orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
          skip: offset,
          take: limit,
        }),
        this.prisma.subscriptionTransfer.count({ where }),
      ]);
      return { items: records.map(presentTransfer), total, limit, offset };
    } catch {
      throw new SubscriptionPaymentStorageUnavailableError();
    }
  }

  async submitTransfer(
    subscriptionId: string,
    receipt: ReceiptUpload,
    fields: Record<string, string>,
    actor: AuthenticatedPlatformUser,
    idempotencyKey?: string,
  ): Promise<SubscriptionTransferView> {
    if (
      !subscriptionTransferIdSchema.safeParse(subscriptionId).success ||
      !actor?.userId ||
      (idempotencyKey && !/^[\x21-\x7e]{1,128}$/u.test(idempotencyKey))
    ) {
      throw new SubscriptionPaymentInputError();
    }
    const parsedAmount = subscriptionTransferAmountSchema.safeParse({
      ...(fields.amountMinor ? { amountMinor: fields.amountMinor } : {}),
      ...(fields.currencyCode ? { currencyCode: fields.currencyCode } : {}),
    });
    if (!parsedAmount.success) throw new SubscriptionPaymentInputError();
    const keyHash = idempotencyKey
      ? createHash('sha256').update(`${actor.userId}:${idempotencyKey}`).digest('hex')
      : null;
    const now = new Date();
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const settings = await tx.subscriptionPaymentSettings.findUnique({
          where: { id: SETTINGS_ID },
        });
        if (
          !settings?.enabled ||
          !settings.bankName ||
          !settings.accountHolder ||
          !settings.iban ||
          !settings.currencyCode ||
          (parsedAmount.data.currencyCode &&
            parsedAmount.data.currencyCode !== settings.currencyCode)
        ) {
          throw new SubscriptionTransferPaymentUnavailableError();
        }
        const subscriptionRows = await tx.$queryRaw<Array<{ id: string; tenantId: string }>>(
          Prisma.sql`
            SELECT \`id\`, \`tenantId\`
            FROM \`Subscription\`
            WHERE \`id\` = ${subscriptionId}
            FOR UPDATE
          `,
        );
        const subscription = subscriptionRows[0];
        if (!subscription) throw new SubscriptionNotFoundError();

        if (keyHash) {
          const retry = await tx.subscriptionTransfer.findFirst({
            where: { tenantId: subscription.tenantId, idempotencyKeyHash: keyHash },
          });
          if (retry) {
            if (
              retry.subscriptionId !== subscriptionId ||
              retry.receiptSha256 !== receipt.sha256 ||
              retry.amountMinor?.toString() !== parsedAmount.data.amountMinor ||
              retry.currencyCode !== (parsedAmount.data.currencyCode ?? null)
            ) {
              throw new SubscriptionTransferConflictError();
            }
            return retry;
          }
        }
        const existing = await tx.subscriptionTransfer.findFirst({
          where: {
            tenantId: subscription.tenantId,
            subscriptionId,
            status: {
              in: [SubscriptionTransferStatus.PENDING_REVIEW, SubscriptionTransferStatus.APPROVED],
            },
          },
        });
        if (existing) throw new SubscriptionTransferConflictError();
        return tx.subscriptionTransfer.create({
          data: {
            id: randomUUID(),
            tenantId: subscription.tenantId,
            subscriptionId,
            status: SubscriptionTransferStatus.PENDING_REVIEW,
            amountMinor: parsedAmount.data.amountMinor
              ? BigInt(parsedAmount.data.amountMinor)
              : null,
            currencyCode: parsedAmount.data.currencyCode ?? null,
            receiptFileName: receipt.fileName,
            receiptMimeType: receipt.mimeType,
            receiptSha256: receipt.sha256,
            receiptBytes: Uint8Array.from(receipt.bytes),
            submittedBy: actor.userId,
            submittedAt: now,
            version: 1,
            history: [
              {
                action: 'SUBMITTED',
                actorUserId: actor.userId,
                at: now.toISOString(),
                reason: null,
              },
            ],
            idempotencyKeyHash: keyHash,
          },
        });
      });
      return presentTransfer(record);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isDuplicateKeyError(error)) throw new SubscriptionTransferConflictError();
      throw new SubscriptionPaymentStorageUnavailableError();
    }
  }

  async reviewTransfer(
    transferId: string,
    input: ReviewSubscriptionTransferInput,
    status: 'APPROVED' | 'REJECTED',
    actor: AuthenticatedPlatformUser,
  ): Promise<SubscriptionTransferView> {
    const id = subscriptionTransferIdSchema.safeParse(transferId);
    const parsed = reviewSubscriptionTransferSchema.safeParse(input);
    if (!id.success || !parsed.success || !actor?.userId) {
      throw new SubscriptionPaymentInputError();
    }
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const current = await tx.subscriptionTransfer.findUnique({ where: { id: id.data } });
        if (!current) throw new SubscriptionTransferNotFoundError();
        await tx.$queryRaw(
          Prisma.sql`
            SELECT \`id\`
            FROM \`Subscription\`
            WHERE \`id\` = ${current.subscriptionId}
              AND \`tenantId\` = ${current.tenantId}
            FOR UPDATE
          `,
        );
        if (
          current.status !== SubscriptionTransferStatus.PENDING_REVIEW ||
          current.version !== parsed.data.expectedVersion
        ) {
          throw new SubscriptionTransferConflictError();
        }
        const nextStatus =
          status === 'APPROVED'
            ? SubscriptionTransferStatus.APPROVED
            : SubscriptionTransferStatus.REJECTED;
        const now = new Date();
        const history = [
          ...asHistory(current.history),
          {
            action: status,
            actorUserId: actor.userId,
            at: now.toISOString(),
            reason: parsed.data.reason,
          },
        ];
        const result = await tx.subscriptionTransfer.updateMany({
          where: {
            id: current.id,
            tenantId: current.tenantId,
            status: SubscriptionTransferStatus.PENDING_REVIEW,
            version: parsed.data.expectedVersion,
          },
          data: {
            status: nextStatus,
            reviewedBy: actor.userId,
            reviewedAt: now,
            reviewReason: parsed.data.reason,
            version: parsed.data.expectedVersion + 1,
            history: history as Prisma.InputJsonValue,
          },
        });
        if (result.count !== 1) throw new SubscriptionTransferConflictError();
        const record = await tx.subscriptionTransfer.findUnique({ where: { id: current.id } });
        if (!record) throw new SubscriptionTransferNotFoundError();
        return record;
      });
      return presentTransfer(updated);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new SubscriptionPaymentStorageUnavailableError();
    }
  }

  async getTransferReceipt(transferId: string): Promise<StoredTransfer> {
    if (!subscriptionTransferIdSchema.safeParse(transferId).success) {
      throw new SubscriptionPaymentInputError();
    }
    try {
      const record = await this.prisma.subscriptionTransfer.findUnique({
        where: { id: transferId },
      });
      if (!record) throw new SubscriptionTransferNotFoundError();
      return record;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new SubscriptionPaymentStorageUnavailableError();
    }
  }
}

function asHistory(value: Prisma.JsonValue | null): unknown[] {
  return Array.isArray(value) ? value : [];
}

function presentTransfer(record: StoredTransfer): SubscriptionTransferView {
  const view = { ...record };
  delete (view as Partial<StoredTransfer>).receiptBytes;
  delete (view as Partial<StoredTransfer>).idempotencyKeyHash;
  return { ...view, amountMinor: record.amountMinor?.toString() ?? null };
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
