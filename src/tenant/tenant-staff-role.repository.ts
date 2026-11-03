import { Injectable } from '@nestjs/common';
import { Prisma, StaffStatus, TenantMembershipStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  AssignTenantStaffRoleResult as AssignTenantStaffRoleResultContract,
  RemoveTenantStaffRoleResult as RemoveTenantStaffRoleResultContract,
  TenantStaffRoleAssignmentRecord as TenantStaffRoleAssignmentRecordContract,
  TenantStaffRolePersistencePort,
} from '../persistence/platform-persistence.ports';

const staffRoleAssignmentSelect = {
  tenantId: true,
  staffId: true,
  tenantRoleId: true,
  assignedAt: true,
  staff: { select: { userId: true } },
  role: {
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      isSystemRole: true,
    },
  },
} satisfies Prisma.StaffRoleAssignmentSelect;

export type TenantStaffRoleAssignmentRecord = TenantStaffRoleAssignmentRecordContract;
export type AssignTenantStaffRoleResult = AssignTenantStaffRoleResultContract;
export type RemoveTenantStaffRoleResult = RemoveTenantStaffRoleResultContract;

function activeTenantRelation(): Prisma.StaffWhereInput['tenant'] {
  return { is: { status: TenantStatus.ACTIVE } };
}

@Injectable()
export class TenantStaffRoleRepository implements TenantStaffRolePersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async listForStaff(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffRoleAssignmentRecord[] | null> {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, tenantId, tenant: activeTenantRelation() },
      select: { id: true },
    });
    if (!staff) return null;

    return this.prisma.staffRoleAssignment.findMany({
      where: { tenantId, staffId },
      orderBy: [{ assignedAt: 'asc' }, { tenantRoleId: 'asc' }],
      select: staffRoleAssignmentSelect,
    });
  }

  async assign(input: {
    tenantId: string;
    actorMembershipId: string;
    actorPlatformUserId: string;
    staffId: string;
    roleId: string;
  }): Promise<AssignTenantStaffRoleResult> {
    return this.prisma.$transaction(async (transaction) => {
      const activeTenant = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT \`id\`
          FROM \`Tenant\`
          WHERE \`id\` = ${input.tenantId}
            AND \`status\` = 'ACTIVE'
          FOR UPDATE
        `,
      );
      if (activeTenant.length !== 1) return { kind: 'not-found' };

      const actorMembership = await transaction.tenantMembership.findFirst({
        where: {
          id: input.actorMembershipId,
          tenantId: input.tenantId,
          platformUserId: input.actorPlatformUserId,
          status: TenantMembershipStatus.ACTIVE,
          tenant: { is: { status: TenantStatus.ACTIVE } },
        },
        select: { id: true },
      });
      if (!actorMembership) return { kind: 'not-found' };

      const staffRows = await transaction.$queryRaw<
        Array<{
          id: string;
          userId: string;
          staffStatus: string;
          membershipStatus: string;
          userStatus: string;
        }>
      >(
        Prisma.sql`
          SELECT
            \`staff\`.\`id\` AS \`id\`,
            \`staff\`.\`userId\` AS \`userId\`,
            \`staff\`.\`status\` AS \`staffStatus\`,
            \`membership\`.\`status\` AS \`membershipStatus\`,
            \`platformUser\`.\`status\` AS \`userStatus\`
          FROM \`Staff\` AS \`staff\`
          INNER JOIN \`TenantMembership\` AS \`membership\`
            ON \`membership\`.\`id\` = \`staff\`.\`membershipId\`
            AND \`membership\`.\`tenantId\` = \`staff\`.\`tenantId\`
            AND \`membership\`.\`platformUserId\` = \`staff\`.\`userId\`
          INNER JOIN \`User\` AS \`platformUser\`
            ON \`platformUser\`.\`id\` = \`staff\`.\`userId\`
          WHERE \`staff\`.\`id\` = ${input.staffId}
            AND \`staff\`.\`tenantId\` = ${input.tenantId}
          FOR UPDATE
        `,
      );
      const staff = staffRows[0];
      if (!staff) return { kind: 'not-found' };
      if (
        staff.staffStatus !== StaffStatus.ACTIVE ||
        staff.membershipStatus !== TenantMembershipStatus.ACTIVE ||
        staff.userStatus !== 'ACTIVE'
      ) {
        return { kind: 'staff-ineligible' };
      }
      if (staff.userId.toLowerCase() === input.actorPlatformUserId.toLowerCase()) {
        return { kind: 'self-assignment' };
      }

      const role = await transaction.tenantRole.findFirst({
        where: { id: input.roleId, tenantId: input.tenantId },
        select: { id: true, code: true },
      });
      if (!role) return { kind: 'not-found' };

      if (role.code === 'OWNER') {
        const actorMembershipOwner = await transaction.tenantMembershipRole.findFirst({
          where: {
            tenantId: input.tenantId,
            membershipId: input.actorMembershipId,
            role: { is: { code: 'OWNER' } },
            membership: {
              is: {
                platformUserId: input.actorPlatformUserId,
                status: TenantMembershipStatus.ACTIVE,
                tenant: { is: { status: TenantStatus.ACTIVE } },
              },
            },
          },
          select: { membershipId: true },
        });
        const actorStaffOwner = actorMembershipOwner
          ? null
          : await transaction.staffRoleAssignment.findFirst({
              where: {
                tenantId: input.tenantId,
                staff: {
                  is: {
                    membershipId: input.actorMembershipId,
                    userId: input.actorPlatformUserId,
                    status: StaffStatus.ACTIVE,
                    membership: {
                      is: {
                        status: TenantMembershipStatus.ACTIVE,
                        tenant: { is: { status: TenantStatus.ACTIVE } },
                      },
                    },
                  },
                },
                role: { is: { code: 'OWNER' } },
              },
              select: { staffId: true },
            });
        if (!actorMembershipOwner && !actorStaffOwner) return { kind: 'owner-only' };
      }

      const where = {
        staffId_tenantRoleId: { staffId: input.staffId, tenantRoleId: input.roleId },
      };
      const existing = await transaction.staffRoleAssignment.findUnique({
        where,
        select: { staffId: true },
      });
      const assignment = await transaction.staffRoleAssignment.upsert({
        where,
        create: {
          tenantId: input.tenantId,
          staffId: input.staffId,
          tenantRoleId: input.roleId,
        },
        update: {},
        select: staffRoleAssignmentSelect,
      });

      return {
        kind: existing ? 'already-assigned' : 'changed',
        assignment,
      };
    });
  }

  async remove(input: {
    tenantId: string;
    actorMembershipId: string;
    actorPlatformUserId: string;
    staffId: string;
    roleId: string;
  }): Promise<RemoveTenantStaffRoleResult> {
    return this.prisma.$transaction(async (transaction) => {
      const activeTenant = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT \`id\`
          FROM \`Tenant\`
          WHERE \`id\` = ${input.tenantId}
            AND \`status\` = 'ACTIVE'
          FOR UPDATE
        `,
      );
      if (activeTenant.length !== 1) return { kind: 'not-found' };

      const actorMembership = await transaction.tenantMembership.findFirst({
        where: {
          id: input.actorMembershipId,
          tenantId: input.tenantId,
          platformUserId: input.actorPlatformUserId,
          status: TenantMembershipStatus.ACTIVE,
          tenant: { is: { status: TenantStatus.ACTIVE } },
        },
        select: { id: true },
      });
      if (!actorMembership) return { kind: 'actor-ineligible' };

      const staff = await transaction.staff.findFirst({
        where: { id: input.staffId, tenantId: input.tenantId },
        select: { id: true, userId: true },
      });
      const role = await transaction.tenantRole.findFirst({
        where: { id: input.roleId, tenantId: input.tenantId },
        select: { id: true, code: true },
      });
      if (!staff || !role) return { kind: 'not-found' };
      if (role.code === 'OWNER') return { kind: 'owner-protected' };

      const removed = await transaction.staffRoleAssignment.deleteMany({
        where: {
          tenantId: input.tenantId,
          staffId: input.staffId,
          tenantRoleId: input.roleId,
        },
      });
      if (removed.count !== 1) return { kind: 'not-assigned' };
      return {
        kind: 'changed',
        userId: staff.userId,
        roleCode: role.code,
      };
    });
  }
}
