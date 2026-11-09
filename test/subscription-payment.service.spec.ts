import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PrismaService } from '../src/database/prisma.service';
import {
  SubscriptionPaymentInputError,
  SubscriptionTransferPaymentUnavailableError,
} from '../src/subscriptions/subscription-payment.errors';
import { SubscriptionPaymentService } from '../src/subscriptions/subscription-payment.service';

const actor: AuthenticatedPlatformUser = {
  userId: '44444444-4444-4444-8444-444444444444',
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: [],
};
const tenantId = '11111111-1111-4111-8111-111111111111';
const subscriptionId = '22222222-2222-4222-8222-222222222222';
const transferId = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const paymentSettings = {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  };
  const transfers = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  };
  const tx = {
    subscriptionPaymentSettings: paymentSettings,
    subscriptionTransfer: transfers,
    $queryRaw: vi.fn(),
  };
  const prisma = {
    subscriptionPaymentSettings: paymentSettings,
    subscriptionTransfer: transfers,
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === 'function') {
        return (input as (transaction: typeof tx) => Promise<unknown>)(tx);
      }
      return Promise.all(input as Promise<unknown>[]);
    }),
  };
  return {
    service: new SubscriptionPaymentService(prisma as unknown as PrismaService),
    paymentSettings,
    transfers,
    tx,
    prisma,
  };
}

function transferRecord(status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' = 'PENDING_REVIEW') {
  return {
    id: transferId,
    tenantId,
    subscriptionId,
    status,
    amountMinor: null,
    currencyCode: null,
    receiptFileName: 'receipt.pdf',
    receiptMimeType: 'application/pdf',
    receiptSha256: 'a'.repeat(64),
    receiptBytes: Buffer.from('%PDF-1.4\nreceipt'),
    submittedBy: actor.userId,
    submittedAt: new Date('2026-11-09T00:00:00.000Z'),
    reviewedBy: status === 'PENDING_REVIEW' ? null : actor.userId,
    reviewedAt: status === 'PENDING_REVIEW' ? null : new Date('2026-11-09T00:01:00.000Z'),
    reviewReason: status === 'PENDING_REVIEW' ? null : 'Receipt checked',
    version: status === 'PENDING_REVIEW' ? 1 : 2,
    history:
      status === 'PENDING_REVIEW'
        ? [{ action: 'SUBMITTED', actorUserId: actor.userId, at: '2026-11-09T00:00:00.000Z' }]
        : [
            { action: 'SUBMITTED', actorUserId: actor.userId, at: '2026-11-09T00:00:00.000Z' },
            {
              action: status,
              actorUserId: actor.userId,
              at: '2026-11-09T00:01:00.000Z',
              reason: 'Receipt checked',
            },
          ],
    idempotencyKeyHash: null,
  };
}

describe('SubscriptionPaymentService', () => {
  it('defaults central bank-transfer settings to disabled', async () => {
    const { service, paymentSettings } = fixture();
    paymentSettings.findUnique.mockResolvedValue(null);

    await expect(service.getSettings()).resolves.toMatchObject({
      enabled: false,
      bankName: null,
      accountHolder: null,
      iban: null,
      currencyCode: null,
      version: 0,
      history: [],
    });
  });

  it('rejects enabling transfers without approved bank details', async () => {
    const { service } = fixture();

    await expect(
      service.updateSettings(
        {
          expectedVersion: 0,
          enabled: true,
          bankName: null,
          accountHolder: null,
          iban: null,
          currencyCode: null,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(SubscriptionPaymentInputError);
  });

  it('stores a receipt and records approval without changing subscription state', async () => {
    const { service, paymentSettings, transfers, tx } = fixture();
    paymentSettings.findUnique.mockResolvedValue({
      id: 'default',
      enabled: true,
      bankName: 'Configured Bank',
      accountHolder: 'Platform Account',
      iban: 'SA0000000000000000000000',
      currencyCode: 'SAR',
      version: 1,
    });
    tx.$queryRaw.mockResolvedValue([{ id: subscriptionId, tenantId }]);
    transfers.findFirst.mockResolvedValue(null);
    transfers.create.mockResolvedValue(transferRecord());

    const submitted = await service.submitTransfer(
      subscriptionId,
      {
        bytes: Buffer.from('%PDF-1.4\nreceipt'),
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf',
        sha256: 'a'.repeat(64),
      },
      {},
      actor,
    );

    expect(submitted).toMatchObject({
      id: transferId,
      status: 'PENDING_REVIEW',
      amountMinor: null,
      currencyCode: null,
    });
    expect(submitted).not.toHaveProperty('receiptBytes');
    expect(submitted).not.toHaveProperty('idempotencyKeyHash');

    transfers.findUnique.mockResolvedValue(transferRecord());
    transfers.updateMany.mockResolvedValue({ count: 1 });
    transfers.findUnique
      .mockResolvedValueOnce(transferRecord())
      .mockResolvedValueOnce(transferRecord('APPROVED'));
    const approved = await service.reviewTransfer(
      transferId,
      { expectedVersion: 1, reason: 'Receipt checked' },
      'APPROVED',
      actor,
    );

    expect(approved).toMatchObject({
      status: 'APPROVED',
      reviewReason: 'Receipt checked',
      version: 2,
    });
    expect(approved.history).toHaveLength(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('keeps receipt submission unavailable while the central route is disabled', async () => {
    const { service, paymentSettings } = fixture();
    paymentSettings.findUnique.mockResolvedValue(null);

    await expect(
      service.submitTransfer(
        subscriptionId,
        {
          bytes: Buffer.from('%PDF-1.4\nreceipt'),
          fileName: 'receipt.pdf',
          mimeType: 'application/pdf',
          sha256: 'a'.repeat(64),
        },
        {},
        actor,
      ),
    ).rejects.toBeInstanceOf(SubscriptionTransferPaymentUnavailableError);
  });
});
