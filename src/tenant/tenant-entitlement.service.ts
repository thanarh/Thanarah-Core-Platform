import { Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { SubscriptionService } from '../subscriptions/subscription.service';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  isWellFormedTrustedTenantContext,
  type TrustedTenantContext,
} from './tenant-context.contract';
import { TenantFeatureNotIncludedError } from './tenant-entitlement.errors';
import { isTenantFeatureKey } from './tenant-require-feature.decorator';
import { TenantEntitlementRepository } from './tenant-entitlement.repository';

export type TenantEntitlementDenialReason =
  | 'NOT_ENTITLED_NO_SUBSCRIPTION'
  | 'NOT_ENTITLED_SUBSCRIPTION_STATUS'
  | 'NOT_ENTITLED_PLAN'
  | 'NOT_ENTITLED_FEATURE'
  | 'NOT_ENTITLED_PLAN_FEATURE';

export type TenantEntitlementDecision =
  | {
      outcome: 'ENTITLED';
      entitled: true;
      featureKey: string;
      subscriptionId: string;
      planId: string;
      featureId: string;
    }
  | {
      outcome: 'NOT_ENTITLED';
      entitled: false;
      reason: TenantEntitlementDenialReason;
      featureKey: string;
    };

@Injectable()
export class TenantEntitlementService {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly entitlements: TenantEntitlementRepository,
  ) {}

  async resolve(
    context: TrustedTenantContext | undefined,
    featureKey: string,
  ): Promise<TenantEntitlementDecision> {
    if (context === undefined || context === null) throw new TenantContextRequiredError();
    if (!isWellFormedTrustedTenantContext(context)) throw new TenantContextInvalidError();
    if (!isTenantFeatureKey(featureKey)) {
      return this.denied('NOT_ENTITLED_FEATURE', String(featureKey));
    }

    const current = await this.subscriptions.findCurrentForTenant(context.tenantId);
    if (!current) return this.denied('NOT_ENTITLED_NO_SUBSCRIPTION', featureKey);
    if (current.tenantId.toLowerCase() !== context.tenantId.toLowerCase()) {
      return this.denied('NOT_ENTITLED_NO_SUBSCRIPTION', featureKey);
    }
    if (
      current.status !== SubscriptionStatus.ACTIVE ||
      current.effectiveStatus !== SubscriptionStatus.ACTIVE
    ) {
      return this.denied('NOT_ENTITLED_SUBSCRIPTION_STATUS', featureKey);
    }

    const lookup = await this.entitlements.resolveFeatureOnPlan(current.planId, featureKey);
    if (lookup.kind === 'plan-not-found' || lookup.kind === 'plan-unavailable') {
      return this.denied('NOT_ENTITLED_PLAN', featureKey);
    }
    if (lookup.kind === 'feature-not-found' || lookup.kind === 'feature-unavailable') {
      return this.denied('NOT_ENTITLED_FEATURE', featureKey);
    }
    if (lookup.kind !== 'entitled') {
      return this.denied('NOT_ENTITLED_PLAN_FEATURE', featureKey);
    }

    return {
      outcome: 'ENTITLED',
      entitled: true,
      featureKey,
      subscriptionId: current.id,
      planId: current.planId,
      featureId: lookup.featureId,
    };
  }

  async requireFeature(
    context: TrustedTenantContext | undefined,
    featureKey: string,
  ): Promise<void> {
    const decision = await this.resolve(context, featureKey);
    if (!decision.entitled) throw new TenantFeatureNotIncludedError();
  }

  private denied(
    reason: TenantEntitlementDenialReason,
    featureKey: string,
  ): TenantEntitlementDecision {
    return { outcome: 'NOT_ENTITLED', entitled: false, reason, featureKey };
  }
}
