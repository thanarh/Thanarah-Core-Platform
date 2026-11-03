import { Injectable } from '@nestjs/common';
import { FacilityStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  FacilityListFilter as FacilityListFilterContract,
  FacilityPersistencePort,
  FacilityRecord as FacilityRecordContract,
} from '../persistence/platform-persistence.ports';

const facilitySelect = {
  id: true,
  tenantId: true,
  name: true,
  status: true,
  statusChangedAt: true,
  suspendedAt: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FacilitySelect;

export type FacilityRecord = FacilityRecordContract;
export type FacilityListFilter = FacilityListFilterContract;

@Injectable()
export class FacilityRepository implements FacilityPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, input: { name: string }): Promise<FacilityRecord> {
    return this.prisma.facility.create({
      data: { tenantId, name: input.name },
      select: facilitySelect,
    });
  }

  findById(tenantId: string, id: string): Promise<FacilityRecord | null> {
    return this.prisma.facility.findFirst({
      where: { tenantId, id },
      select: facilitySelect,
    });
  }

  listForTenant(tenantId: string, filter: FacilityListFilter): Promise<FacilityRecord[]> {
    return this.prisma.facility.findMany({
      where: {
        tenantId,
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.offset,
      take: filter.limit,
      select: facilitySelect,
    });
  }

  async updateName(tenantId: string, id: string, name: string): Promise<FacilityRecord | null> {
    const result = await this.prisma.facility.updateMany({
      where: { tenantId, id },
      data: { name },
    });
    if (result.count !== 1) return null;
    return this.findById(tenantId, id);
  }

  async changeStatusIfCurrent(
    tenantId: string,
    id: string,
    expectedStatus: FacilityStatus,
    nextStatus: FacilityStatus,
    changedAt: Date,
  ): Promise<FacilityRecord | null> {
    const result = await this.prisma.facility.updateMany({
      where: { tenantId, id, status: expectedStatus },
      data: {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
        ...(nextStatus === FacilityStatus.SUSPENDED ? { suspendedAt: changedAt } : {}),
        ...(nextStatus === FacilityStatus.DEACTIVATED ? { deactivatedAt: changedAt } : {}),
      },
    });
    if (result.count !== 1) return null;
    return this.findById(tenantId, id);
  }
}
