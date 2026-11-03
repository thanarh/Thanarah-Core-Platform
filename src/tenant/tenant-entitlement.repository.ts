import { Injectable } from '@nestjs/common';
import { FeatureStatus, PlanStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  PlanFeatureEntitlementLookup as PlanFeatureEntitlementLookupContract,
  TenantEntitlementPersistencePort,
} from '../persistence/platform-persistence.ports';

export type PlanFeatureEntitlementLookup = PlanFeatureEntitlementLookupContract;

@Injectable()
export class TenantEntitlementRepository implements TenantEntitlementPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async resolveFeatureOnPlan(
    planId: string,
    featureKey: string,
  ): Promise<PlanFeatureEntitlementLookup> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: {
        status: true,
        features: {
          where: { feature: { key: featureKey } },
          take: 2,
          select: {
            enabled: true,
            feature: {
              select: { id: true, status: true },
            },
          },
        },
      } satisfies Prisma.PlanSelect,
    });

    if (!plan) return { kind: 'plan-not-found' };
    if (plan.status !== PlanStatus.ACTIVE) return { kind: 'plan-unavailable' };
    if (plan.features.length > 1) return { kind: 'plan-feature-ambiguous' };

    const planFeature = plan.features[0];
    if (!planFeature) {
      const feature = await this.prisma.feature.findUnique({
        where: { key: featureKey },
        select: { status: true },
      });
      if (!feature) return { kind: 'feature-not-found' };
      if (feature.status !== FeatureStatus.ACTIVE) return { kind: 'feature-unavailable' };
      return { kind: 'plan-feature-missing' };
    }

    if (planFeature.feature.status !== FeatureStatus.ACTIVE) {
      return { kind: 'feature-unavailable' };
    }
    if (!planFeature.enabled) return { kind: 'plan-feature-disabled' };
    return { kind: 'entitled', featureId: planFeature.feature.id };
  }
}
