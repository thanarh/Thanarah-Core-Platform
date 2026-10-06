import { FeatureStatus, PlanStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { TenantEntitlementRepository } from '../src/tenant/tenant-entitlement.repository';

const planId = '11111111-1111-4111-8111-111111111111';
const featureId = '22222222-2222-4222-8222-222222222222';

describe('TenantEntitlementRepository', () => {
  const prisma = {
    plan: { findUnique: vi.fn() },
    feature: { findUnique: vi.fn() },
  };
  let repository: TenantEntitlementRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new TenantEntitlementRepository(prisma as unknown as PrismaService);
    prisma.plan.findUnique.mockResolvedValue({
      status: PlanStatus.ACTIVE,
      features: [
        {
          enabled: true,
          feature: { id: featureId, status: FeatureStatus.ACTIVE },
        },
      ],
    });
    prisma.feature.findUnique.mockResolvedValue({ status: FeatureStatus.ACTIVE });
  });

  it('resolves only an enabled PlanFeature and active Feature on the selected Plan', async () => {
    await expect(repository.resolveFeatureOnPlan(planId, 'APPOINTMENTS')).resolves.toEqual({
      kind: 'entitled',
      featureId,
    });
    expect(prisma.plan.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: planId },
        select: expect.objectContaining({
          features: expect.objectContaining({
            where: { feature: { key: 'APPOINTMENTS' } },
            take: 2,
          }),
        }),
      }),
    );
    expect(prisma.feature.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when the referenced Plan no longer exists', async () => {
    prisma.plan.findUnique.mockResolvedValueOnce(null);

    await expect(repository.resolveFeatureOnPlan(planId, 'APPOINTMENTS')).resolves.toEqual({
      kind: 'plan-not-found',
    });
  });

  it.each([PlanStatus.INACTIVE, PlanStatus.ARCHIVED])(
    'does not grant entitlement from a %s Plan',
    async (status) => {
      prisma.plan.findUnique.mockResolvedValueOnce({ status, features: [] });

      await expect(repository.resolveFeatureOnPlan(planId, 'APPOINTMENTS')).resolves.toEqual({
        kind: 'plan-unavailable',
      });
      expect(prisma.feature.findUnique).not.toHaveBeenCalled();
    },
  );

  it('does not grant entitlement when the feature definition does not exist', async () => {
    prisma.plan.findUnique.mockResolvedValueOnce({ status: PlanStatus.ACTIVE, features: [] });
    prisma.feature.findUnique.mockResolvedValueOnce(null);

    await expect(repository.resolveFeatureOnPlan(planId, 'APPOINTMENTS')).resolves.toEqual({
      kind: 'feature-not-found',
    });
  });

  it('does not grant entitlement to an inactive Feature without a PlanFeature', async () => {
    prisma.plan.findUnique.mockResolvedValueOnce({ status: PlanStatus.ACTIVE, features: [] });
    prisma.feature.findUnique.mockResolvedValueOnce({ status: FeatureStatus.INACTIVE });

    await expect(repository.resolveFeatureOnPlan(planId, 'APPOINTMENTS')).resolves.toEqual({
      kind: 'feature-unavailable',
    });
  });

  it('does not grant an active Feature that is not attached to this Plan', async () => {
    prisma.plan.findUnique.mockResolvedValueOnce({ status: PlanStatus.ACTIVE, features: [] });

    await expect(repository.resolveFeatureOnPlan(planId, 'APPOINTMENTS')).resolves.toEqual({
      kind: 'plan-feature-missing',
    });
    expect(prisma.feature.findUnique).toHaveBeenCalledWith({
      where: { key: 'APPOINTMENTS' },
      select: { status: true },
    });
  });

  it('does not grant an inactive Feature even when its PlanFeature is enabled', async () => {
    prisma.plan.findUnique.mockResolvedValueOnce({
      status: PlanStatus.ACTIVE,
      features: [{ enabled: true, feature: { id: featureId, status: FeatureStatus.INACTIVE } }],
    });

    await expect(repository.resolveFeatureOnPlan(planId, 'APPOINTMENTS')).resolves.toEqual({
      kind: 'feature-unavailable',
    });
  });

  it('does not grant a disabled PlanFeature', async () => {
    prisma.plan.findUnique.mockResolvedValueOnce({
      status: PlanStatus.ACTIVE,
      features: [{ enabled: false, feature: { id: featureId, status: FeatureStatus.ACTIVE } }],
    });

    await expect(repository.resolveFeatureOnPlan(planId, 'APPOINTMENTS')).resolves.toEqual({
      kind: 'plan-feature-disabled',
    });
  });

  it('fails closed if contradictory duplicate PlanFeature rows are returned', async () => {
    prisma.plan.findUnique.mockResolvedValueOnce({
      status: PlanStatus.ACTIVE,
      features: [
        { enabled: true, feature: { id: featureId, status: FeatureStatus.ACTIVE } },
        {
          enabled: false,
          feature: { id: '33333333-3333-4333-8333-333333333333', status: FeatureStatus.ACTIVE },
        },
      ],
    });

    await expect(repository.resolveFeatureOnPlan(planId, 'APPOINTMENTS')).resolves.toEqual({
      kind: 'plan-feature-ambiguous',
    });
  });

  it('propagates database failures instead of silently granting or denying by fallback', async () => {
    const databaseError = new Error('database unavailable');
    prisma.plan.findUnique.mockRejectedValueOnce(databaseError);

    await expect(repository.resolveFeatureOnPlan(planId, 'APPOINTMENTS')).rejects.toBe(
      databaseError,
    );
  });
});
