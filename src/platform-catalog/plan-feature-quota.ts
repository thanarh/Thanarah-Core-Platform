import { z } from 'zod';

// Resource keys are server-owned and intentionally separate from Feature keys.
export const PLAN_FEATURE_QUOTA_RESOURCE_KEYS = ['BRANCHES'] as const;
export type PlanFeatureQuotaResourceKey = (typeof PLAN_FEATURE_QUOTA_RESOURCE_KEYS)[number];

const quotaResourceKeySet = new Set<string>(PLAN_FEATURE_QUOTA_RESOURCE_KEYS);

export function isPlanFeatureQuotaResourceKey(
  value: unknown,
): value is PlanFeatureQuotaResourceKey {
  return typeof value === 'string' && quotaResourceKeySet.has(value);
}

const safeNonNegativeIntegerSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);

export const planFeatureQuotaLimitSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('COUNT'), max: safeNonNegativeIntegerSchema }).strict(),
  z.object({ type: z.literal('UNLIMITED') }).strict(),
]);

export type PlanFeatureQuotaLimit = z.infer<typeof planFeatureQuotaLimitSchema>;

export const planFeatureQuotaLimitsSchema = z
  .record(z.string(), planFeatureQuotaLimitSchema)
  .superRefine((limits, context) => {
    for (const resourceKey of Object.keys(limits)) {
      if (!isPlanFeatureQuotaResourceKey(resourceKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Unsupported quota resource',
          path: [resourceKey],
        });
      }
    }
  });

export type PlanFeatureQuotaLimits = z.infer<typeof planFeatureQuotaLimitsSchema>;
