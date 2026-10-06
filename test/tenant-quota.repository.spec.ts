import { FeatureStatus, PlanStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { TenantQuotaRepository } from '../src/tenant/tenant-quota.repository';

describe('TenantQuotaRepository', () => {
  it('loads configuration only from the entitled PlanFeature and checks its live status', async () => {
    const association = {
      enabled: true,
      quotaLimits: { BRANCHES: { type: 'COUNT', max: 4 } },
      plan: { status: PlanStatus.ACTIVE },
      feature: { status: FeatureStatus.ACTIVE },
    };
    const prisma = {
      planFeature: { findUnique: vi.fn().mockResolvedValue(association) },
    };
    const repository = new TenantQuotaRepository(prisma as unknown as PrismaService);

    await expect(
      repository.findActivePlanFeatureQuotaLimits('current-plan', 'entitled-feature'),
    ).resolves.toEqual({ kind: 'ready', quotaLimits: association.quotaLimits });
    expect(prisma.planFeature.findUnique).toHaveBeenCalledWith({
      where: {
        planId_featureId: { planId: 'current-plan', featureId: 'entitled-feature' },
      },
      select: {
        enabled: true,
        quotaLimits: true,
        plan: { select: { status: true } },
        feature: { select: { status: true } },
      },
    });
  });

  it.each([
    ['missing association', null],
    [
      'disabled association',
      {
        enabled: false,
        quotaLimits: null,
        plan: { status: PlanStatus.ACTIVE },
        feature: { status: FeatureStatus.ACTIVE },
      },
    ],
    [
      'inactive plan',
      {
        enabled: true,
        quotaLimits: null,
        plan: { status: PlanStatus.INACTIVE },
        feature: { status: FeatureStatus.ACTIVE },
      },
    ],
    [
      'inactive feature',
      {
        enabled: true,
        quotaLimits: null,
        plan: { status: PlanStatus.ACTIVE },
        feature: { status: FeatureStatus.INACTIVE },
      },
    ],
  ])('fails closed for a %s', async (_label, association) => {
    const prisma = {
      planFeature: { findUnique: vi.fn().mockResolvedValue(association) },
    };
    const repository = new TenantQuotaRepository(prisma as unknown as PrismaService);

    await expect(
      repository.findActivePlanFeatureQuotaLimits('current-plan', 'entitled-feature'),
    ).resolves.toEqual({ kind: 'unavailable' });
  });
});
