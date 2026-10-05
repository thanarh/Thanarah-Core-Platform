import { Injectable } from '@nestjs/common';
import { FeatureStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const featureSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  status: true,
  statusChangedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FeatureSelect;

export type FeatureRecord = Prisma.FeatureGetPayload<{ select: typeof featureSelect }>;

export interface FeatureListFilter {
  status?: FeatureStatus;
  limit: number;
  offset: number;
}

@Injectable()
export class FeatureRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: { key: string; name: string; description?: string }): Promise<FeatureRecord> {
    return this.prisma.feature.create({ data: input, select: featureSelect });
  }

  findById(id: string): Promise<FeatureRecord | null> {
    return this.prisma.feature.findUnique({ where: { id }, select: featureSelect });
  }

  findByKey(key: string): Promise<FeatureRecord | null> {
    return this.prisma.feature.findUnique({ where: { key }, select: featureSelect });
  }

  list(filter: FeatureListFilter): Promise<FeatureRecord[]> {
    return this.prisma.feature.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.offset,
      take: filter.limit,
      select: featureSelect,
    });
  }

  async updateIfCurrentStatus(
    id: string,
    expectedStatus: FeatureStatus,
    input: { name?: string; description?: string | null },
  ): Promise<FeatureRecord | null> {
    const result = await this.prisma.feature.updateMany({
      where: { id, status: expectedStatus },
      data: input,
    });
    return result.count === 1 ? this.findById(id) : null;
  }

  async changeStatusIfCurrent(
    id: string,
    expectedStatus: FeatureStatus,
    nextStatus: FeatureStatus,
    changedAt: Date,
  ): Promise<FeatureRecord | null> {
    const result = await this.prisma.feature.updateMany({
      where: { id, status: expectedStatus },
      data: { status: nextStatus, statusChangedAt: changedAt },
    });
    return result.count === 1 ? this.findById(id) : null;
  }
}
