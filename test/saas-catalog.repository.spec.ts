import { FeatureStatus, PlanStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { FeatureRepository } from '../src/platform-catalog/feature.repository';
import { PlanRepository } from '../src/platform-catalog/plan.repository';

describe('SaaS catalog repositories', () => {
  it('scopes Plan persistence and filters lists by platform lifecycle', async () => {
    const record = { id: 'plan-id', key: 'PRO', status: PlanStatus.ACTIVE };
    const prisma = {
      plan: {
        create: vi.fn().mockResolvedValue(record),
        findUnique: vi.fn().mockResolvedValue(record),
        findMany: vi.fn().mockResolvedValue([record]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const repository = new PlanRepository(prisma as unknown as PrismaService);

    await repository.create({ key: 'PRO', name: 'Professional' });
    await repository.list({ status: PlanStatus.INACTIVE, limit: 12, offset: 24 });

    expect(prisma.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { key: 'PRO', name: 'Professional' } }),
    );
    expect(prisma.plan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: PlanStatus.INACTIVE },
        skip: 24,
        take: 12,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('uses compare-and-set Plan status updates and restricts associations to their composite key', async () => {
    const planFeatureRecord = {
      planId: 'plan-id',
      featureId: 'feature-id',
      enabled: true,
      feature: { id: 'feature-id', status: FeatureStatus.ACTIVE },
    };
    const prisma = {
      plan: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ id: 'plan-id', status: PlanStatus.INACTIVE }),
      },
      planFeature: {
        findUnique: vi.fn().mockResolvedValue(planFeatureRecord),
        findMany: vi.fn().mockResolvedValue([planFeatureRecord]),
        create: vi.fn().mockResolvedValue(planFeatureRecord),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const repository = new PlanRepository(prisma as unknown as PrismaService);
    const changedAt = new Date('2026-10-06T10:00:00.000Z');

    await repository.changeStatusIfCurrent(
      'plan-id',
      PlanStatus.ACTIVE,
      PlanStatus.INACTIVE,
      changedAt,
    );
    await repository.findPlanFeature('plan-id', 'feature-id');
    await repository.attachFeature('plan-id', 'feature-id');
    await repository.updateFeatureEnabled('plan-id', 'feature-id', false);
    await repository.detachFeature('plan-id', 'feature-id');

    expect(prisma.plan.updateMany).toHaveBeenCalledWith({
      where: { id: 'plan-id', status: PlanStatus.ACTIVE },
      data: { status: PlanStatus.INACTIVE, statusChangedAt: changedAt },
    });
    expect(prisma.planFeature.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { planId_featureId: { planId: 'plan-id', featureId: 'feature-id' } },
      }),
    );
    expect(prisma.planFeature.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { planId: 'plan-id', featureId: 'feature-id' } }),
    );
    expect(prisma.planFeature.deleteMany).toHaveBeenCalledWith({
      where: { planId: 'plan-id', featureId: 'feature-id' },
    });
  });

  it('scopes Feature queries and update operations by the current lifecycle state', async () => {
    const record = { id: 'feature-id', key: 'REPORTS', status: FeatureStatus.ACTIVE };
    const prisma = {
      feature: {
        create: vi.fn().mockResolvedValue(record),
        findUnique: vi.fn().mockResolvedValue(record),
        findMany: vi.fn().mockResolvedValue([record]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const repository = new FeatureRepository(prisma as unknown as PrismaService);

    await repository.create({ key: 'REPORTS', name: 'Reports' });
    await repository.list({ status: FeatureStatus.ACTIVE, limit: 10, offset: 0 });
    await repository.updateIfCurrentStatus('feature-id', FeatureStatus.ACTIVE, {
      name: 'Analytics',
    });

    expect(prisma.feature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: FeatureStatus.ACTIVE }, take: 10, skip: 0 }),
    );
    expect(prisma.feature.updateMany).toHaveBeenCalledWith({
      where: { id: 'feature-id', status: FeatureStatus.ACTIVE },
      data: { name: 'Analytics' },
    });
  });
});
