import { Injectable } from '@nestjs/common';
import { Prisma, StaffStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateTenantStaffResult as CreateTenantStaffResultContract,
  TenantStaffListFilter as TenantStaffListFilterContract,
  TenantStaffPersistencePort,
  TenantStaffRecord as TenantStaffRecordContract,
} from '../persistence/platform-persistence.ports';

const staffSelect = {
  id: true,
  tenantId: true,
  userId: true,
  membershipId: true,
  displayName: true,
  jobTitle: true,
  status: true,
  statusChangedAt: true,
  suspendedAt: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StaffSelect;

export type TenantStaffRecord = TenantStaffRecordContract;
export type TenantStaffListFilter = TenantStaffListFilterContract;
export type CreateTenantStaffResult = CreateTenantStaffResultContract;

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function activeTenantRelation(): Prisma.StaffWhereInput['tenant'] {
  return { is: { status: TenantStatus.ACTIVE } };
}

@Injectable()
export class TenantStaffRepository implements TenantStaffPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async createForActiveMembership(
    tenantId: string,
    membershipId: string,
    input: { displayName?: string; jobTitle?: string },
  ): Promise<CreateTenantStaffResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const activeTenant = await transaction.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            SELECT \`id\`
            FROM \`Tenant\`
            WHERE \`id\` = ${tenantId}
              AND \`status\` = 'ACTIVE'
            FOR UPDATE
          `,
        );
        if (activeTenant.length !== 1) return { kind: 'tenant-unavailable' };

        const eligibleMembership = await transaction.$queryRaw<
          Array<{ id: string; platformUserId: string; fullName: string }>
        >(
          Prisma.sql`
            SELECT
              \`membership\`.\`id\` AS \`id\`,
              \`membership\`.\`platformUserId\` AS \`platformUserId\`,
              \`platformUser\`.\`fullName\` AS \`fullName\`
            FROM \`TenantMembership\` AS \`membership\`
            INNER JOIN \`User\` AS \`platformUser\`
              ON \`platformUser\`.\`id\` = \`membership\`.\`platformUserId\`
            WHERE \`membership\`.\`id\` = ${membershipId}
              AND \`membership\`.\`tenantId\` = ${tenantId}
              AND \`membership\`.\`status\` = 'ACTIVE'
              AND \`platformUser\`.\`status\` = 'ACTIVE'
            FOR UPDATE
          `,
        );
        const member = eligibleMembership[0];
        if (!member) return { kind: 'membership-ineligible' };

        const existing = await transaction.staff.findUnique({
          where: {
            tenantId_userId: {
              tenantId,
              userId: member.platformUserId,
            },
          },
          select: { id: true },
        });
        if (existing) return { kind: 'already-exists' };

        const staff = await transaction.staff.create({
          data: {
            tenantId,
            userId: member.platformUserId,
            membershipId: member.id,
            displayName: input.displayName ?? member.fullName,
            ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
          },
          select: staffSelect,
        });
        return { kind: 'created', staff };
      });
    } catch (error) {
      if (isUniqueConflict(error)) return { kind: 'already-exists' };
      throw error;
    }
  }

  listForTenant(tenantId: string, filter: TenantStaffListFilter): Promise<TenantStaffRecord[]> {
    return this.prisma.staff.findMany({
      where: {
        tenantId,
        tenant: activeTenantRelation(),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.offset,
      take: filter.limit,
      select: staffSelect,
    });
  }

  findByIdForTenant(tenantId: string, id: string): Promise<TenantStaffRecord | null> {
    return this.prisma.staff.findFirst({
      where: { id, tenantId, tenant: activeTenantRelation() },
      select: staffSelect,
    });
  }

  async updateForTenant(
    tenantId: string,
    id: string,
    input: { displayName?: string; jobTitle?: string | null },
  ): Promise<TenantStaffRecord | null> {
    const result = await this.prisma.staff.updateMany({
      where: { id, tenantId, tenant: activeTenantRelation() },
      data: input,
    });
    if (result.count !== 1) return null;
    return this.findByIdForTenant(tenantId, id);
  }

  async changeStatusIfCurrentForTenant(
    tenantId: string,
    id: string,
    expectedStatus: StaffStatus,
    nextStatus: StaffStatus,
    changedAt: Date,
  ): Promise<TenantStaffRecord | null> {
    const result = await this.prisma.staff.updateMany({
      where: {
        id,
        tenantId,
        status: expectedStatus,
        tenant: activeTenantRelation(),
      },
      data: {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
        ...(nextStatus === StaffStatus.SUSPENDED ? { suspendedAt: changedAt } : {}),
        ...(nextStatus === StaffStatus.DEACTIVATED ? { deactivatedAt: changedAt } : {}),
      },
    });
    if (result.count !== 1) return null;
    return this.findByIdForTenant(tenantId, id);
  }
}
