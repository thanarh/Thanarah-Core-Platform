import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import { TenantContextInvalidError } from '../src/tenant/tenant-context.contract';
import type { TenantEntitlementService } from '../src/tenant/tenant-entitlement.service';
import { TenantQuotaInputInvalidError } from '../src/tenant/tenant-quota.errors';
import type { TenantQuotaRepository } from '../src/tenant/tenant-quota.repository';
import { TenantQuotaService } from '../src/tenant/tenant-quota.service';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  membershipId: '22222222-2222-4222-8222-222222222222',
  platformUserId: '33333333-3333-4333-8333-333333333333',
} as TrustedTenantContext;

const entitled = {
  outcome: 'ENTITLED' as const,
  entitled: true as const,
  featureKey: 'REPORTS',
  subscriptionId: 'subscription-from-current-context',
  planId: 'current-plan',
  featureId: 'entitled-feature',
};

describe('TenantQuotaService', () => {
  const entitlements = { resolve: vi.fn() };
  const quotas = { findActivePlanFeatureQuotaLimits: vi.fn() };
  let service: TenantQuotaService;

  beforeEach(() => {
    vi.clearAllMocks();
    entitlements.resolve.mockResolvedValue(entitled);
    quotas.findActivePlanFeatureQuotaLimits.mockResolvedValue({
      kind: 'ready',
      quotaLimits: { BRANCHES: { type: 'COUNT', max: 3 } },
    });
    service = new TenantQuotaService(
      entitlements as unknown as TenantEntitlementService,
      quotas as unknown as TenantQuotaRepository,
    );
  });

  it('requires entitlement before evaluating the current PlanFeature quota', async () => {
    await expect(
      service.checkQuota(context, {
        featureKey: 'REPORTS',
        resourceKey: 'BRANCHES',
        currentUsage: 2,
      }),
    ).resolves.toEqual({ outcome: 'AVAILABLE', resourceKey: 'BRANCHES', limitType: 'COUNT' });
    expect(entitlements.resolve).toHaveBeenCalledExactlyOnceWith(context, 'REPORTS');
    expect(quotas.findActivePlanFeatureQuotaLimits).toHaveBeenCalledExactlyOnceWith(
      'current-plan',
      'entitled-feature',
    );
  });

  it.each([
    [2, 'AVAILABLE'],
    [3, 'EXCEEDED'],
    [4, 'EXCEEDED'],
  ] as const)(
    'compares usage against a finite inclusive maximum (%i)',
    async (currentUsage, outcome) => {
      await expect(
        service.checkQuota(context, {
          featureKey: 'REPORTS',
          resourceKey: 'BRANCHES',
          currentUsage,
        }),
      ).resolves.toMatchObject({ outcome });
    },
  );

  it('treats explicit UNLIMITED as available without granting a missing entitlement', async () => {
    quotas.findActivePlanFeatureQuotaLimits.mockResolvedValue({
      kind: 'ready',
      quotaLimits: { BRANCHES: { type: 'UNLIMITED' } },
    });
    await expect(
      service.checkQuota(context, {
        featureKey: 'REPORTS',
        resourceKey: 'BRANCHES',
        currentUsage: Number.MAX_SAFE_INTEGER,
      }),
    ).resolves.toEqual({
      outcome: 'AVAILABLE',
      resourceKey: 'BRANCHES',
      limitType: 'UNLIMITED',
    });

    entitlements.resolve.mockResolvedValue({
      outcome: 'NOT_ENTITLED',
      entitled: false,
      reason: 'NOT_ENTITLED_PLAN_FEATURE',
      featureKey: 'REPORTS',
    });
    await expect(
      service.checkQuota(context, {
        featureKey: 'REPORTS',
        resourceKey: 'BRANCHES',
        currentUsage: 0,
      }),
    ).resolves.toMatchObject({ outcome: 'NOT_ENTITLED' });
    expect(quotas.findActivePlanFeatureQuotaLimits).toHaveBeenCalledTimes(1);
  });

  it('returns NO_LIMIT_CONFIGURED only after a valid entitlement', async () => {
    quotas.findActivePlanFeatureQuotaLimits.mockResolvedValue({
      kind: 'ready',
      quotaLimits: {},
    });
    await expect(
      service.checkQuota(context, {
        featureKey: 'REPORTS',
        resourceKey: 'BRANCHES',
        currentUsage: 0,
      }),
    ).resolves.toMatchObject({ outcome: 'NO_LIMIT_CONFIGURED' });

    quotas.findActivePlanFeatureQuotaLimits.mockResolvedValue({
      kind: 'ready',
      quotaLimits: null,
    });
    await expect(
      service.checkQuota(context, {
        featureKey: 'REPORTS',
        resourceKey: 'BRANCHES',
        currentUsage: 0,
      }),
    ).resolves.toMatchObject({ outcome: 'NO_LIMIT_CONFIGURED' });
  });

  it('returns NO_SUBSCRIPTION without reading quota configuration', async () => {
    entitlements.resolve.mockResolvedValue({
      outcome: 'NOT_ENTITLED',
      entitled: false,
      reason: 'NOT_ENTITLED_NO_SUBSCRIPTION',
      featureKey: 'REPORTS',
    });
    await expect(
      service.checkQuota(context, {
        featureKey: 'REPORTS',
        resourceKey: 'BRANCHES',
        currentUsage: 0,
      }),
    ).resolves.toMatchObject({ outcome: 'NO_SUBSCRIPTION' });
    expect(quotas.findActivePlanFeatureQuotaLimits).not.toHaveBeenCalled();
  });

  it('returns NOT_ENTITLED for other entitlement or live PlanFeature failures', async () => {
    entitlements.resolve.mockResolvedValue({
      outcome: 'NOT_ENTITLED',
      entitled: false,
      reason: 'NOT_ENTITLED_SUBSCRIPTION_STATUS',
      featureKey: 'REPORTS',
    });
    await expect(
      service.checkQuota(context, {
        featureKey: 'REPORTS',
        resourceKey: 'BRANCHES',
        currentUsage: 0,
      }),
    ).resolves.toMatchObject({ outcome: 'NOT_ENTITLED' });
    expect(quotas.findActivePlanFeatureQuotaLimits).not.toHaveBeenCalled();

    entitlements.resolve.mockResolvedValue(entitled);
    quotas.findActivePlanFeatureQuotaLimits.mockResolvedValue({ kind: 'unavailable' });
    await expect(
      service.checkQuota(context, {
        featureKey: 'REPORTS',
        resourceKey: 'BRANCHES',
        currentUsage: 0,
      }),
    ).resolves.toMatchObject({ outcome: 'NOT_ENTITLED' });
  });

  it('fails closed when persisted quota configuration no longer matches its schema', async () => {
    quotas.findActivePlanFeatureQuotaLimits.mockResolvedValue({
      kind: 'ready',
      quotaLimits: { BRANCHES: { type: 'COUNT', max: -1 } },
    });
    await expect(
      service.checkQuota(context, {
        featureKey: 'REPORTS',
        resourceKey: 'BRANCHES',
        currentUsage: 0,
      }),
    ).resolves.toMatchObject({ outcome: 'INVALID_CONFIGURATION' });
  });

  it('rejects invalid usage, client-added plan identifiers, and arbitrary resource keys', async () => {
    for (const currentUsage of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await expect(
        service.checkQuota(context, {
          featureKey: 'REPORTS',
          resourceKey: 'BRANCHES',
          currentUsage,
        }),
      ).rejects.toBeInstanceOf(TenantQuotaInputInvalidError);
    }
    await expect(
      service.checkQuota(context, {
        featureKey: 'REPORTS',
        resourceKey: 'CLIENT_RESOURCE',
        currentUsage: 0,
      }),
    ).rejects.toBeInstanceOf(TenantQuotaInputInvalidError);
    await expect(
      service.checkQuota(context, {
        featureKey: 'REPORTS',
        resourceKey: 'BRANCHES',
        currentUsage: 0,
        planId: 'client-plan',
      } as never),
    ).rejects.toBeInstanceOf(TenantQuotaInputInvalidError);
    expect(entitlements.resolve).not.toHaveBeenCalled();
    expect(quotas.findActivePlanFeatureQuotaLimits).not.toHaveBeenCalled();
  });

  it('rejects malformed trusted context before entitlement or quota lookups', async () => {
    await expect(
      service.checkQuota({ ...context, tenantId: 'not-a-uuid' } as TrustedTenantContext, {
        featureKey: 'REPORTS',
        resourceKey: 'BRANCHES',
        currentUsage: 0,
      }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
    expect(entitlements.resolve).not.toHaveBeenCalled();
  });
});
