import { Injectable } from '@nestjs/common';
import { BranchStatus, FacilityStatus, Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  BranchFacilityScope as BranchFacilityScopeContract,
  BranchListFilter as BranchListFilterContract,
  BranchPersistencePort,
  BranchRecord as BranchRecordContract,
} from '../persistence/platform-persistence.ports';

const branchSelect = {
  id: true,
  facilityId: true,
  name: true,
  status: true,
  statusChangedAt: true,
  suspendedAt: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BranchSelect;

const branchFacilityScopeSelect = {
  id: true,
  status: true,
  tenant: { select: { status: true } },
} satisfies Prisma.FacilitySelect;

export type BranchRecord = BranchRecordContract;
export type BranchFacilityScope = BranchFacilityScopeContract;
export type BranchListFilter = BranchListFilterContract;

function activeFacilityRelation(
  tenantId: string,
  facilityId: string,
): Prisma.BranchWhereInput['facility'] {
  return {
    is: {
      id: facilityId,
      tenantId,
      status: FacilityStatus.ACTIVE,
      tenant: { is: { status: TenantStatus.ACTIVE } },
    },
  };
}

@Injectable()
export class BranchRepository implements BranchPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  findFacilityScope(tenantId: string, facilityId: string): Promise<BranchFacilityScope | null> {
    return this.prisma.facility.findFirst({
      where: { id: facilityId, tenantId },
      select: branchFacilityScopeSelect,
    });
  }

  async createUnderActiveFacility(
    tenantId: string,
    facilityId: string,
    input: { name: string },
  ): Promise<BranchRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const activeParents = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT \`facility\`.\`id\`
          FROM \`Facility\` AS \`facility\`
          INNER JOIN \`Tenant\` AS \`tenant\`
            ON \`tenant\`.\`id\` = \`facility\`.\`tenantId\`
          WHERE \`facility\`.\`id\` = ${facilityId}
            AND \`facility\`.\`tenantId\` = ${tenantId}
            AND \`facility\`.\`status\` = 'ACTIVE'
            AND \`tenant\`.\`status\` = 'ACTIVE'
          FOR UPDATE
        `,
      );
      if (activeParents.length !== 1) return null;

      return transaction.branch.create({
        data: { facilityId: activeParents[0].id, name: input.name },
        select: branchSelect,
      });
    });
  }

  listForFacility(
    tenantId: string,
    facilityId: string,
    filter: BranchListFilter,
  ): Promise<BranchRecord[]> {
    return this.prisma.branch.findMany({
      where: {
        facilityId,
        facility: activeFacilityRelation(tenantId, facilityId),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.offset,
      take: filter.limit,
      select: branchSelect,
    });
  }

  findByIdWithinFacility(
    tenantId: string,
    facilityId: string,
    branchId: string,
  ): Promise<BranchRecord | null> {
    return this.prisma.branch.findFirst({
      where: {
        id: branchId,
        facilityId,
        facility: activeFacilityRelation(tenantId, facilityId),
      },
      select: branchSelect,
    });
  }

  async updateNameWithinFacility(
    tenantId: string,
    facilityId: string,
    branchId: string,
    name: string,
  ): Promise<BranchRecord | null> {
    const result = await this.prisma.branch.updateMany({
      where: {
        id: branchId,
        facilityId,
        facility: activeFacilityRelation(tenantId, facilityId),
      },
      data: { name },
    });
    if (result.count !== 1) return null;
    return this.findByIdWithinFacility(tenantId, facilityId, branchId);
  }

  async changeStatusIfCurrentWithinFacility(
    tenantId: string,
    facilityId: string,
    branchId: string,
    expectedStatus: BranchStatus,
    nextStatus: BranchStatus,
    changedAt: Date,
  ): Promise<BranchRecord | null> {
    const result = await this.prisma.branch.updateMany({
      where: {
        id: branchId,
        facilityId,
        status: expectedStatus,
        facility: activeFacilityRelation(tenantId, facilityId),
      },
      data: {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
        ...(nextStatus === BranchStatus.SUSPENDED ? { suspendedAt: changedAt } : {}),
        ...(nextStatus === BranchStatus.DEACTIVATED ? { deactivatedAt: changedAt } : {}),
      },
    });
    if (result.count !== 1) return null;
    return this.findByIdWithinFacility(tenantId, facilityId, branchId);
  }
}
