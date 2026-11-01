import { Injectable } from '@nestjs/common';
import { FeatureStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { FeaturePersistencePort } from '../persistence/platform-persistence.ports';
import type { FeatureListFilter, FeatureRecord } from '../persistence/platform-persistence.ports';

export type { FeatureListFilter, FeatureRecord } from '../persistence/platform-persistence.ports';

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

@Injectable()
export class FeatureRepository implements FeaturePersistencePort {
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
