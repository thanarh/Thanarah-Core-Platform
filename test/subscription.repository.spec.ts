import { PlanStatus, Prisma, SubscriptionStatus, TenantStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import {
  SubscriptionRepository,
  type SubscriptionRecord,
} from '../src/subscriptions/subscription.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const subscriptionId = '33333333-3333-4333-8333-333333333333';
const otherSubscriptionId = '44444444-4444-4444-8444-444444444444';
const startsAt = new Date('2026-10-01T00:00:00.000Z');
const endsAt = new Date('2026-11-01T00:00:00.000Z');
const now = new Date('2026-10-06T12:00:00.000Z');

function subscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: subscriptionId,
    tenantId,
    planId,
    status: SubscriptionStatus.ACTIVE,
    startsAt,
    endsAt,
    cancelledAt: null,
    createdAt: startsAt,
    updatedAt: startsAt,
    ...overrides,
  } as SubscriptionRecord;
}

const transaction = {
  $queryRaw: vi.fn(),
  subscription: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
};
const prisma = {
  subscription: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<unknown>) =>
    callback(transaction),
  ),
};
const repository = new SubscriptionRepository(prisma as unknown as PrismaService);

describe('SubscriptionRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists by optional tenant and lifecycle filters with stable bounded pagination', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);

    await repository.list({
      tenantId,
      status: SubscriptionStatus.SUSPENDED,
      limit: 25,
      offset: 10,
    });

    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, status: SubscriptionStatus.SUSPENDED },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 25,
      }),
    );
  });

  it('resolves current records from status and the half-open UTC date interval, never latest-created alone', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);

    await repository.findCurrentForTenant(tenantId, now);

    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          status: SubscriptionStatus.ACTIVE,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
        take: 2,
      }),
    );
  });

  it('locks Tenant then Plan before checking overlap and inserting in one READ COMMITTED transaction', async () => {
    const created = subscription();
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId, status: TenantStatus.ACTIVE }])
      .mockResolvedValueOnce([{ id: planId, status: PlanStatus.ACTIVE }]);
    transaction.subscription.findFirst.mockResolvedValue(null);
    transaction.subscription.create.mockResolvedValue(created);

    const result = await repository.createForActiveTenantAndPlan({
      tenantId,
      planId,
      status: SubscriptionStatus.ACTIVE,
      startsAt,
      endsAt,
    });

    expect(result).toEqual({ kind: 'created', subscription: created });
    expect(prisma.$transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.$queryRaw.mock.calls[0]?.[0].sql).toContain('FROM `Tenant`');
    expect(transaction.$queryRaw.mock.calls[0]?.[0].sql).toContain('FOR UPDATE');
    expect(transaction.$queryRaw.mock.calls[1]?.[0].sql).toContain('FROM `Plan`');
    expect(transaction.$queryRaw.mock.calls[1]?.[0].sql).toContain('FOR UPDATE');
    expect(transaction.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      transaction.subscription.findFirst.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(transaction.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          status: SubscriptionStatus.ACTIVE,
          AND: [
            { OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }] },
            { startsAt: { lt: endsAt } },
          ],
        },
        select: { id: true },
      }),
    );
    expect(transaction.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { tenantId, planId, status: SubscriptionStatus.ACTIVE, startsAt, endsAt },
      }),
    );
  });

  it('rejects an unavailable Tenant before reading or inserting a Plan assignment', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([
      { id: tenantId, status: TenantStatus.DEACTIVATED },
    ]);

    const result = await repository.createForActiveTenantAndPlan({
      tenantId,
      planId,
      status: SubscriptionStatus.ACTIVE,
      startsAt,
      endsAt,
    });

    expect(result).toEqual({ kind: 'tenant-unavailable' });
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.subscription.create).not.toHaveBeenCalled();
  });

  it('distinguishes a missing Tenant from an inactive Tenant', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([]);

    const result = await repository.createForActiveTenantAndPlan({
      tenantId,
      planId,
      status: SubscriptionStatus.ACTIVE,
      startsAt,
      endsAt,
    });

    expect(result).toEqual({ kind: 'tenant-not-found' });
    expect(transaction.subscription.create).not.toHaveBeenCalled();
  });

  it('rejects a missing or non-active Plan under a row lock', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId, status: TenantStatus.ACTIVE }])
      .mockResolvedValueOnce([{ id: planId, status: PlanStatus.ARCHIVED }]);

    const result = await repository.createForActiveTenantAndPlan({
      tenantId,
      planId,
      status: SubscriptionStatus.ACTIVE,
      startsAt,
      endsAt,
    });

    expect(result).toEqual({ kind: 'plan-unavailable' });
    expect(transaction.subscription.create).not.toHaveBeenCalled();
  });

  it('prevents overlapping ACTIVE periods, including open-ended periods', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId, status: TenantStatus.ACTIVE }])
      .mockResolvedValueOnce([{ id: planId, status: PlanStatus.ACTIVE }]);
    transaction.subscription.findFirst.mockResolvedValue({ id: otherSubscriptionId });

    const result = await repository.createForActiveTenantAndPlan({
      tenantId,
      planId,
      status: SubscriptionStatus.ACTIVE,
      startsAt,
      endsAt: null,
    });

    expect(result).toEqual({ kind: 'period-conflict' });
    expect(transaction.subscription.create).not.toHaveBeenCalled();
    expect(transaction.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          status: SubscriptionStatus.ACTIVE,
          AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }] }],
        },
      }),
    );
  });

  it('allows an ended historical record to be created without reserving an active period', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId, status: TenantStatus.ACTIVE }])
      .mockResolvedValueOnce([{ id: planId, status: PlanStatus.ACTIVE }]);
    transaction.subscription.create.mockResolvedValue(
      subscription({ status: SubscriptionStatus.EXPIRED, endsAt: now }),
    );

    const result = await repository.createForActiveTenantAndPlan({
      tenantId,
      planId,
      status: SubscriptionStatus.EXPIRED,
      startsAt,
      endsAt: now,
    });

    expect(result.kind).toBe('created');
    expect(transaction.subscription.findFirst).not.toHaveBeenCalled();
  });

  it('serializes transitions on the Tenant row and blocks a conflicting reactivation', async () => {
    const suspended = subscription({ status: SubscriptionStatus.SUSPENDED });
    prisma.subscription.findUnique.mockResolvedValue({ tenantId });
    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId, status: TenantStatus.ACTIVE }]);
    transaction.subscription.findFirst
      .mockResolvedValueOnce(suspended)
      .mockResolvedValueOnce({ id: otherSubscriptionId });

    const result = await repository.transition(subscriptionId, 'activate', now);

    expect(result).toEqual({ kind: 'period-conflict' });
    expect(transaction.$queryRaw.mock.calls[0]?.[0].sql).toContain('FROM `Tenant`');
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.subscription.findFirst.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(transaction.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('cancels atomically, preserves the row, and records the trusted cancellation time', async () => {
    const active = subscription();
    const cancelled = subscription({ status: SubscriptionStatus.CANCELLED, cancelledAt: now });
    prisma.subscription.findUnique.mockResolvedValue({ tenantId });
    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId, status: TenantStatus.ACTIVE }]);
    transaction.subscription.findFirst
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(cancelled);
    transaction.subscription.updateMany.mockResolvedValue({ count: 1 });

    const result = await repository.transition(subscriptionId, 'cancel', now);

    expect(result).toEqual({
      kind: 'updated',
      subscription: cancelled,
      previousStatus: SubscriptionStatus.ACTIVE,
    });
    expect(transaction.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: subscriptionId, tenantId, status: SubscriptionStatus.ACTIVE },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelledAt: now,
        updatedAt: now,
      },
    });
  });

  it('rejects a stale or missing subscription after acquiring its Tenant lock', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ tenantId });
    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId, status: TenantStatus.ACTIVE }]);
    transaction.subscription.findFirst.mockResolvedValue(null);

    const result = await repository.transition(subscriptionId, 'suspend', now);

    expect(result).toEqual({ kind: 'not-found' });
    expect(transaction.subscription.updateMany).not.toHaveBeenCalled();
  });
});
