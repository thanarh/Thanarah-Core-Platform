import { Injectable } from '@nestjs/common';
import { Prisma, PlanStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const planSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  status: true,
  statusChangedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PlanSelect;

const planFeatureSelect = {
  planId: true,
  featureId: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
  feature: {
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      status: true,
      statusChangedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.PlanFeatureSelect;

export type PlanRecord = Prisma.PlanGetPayload<{ select: typeof planSelect }>;
export type PlanFeatureRecord = Prisma.PlanFeatureGetPayload<{
  select: typeof planFeatureSelect;
}>;

export interface PlanListFilter {
  status?: PlanStatus;
  limit: number;
  offset: number;
}

@Injectable()
export class PlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: { key: string; name: string; description?: string }): Promise<PlanRecord> {
    return this.prisma.plan.create({ data: input, select: planSelect });
  }

  findById(id: string): Promise<PlanRecord | null> {
    return this.prisma.plan.findUnique({ where: { id }, select: planSelect });
  }

  findByKey(key: string): Promise<PlanRecord | null> {
    return this.prisma.plan.findUnique({ where: { key }, select: planSelect });
  }

  list(filter: PlanListFilter): Promise<PlanRecord[]> {
    return this.prisma.plan.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.offset,
      take: filter.limit,
      select: planSelect,
    });
  }

  async updateIfCurrentStatus(
    id: string,
    expectedStatus: PlanStatus,
    input: { name?: string; description?: string | null },
  ): Promise<PlanRecord | null> {
    const result = await this.prisma.plan.updateMany({
      where: { id, status: expectedStatus },
      data: input,
    });
    return result.count === 1 ? this.findById(id) : null;
  }

  async changeStatusIfCurrent(
    id: string,
    expectedStatus: PlanStatus,
    nextStatus: PlanStatus,
    changedAt: Date,
  ): Promise<PlanRecord | null> {
    const result = await this.prisma.plan.updateMany({
      where: { id, status: expectedStatus },
      data: { status: nextStatus, statusChangedAt: changedAt },
    });
    return result.count === 1 ? this.findById(id) : null;
  }

  findPlanFeature(planId: string, featureId: string): Promise<PlanFeatureRecord | null> {
    return this.prisma.planFeature.findUnique({
      where: { planId_featureId: { planId, featureId } },
      select: planFeatureSelect,
    });
  }

  listFeatures(planId: string): Promise<PlanFeatureRecord[]> {
    return this.prisma.planFeature.findMany({
      where: { planId },
      orderBy: [{ createdAt: 'asc' }, { featureId: 'asc' }],
      select: planFeatureSelect,
    });
  }

  attachFeature(planId: string, featureId: string): Promise<PlanFeatureRecord> {
    return this.prisma.planFeature.create({
      data: { planId, featureId },
      select: planFeatureSelect,
    });
  }

  async updateFeatureEnabled(
    planId: string,
    featureId: string,
    enabled: boolean,
  ): Promise<PlanFeatureRecord | null> {
    const result = await this.prisma.planFeature.updateMany({
      where: { planId, featureId },
      data: { enabled },
    });
    return result.count === 1 ? this.findPlanFeature(planId, featureId) : null;
  }

  async detachFeature(planId: string, featureId: string): Promise<boolean> {
    const result = await this.prisma.planFeature.deleteMany({ where: { planId, featureId } });
    return result.count === 1;
  }
}
