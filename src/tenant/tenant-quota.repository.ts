import { Injectable } from '@nestjs/common';
import { FeatureStatus, PlanStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  TenantQuotaPersistencePort,
  TenantQuotaPlanFeatureLookup as TenantQuotaPlanFeatureLookupContract,
} from '../persistence/platform-persistence.ports';

export type TenantQuotaPlanFeatureLookup = TenantQuotaPlanFeatureLookupContract;

@Injectable()
export class TenantQuotaRepository implements TenantQuotaPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async findActivePlanFeatureQuotaLimits(
    planId: string,
    featureId: string,
  ): Promise<TenantQuotaPlanFeatureLookup> {
    const association = await this.prisma.planFeature.findUnique({
      where: { planId_featureId: { planId, featureId } },
      select: {
        enabled: true,
        quotaLimits: true,
        plan: { select: { status: true } },
        feature: { select: { status: true } },
      } satisfies Prisma.PlanFeatureSelect,
    });

    if (
      !association ||
      !association.enabled ||
      association.plan.status !== PlanStatus.ACTIVE ||
      association.feature.status !== FeatureStatus.ACTIVE
    ) {
      return { kind: 'unavailable' };
    }

    return { kind: 'ready', quotaLimits: association.quotaLimits };
  }
}
