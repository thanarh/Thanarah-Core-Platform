import { Injectable } from '@nestjs/common';
import { FeatureStatus, PlanStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type TenantQuotaPlanFeatureLookup =
  { kind: 'unavailable' } | { kind: 'ready'; quotaLimits: Prisma.JsonValue | null };

@Injectable()
export class TenantQuotaRepository {
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
