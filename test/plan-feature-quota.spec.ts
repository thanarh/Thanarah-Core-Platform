import { describe, expect, it } from 'vitest';
import { updatePlanFeatureSchema } from '../src/platform-catalog/catalog.dto';
import {
  isPlanFeatureQuotaResourceKey,
  planFeatureQuotaLimitsSchema,
} from '../src/platform-catalog/plan-feature-quota';

describe('Plan Feature quota configuration contract', () => {
  it('accepts only server-defined resource keys and explicit COUNT or UNLIMITED limits', () => {
    expect(isPlanFeatureQuotaResourceKey('BRANCHES')).toBe(true);
    expect(isPlanFeatureQuotaResourceKey('APPOINTMENTS')).toBe(false);
    expect(
      planFeatureQuotaLimitsSchema.safeParse({
        BRANCHES: { type: 'COUNT', max: 0 },
      }).success,
    ).toBe(true);
    expect(
      planFeatureQuotaLimitsSchema.safeParse({
        BRANCHES: { type: 'UNLIMITED' },
      }).success,
    ).toBe(true);
    expect(planFeatureQuotaLimitsSchema.safeParse({}).success).toBe(true);
  });

  it('rejects invalid counts, unknown resources, and undocumented limit fields', () => {
    for (const max of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        planFeatureQuotaLimitsSchema.safeParse({
          BRANCHES: { type: 'COUNT', max },
        }).success,
      ).toBe(false);
    }
    expect(
      planFeatureQuotaLimitsSchema.safeParse({
        APPOINTMENTS: { type: 'COUNT', max: 3 },
      }).success,
    ).toBe(false);
    expect(
      planFeatureQuotaLimitsSchema.safeParse({
        BRANCHES: { type: 'COUNT', max: 3, currentUsage: 0 },
      }).success,
    ).toBe(false);
  });

  it('allows quota-only PlanFeature updates and explicit clearing, but rejects empty bodies', () => {
    expect(
      updatePlanFeatureSchema.safeParse({
        quotaLimits: { BRANCHES: { type: 'COUNT', max: 3 } },
      }).success,
    ).toBe(true);
    expect(updatePlanFeatureSchema.safeParse({ quotaLimits: null }).success).toBe(true);
    expect(updatePlanFeatureSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(updatePlanFeatureSchema.safeParse({}).success).toBe(false);
    expect(
      updatePlanFeatureSchema.safeParse({
        quotaLimits: { CLIENT_RESOURCE: { type: 'COUNT', max: 3 } },
      }).success,
    ).toBe(false);
  });
});
