import { SubscriptionStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionView } from '../src/subscriptions/subscription.service';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  type TrustedTenantContext,
} from '../src/tenant/tenant-context.contract';
import { TenantFeatureNotIncludedError } from '../src/tenant/tenant-entitlement.errors';
import type { TenantEntitlementRepository } from '../src/tenant/tenant-entitlement.repository';
import { TenantEntitlementService } from '../src/tenant/tenant-entitlement.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const platformUserId = '33333333-3333-4333-8333-333333333333';
const subscriptionId = '44444444-4444-4444-8444-444444444444';
const planId = '55555555-5555-4555-8555-555555555555';
const otherPlanId = '66666666-6666-4666-8666-666666666666';
const featureId = '77777777-7777-4777-8777-777777777777';
const context = { tenantId, membershipId, platformUserId } as unknown as TrustedTenantContext;
const otherTenantContext = {
  tenantId: otherTenantId,
  membershipId: '88888888-8888-4888-8888-888888888888',
  platformUserId,
} as unknown as TrustedTenantContext;
const now = new Date('2026-01-01T00:00:00.000Z');

function currentSubscription(overrides: Partial<SubscriptionView> = {}): SubscriptionView {
  return {
    id: subscriptionId,
    tenantId,
    planId,
    status: SubscriptionStatus.ACTIVE,
    startsAt: new Date('2025-12-01T00:00:00.000Z'),
    endsAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    effectiveStatus: SubscriptionStatus.ACTIVE,
    ...overrides,
  };
}

describe('TenantEntitlementService', () => {
  const subscriptions = { findCurrentForTenant: vi.fn() };
  const repository = { resolveFeatureOnPlan: vi.fn() };
  let service: TenantEntitlementService;

  beforeEach(() => {
    vi.clearAllMocks();
    subscriptions.findCurrentForTenant.mockResolvedValue(currentSubscription());
    repository.resolveFeatureOnPlan.mockResolvedValue({ kind: 'entitled', featureId });
    service = new TenantEntitlementService(
      subscriptions as unknown as ConstructorParameters<typeof TenantEntitlementService>[0],
      repository as unknown as TenantEntitlementRepository,
    );
  });

  it('entitles an active Feature included by the current active PlanFeature', async () => {
    await expect(service.resolve(context, 'APPOINTMENTS')).resolves.toEqual({
      outcome: 'ENTITLED',
      entitled: true,
      featureKey: 'APPOINTMENTS',
      subscriptionId,
      planId,
      featureId,
    });
    expect(subscriptions.findCurrentForTenant).toHaveBeenCalledExactlyOnceWith(tenantId);
    expect(repository.resolveFeatureOnPlan).toHaveBeenCalledExactlyOnceWith(planId, 'APPOINTMENTS');
  });

  it('uses only the tenant from trusted context to resolve the current Subscription', async () => {
    subscriptions.findCurrentForTenant.mockResolvedValueOnce(
      currentSubscription({ tenantId: otherTenantId, planId: otherPlanId }),
    );

    await service.resolve(otherTenantContext, 'APPOINTMENTS');

    expect(subscriptions.findCurrentForTenant).toHaveBeenCalledExactlyOnceWith(otherTenantId);
    expect(repository.resolveFeatureOnPlan).toHaveBeenCalledExactlyOnceWith(
      otherPlanId,
      'APPOINTMENTS',
    );
  });

  it('does not use a Subscription from another Tenant even if a lookup returns one', async () => {
    await expect(service.resolve(otherTenantContext, 'APPOINTMENTS')).resolves.toMatchObject({
      entitled: false,
      reason: 'NOT_ENTITLED_NO_SUBSCRIPTION',
    });
    expect(repository.resolveFeatureOnPlan).not.toHaveBeenCalled();
  });

  it('does not let an additional client-shaped tenant or plan value override trusted context', async () => {
    await Reflect.apply(service.resolve, service, [
      context,
      'APPOINTMENTS',
      { tenantId: otherTenantId, planId: otherPlanId, featureId },
    ]);

    expect(subscriptions.findCurrentForTenant).toHaveBeenCalledExactlyOnceWith(tenantId);
    expect(repository.resolveFeatureOnPlan).toHaveBeenCalledExactlyOnceWith(planId, 'APPOINTMENTS');
  });

  it('fails closed when there is no current Subscription', async () => {
    subscriptions.findCurrentForTenant.mockResolvedValueOnce(null);

    await expect(service.resolve(context, 'APPOINTMENTS')).resolves.toMatchObject({
      entitled: false,
      reason: 'NOT_ENTITLED_NO_SUBSCRIPTION',
    });
    expect(repository.resolveFeatureOnPlan).not.toHaveBeenCalled();
  });

  it.each([SubscriptionStatus.SUSPENDED, SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED])(
    'fails closed if the current lookup returns a %s Subscription',
    async (status) => {
      subscriptions.findCurrentForTenant.mockResolvedValueOnce(
        currentSubscription({ status, effectiveStatus: status }),
      );

      await expect(service.resolve(context, 'APPOINTMENTS')).resolves.toMatchObject({
        entitled: false,
        reason: 'NOT_ENTITLED_SUBSCRIPTION_STATUS',
      });
      expect(repository.resolveFeatureOnPlan).not.toHaveBeenCalled();
    },
  );

  it.each(['SCHEDULED', 'EXPIRED'] as const)(
    'fails closed for a date-derived %s Subscription state',
    async (effectiveStatus) => {
      subscriptions.findCurrentForTenant.mockResolvedValueOnce(
        currentSubscription({ effectiveStatus }),
      );

      await expect(service.resolve(context, 'APPOINTMENTS')).resolves.toMatchObject({
        entitled: false,
        reason: 'NOT_ENTITLED_SUBSCRIPTION_STATUS',
      });
      expect(repository.resolveFeatureOnPlan).not.toHaveBeenCalled();
    },
  );

  it.each([
    { kind: 'plan-not-found', reason: 'NOT_ENTITLED_PLAN' },
    { kind: 'plan-unavailable', reason: 'NOT_ENTITLED_PLAN' },
    { kind: 'feature-not-found', reason: 'NOT_ENTITLED_FEATURE' },
    { kind: 'feature-unavailable', reason: 'NOT_ENTITLED_FEATURE' },
    { kind: 'plan-feature-missing', reason: 'NOT_ENTITLED_PLAN_FEATURE' },
    { kind: 'plan-feature-disabled', reason: 'NOT_ENTITLED_PLAN_FEATURE' },
    { kind: 'plan-feature-ambiguous', reason: 'NOT_ENTITLED_PLAN_FEATURE' },
  ] as const)('maps $kind to a structured fail-closed decision', async ({ kind, reason }) => {
    repository.resolveFeatureOnPlan.mockResolvedValueOnce({ kind });

    await expect(service.resolve(context, 'APPOINTMENTS')).resolves.toMatchObject({
      outcome: 'NOT_ENTITLED',
      entitled: false,
      reason,
      featureKey: 'APPOINTMENTS',
    });
  });

  it('rejects missing trusted tenant context before querying subscription data', async () => {
    await expect(service.resolve(undefined, 'APPOINTMENTS')).rejects.toBeInstanceOf(
      TenantContextRequiredError,
    );
    expect(subscriptions.findCurrentForTenant).not.toHaveBeenCalled();
  });

  it('rejects malformed tenant context before querying subscription data', async () => {
    const malformed = { ...context, tenantId: 'not-a-tenant' } as unknown as TrustedTenantContext;

    await expect(service.resolve(malformed, 'APPOINTMENTS')).rejects.toBeInstanceOf(
      TenantContextInvalidError,
    );
    expect(subscriptions.findCurrentForTenant).not.toHaveBeenCalled();
  });

  it('does not resolve a client-style Feature key as entitlement evidence', async () => {
    await expect(service.resolve(context, 'appointments')).resolves.toMatchObject({
      entitled: false,
      reason: 'NOT_ENTITLED_FEATURE',
    });
    expect(subscriptions.findCurrentForTenant).not.toHaveBeenCalled();
    expect(repository.resolveFeatureOnPlan).not.toHaveBeenCalled();
  });

  it('fails closed when current-subscription lookup detects conflicting records', async () => {
    const conflict = new Error('safe internal conflict');
    subscriptions.findCurrentForTenant.mockRejectedValueOnce(conflict);

    await expect(service.resolve(context, 'APPOINTMENTS')).rejects.toBe(conflict);
    expect(repository.resolveFeatureOnPlan).not.toHaveBeenCalled();
  });

  it('returns one generic 403 without exposing Feature, Plan, or Subscription details', async () => {
    repository.resolveFeatureOnPlan.mockResolvedValueOnce({ kind: 'plan-feature-disabled' });

    await expect(service.requireFeature(context, 'APPOINTMENTS')).rejects.toBeInstanceOf(
      TenantFeatureNotIncludedError,
    );
    expect(new TenantFeatureNotIncludedError().getResponse()).toEqual({
      code: 'FEATURE_NOT_INCLUDED',
      message: 'The required feature is not available',
    });
  });

  it('allows requireFeature only when the structured decision is entitled', async () => {
    await expect(service.requireFeature(context, 'APPOINTMENTS')).resolves.toBeUndefined();
  });
});
