import { Inject, Injectable } from '@nestjs/common';
import {
  planFeatureQuotaLimitsSchema,
  isPlanFeatureQuotaResourceKey,
  type PlanFeatureQuotaResourceKey,
} from '../platform-catalog/plan-feature-quota';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  isWellFormedTrustedTenantContext,
  type TrustedTenantContext,
} from './tenant-context.contract';
import {
  TenantEntitlementService,
  type TenantEntitlementDecision,
} from './tenant-entitlement.service';
import { isTenantFeatureKey } from './tenant-require-feature.decorator';
import { TenantQuotaInputInvalidError } from './tenant-quota.errors';
import {
  TENANT_QUOTA_PERSISTENCE,
  type TenantQuotaPersistencePort,
} from '../persistence/platform-persistence.ports';

export interface TenantQuotaCheckInput {
  /** A server-selected Feature key required in addition to the quota resource. */
  featureKey: string;
  /** A server-defined resource key; it is not inferred from the Feature key. */
  resourceKey: string;
  /** Caller-supplied for decision evaluation only; this service does not persist or measure usage. */
  currentUsage: number;
}

export type TenantQuotaDecision =
  | {
      outcome: 'AVAILABLE';
      resourceKey: PlanFeatureQuotaResourceKey;
      limitType: 'COUNT' | 'UNLIMITED';
    }
  | { outcome: 'EXCEEDED'; resourceKey: PlanFeatureQuotaResourceKey }
  | { outcome: 'NO_LIMIT_CONFIGURED'; resourceKey: PlanFeatureQuotaResourceKey }
  | { outcome: 'NOT_ENTITLED'; resourceKey: PlanFeatureQuotaResourceKey }
  | { outcome: 'NO_SUBSCRIPTION'; resourceKey: PlanFeatureQuotaResourceKey }
  | { outcome: 'INVALID_CONFIGURATION'; resourceKey: PlanFeatureQuotaResourceKey };

@Injectable()
export class TenantQuotaService {
  constructor(
    private readonly entitlements: TenantEntitlementService,
    @Inject(TENANT_QUOTA_PERSISTENCE) private readonly quotas: TenantQuotaPersistencePort,
  ) {}

  async checkQuota(
    context: TrustedTenantContext | undefined,
    input: TenantQuotaCheckInput,
  ): Promise<TenantQuotaDecision> {
    if (context === undefined || context === null) throw new TenantContextRequiredError();
    if (!isWellFormedTrustedTenantContext(context)) throw new TenantContextInvalidError();
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) => key !== 'featureKey' && key !== 'resourceKey' && key !== 'currentUsage',
      ) ||
      typeof input.featureKey !== 'string' ||
      typeof input.resourceKey !== 'string' ||
      typeof input.currentUsage !== 'number' ||
      !Number.isSafeInteger(input.currentUsage) ||
      input.currentUsage < 0 ||
      !isPlanFeatureQuotaResourceKey(input.resourceKey)
    ) {
      throw new TenantQuotaInputInvalidError();
    }

    const resourceKey = input.resourceKey;
    if (!isTenantFeatureKey(input.featureKey)) {
      return { outcome: 'NOT_ENTITLED', resourceKey };
    }

    const entitlement = await this.entitlements.resolve(context, input.featureKey);
    if (entitlement.outcome !== 'ENTITLED') {
      return this.fromEntitlementDenial(entitlement, resourceKey);
    }

    const configuration = await this.quotas.findActivePlanFeatureQuotaLimits(
      entitlement.planId,
      entitlement.featureId,
    );
    if (configuration.kind !== 'ready') {
      return { outcome: 'NOT_ENTITLED', resourceKey };
    }
    if (configuration.quotaLimits === null) {
      return { outcome: 'NO_LIMIT_CONFIGURED', resourceKey };
    }

    const parsedLimits = planFeatureQuotaLimitsSchema.safeParse(configuration.quotaLimits);
    if (!parsedLimits.success) {
      return { outcome: 'INVALID_CONFIGURATION', resourceKey };
    }

    const limit = parsedLimits.data[resourceKey];
    if (!limit) return { outcome: 'NO_LIMIT_CONFIGURED', resourceKey };
    if (limit.type === 'UNLIMITED') {
      return { outcome: 'AVAILABLE', resourceKey, limitType: 'UNLIMITED' };
    }
    if (input.currentUsage >= limit.max) {
      return { outcome: 'EXCEEDED', resourceKey };
    }
    return { outcome: 'AVAILABLE', resourceKey, limitType: 'COUNT' };
  }

  private fromEntitlementDenial(
    decision: Extract<TenantEntitlementDecision, { outcome: 'NOT_ENTITLED' }>,
    resourceKey: PlanFeatureQuotaResourceKey,
  ): TenantQuotaDecision {
    if (decision.reason === 'NOT_ENTITLED_NO_SUBSCRIPTION') {
      return { outcome: 'NO_SUBSCRIPTION', resourceKey };
    }
    return { outcome: 'NOT_ENTITLED', resourceKey };
  }
}
