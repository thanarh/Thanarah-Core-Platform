import { Injectable } from '@nestjs/common';
import { Prisma, StaffStatus, TenantMembershipStatus, TenantStatus } from '@prisma/client';
import type { TrustedTenantContext } from './tenant-context.contract';
import { PrismaService } from '../database/prisma.service';
import { tenantRoleSelect, type TenantRoleRecord } from './tenant-role.repository';

export type TenantMembershipRoleAssignmentResult =
  | { kind: 'changed'; platformUserId: string; roleCode: string }
  | { kind: 'already-assigned'; platformUserId: string; roleCode: string }
  | { kind: 'not-found' }
  | { kind: 'self-assignment' }
  | { kind: 'owner-only' };

export type TenantMembershipRoleRemovalResult =
  | { kind: 'changed'; platformUserId: string; roleCode: string }
  | { kind: 'not-found' }
  | { kind: 'owner-protected' }
  | { kind: 'not-assigned' };

export type TenantMembershipRoleRecord = {
  assignedAt: Date;
  role: TenantRoleRecord;
};

@Injectable()
export class TenantMembershipRoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async resolvePermissionCodes(context: TrustedTenantContext): Promise<string[]> {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        id: context.membershipId,
        tenantId: context.tenantId,
        platformUserId: context.platformUserId,
        status: TenantMembershipStatus.ACTIVE,
        tenant: { is: { status: TenantStatus.ACTIVE } },
      },
      select: {
        roleAssignments: {
          select: {
            role: {
              select: {
                permissions: {
                  select: { permission: { select: { code: true } } },
                },
              },
            },
          },
        },
        staffProfile: {
          select: {
            status: true,
            roleAssignments: {
              select: {
                role: {
                  select: {
                    permissions: {
                      select: { permission: { select: { code: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!membership) return [];
    if (membership.staffProfile && membership.staffProfile.status !== StaffStatus.ACTIVE) return [];

    return [
      ...new Set(
        membership.roleAssignments
          .flatMap((assignment) =>
            assignment.role.permissions.map(({ permission }) => permission.code),
          )
          .concat(
            (membership.staffProfile?.roleAssignments ?? []).flatMap((assignment) =>
              assignment.role.permissions.map(({ permission }) => permission.code),
            ),
          ),
      ),
    ];
  }

  async hasRoleCode(tenantId: string, membershipId: string, roleCode: string): Promise<boolean> {
    const membershipAssignment = await this.prisma.tenantMembershipRole.findFirst({
      where: {
        tenantId,
        membershipId,
        role: { is: { code: roleCode } },
        membership: {
          is: {
            status: TenantMembershipStatus.ACTIVE,
            tenant: { is: { status: TenantStatus.ACTIVE } },
          },
        },
      },
      select: { membershipId: true },
    });
    if (membershipAssignment) return true;

    const staffAssignment = await this.prisma.staffRoleAssignment.findFirst({
      where: {
        tenantId,
        staff: {
          is: {
            membershipId,
            status: StaffStatus.ACTIVE,
            membership: {
              is: {
                status: TenantMembershipStatus.ACTIVE,
                tenant: { is: { status: TenantStatus.ACTIVE } },
              },
            },
          },
        },
        role: { is: { code: roleCode } },
      },
      select: { staffId: true },
    });
    return staffAssignment !== null;
  }

  async listForMembership(
    tenantId: string,
    membershipId: string,
  ): Promise<TenantMembershipRoleRecord[] | null> {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
      select: { id: true },
    });
    if (!membership) return null;

    const assignments = await this.prisma.tenantMembershipRole.findMany({
      where: { tenantId, membershipId },
      orderBy: { assignedAt: 'asc' },
      select: {
        assignedAt: true,
        role: { select: tenantRoleSelect },
      },
    });
    return assignments;
  }

  async assign(input: {
    tenantId: string;
    actorMembershipId: string;
    actorPlatformUserId: string;
    targetMembershipId: string;
    roleId: string;
  }): Promise<TenantMembershipRoleAssignmentResult> {
    return this.prisma.$transaction(async (transaction) => {
      const tenantExists = await this.lockActiveTenant(transaction, input.tenantId);
      if (!tenantExists) return { kind: 'not-found' };

      const actorMembership = await transaction.tenantMembership.findFirst({
        where: {
          id: input.actorMembershipId,
          tenantId: input.tenantId,
          platformUserId: input.actorPlatformUserId,
          status: TenantMembershipStatus.ACTIVE,
        },
        select: { id: true },
      });
      const targetMembership = await transaction.tenantMembership.findFirst({
        where: {
          id: input.targetMembershipId,
          tenantId: input.tenantId,
          status: TenantMembershipStatus.ACTIVE,
        },
        select: { id: true, platformUserId: true },
      });
      const role = await transaction.tenantRole.findFirst({
        where: { id: input.roleId, tenantId: input.tenantId },
        select: { id: true, code: true },
      });
      if (!actorMembership || !targetMembership || !role) return { kind: 'not-found' };
      if (
        targetMembership.platformUserId.toLowerCase() === input.actorPlatformUserId.toLowerCase()
      ) {
        return { kind: 'self-assignment' };
      }

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

      const existing = await transaction.tenantMembershipRole.findUnique({
        where: {
          membershipId_tenantRoleId: {
            membershipId: input.targetMembershipId,
            tenantRoleId: input.roleId,
          },
        },
        select: { membershipId: true },
      });
      await transaction.tenantMembershipRole.upsert({
        where: {
          membershipId_tenantRoleId: {
            membershipId: input.targetMembershipId,
            tenantRoleId: input.roleId,
          },
        },
        create: {
          tenantId: input.tenantId,
          membershipId: input.targetMembershipId,
          tenantRoleId: input.roleId,
        },
        update: {},
      });

      return {
        kind: existing ? 'already-assigned' : 'changed',
        platformUserId: targetMembership.platformUserId,
        roleCode: role.code,
      };
    });
  }

  async remove(input: {
    tenantId: string;
    membershipId: string;
    roleId: string;
  }): Promise<TenantMembershipRoleRemovalResult> {
    return this.prisma.$transaction(async (transaction) => {
      const tenantExists = await this.lockActiveTenant(transaction, input.tenantId);
      if (!tenantExists) return { kind: 'not-found' };

      const membership = await transaction.tenantMembership.findFirst({
        where: { id: input.membershipId, tenantId: input.tenantId },
        select: { platformUserId: true },
      });
      const role = await transaction.tenantRole.findFirst({
        where: { id: input.roleId, tenantId: input.tenantId },
        select: { id: true, code: true },
      });
      if (!membership || !role) return { kind: 'not-found' };
      if (role.code === 'OWNER') return { kind: 'owner-protected' };

      const result = await transaction.tenantMembershipRole.deleteMany({
        where: {
          tenantId: input.tenantId,
          membershipId: input.membershipId,
          tenantRoleId: input.roleId,
        },
      });
      if (result.count !== 1) return { kind: 'not-assigned' };
      return {
        kind: 'changed',
        platformUserId: membership.platformUserId,
        roleCode: role.code,
      };
    });
  }

  private async lockActiveTenant(
    transaction: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT \`id\` FROM \`Tenant\` WHERE \`id\` = ${tenantId} FOR UPDATE`,
    );
    if (rows.length === 0) return false;
    const tenant = await transaction.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    return tenant?.status === TenantStatus.ACTIVE;
  }
}
