import { Injectable } from '@nestjs/common';
import {
  BranchStatus,
  FacilityStatus,
  Prisma,
  StaffStatus,
  TenantMembershipStatus,
  TenantStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const facilityAssignmentSelect = {
  staffId: true,
  facilityId: true,
  assignedAt: true,
  staff: { select: { userId: true } },
  facility: { select: { id: true, name: true, status: true } },
} satisfies Prisma.StaffFacilityAssignmentSelect;

const branchAssignmentSelect = {
  staffId: true,
  branchId: true,
  facilityId: true,
  assignedAt: true,
  staff: { select: { userId: true } },
  branch: { select: { id: true, name: true, status: true } },
  facility: { select: { id: true, name: true, status: true } },
} satisfies Prisma.StaffBranchAssignmentSelect;

export type TenantStaffFacilityAssignmentRecord = Prisma.StaffFacilityAssignmentGetPayload<{
  select: typeof facilityAssignmentSelect;
}>;

export type TenantStaffBranchAssignmentRecord = Prisma.StaffBranchAssignmentGetPayload<{
  select: typeof branchAssignmentSelect;
}>;

export type AssignTenantStaffScopeResult<T> =
  | { kind: 'changed'; assignment: T }
  | { kind: 'already-assigned'; assignment: T }
  | { kind: 'not-found' }
  | { kind: 'actor-ineligible' }
  | { kind: 'staff-ineligible' }
  | { kind: 'unit-ineligible' };

export type RemoveTenantStaffScopeResult =
  | { kind: 'changed'; userId: string }
  | { kind: 'not-found' }
  | { kind: 'actor-ineligible' }
  | { kind: 'not-assigned' };

export interface TenantStaffEffectiveScope {
  facilities: ReadonlyArray<{ id: string; name: string }>;
  branches: ReadonlyArray<{
    id: string;
    name: string;
    facilityId: string;
    facilityName: string;
  }>;
}

type AssignmentInput = {
  tenantId: string;
  actorMembershipId: string;
  actorPlatformUserId: string;
  staffId: string;
};

type EligibilityResult =
  | { kind: 'eligible'; userId: string }
  | { kind: 'not-found' | 'actor-ineligible' | 'staff-ineligible' };

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function activeTenantRelation(): Prisma.StaffWhereInput['tenant'] {
  return { is: { status: TenantStatus.ACTIVE } };
}

@Injectable()
export class TenantStaffScopeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listFacilitiesForStaff(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffFacilityAssignmentRecord[] | null> {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, tenantId, tenant: activeTenantRelation() },
      select: { id: true },
    });
    if (!staff) return null;

    return this.prisma.staffFacilityAssignment.findMany({
      where: { tenantId, staffId },
      orderBy: [{ assignedAt: 'asc' }, { facilityId: 'asc' }],
      select: facilityAssignmentSelect,
    });
  }

  async listBranchesForStaff(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffBranchAssignmentRecord[] | null> {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, tenantId, tenant: activeTenantRelation() },
      select: { id: true },
    });
    if (!staff) return null;

    return this.prisma.staffBranchAssignment.findMany({
      where: { tenantId, staffId },
      orderBy: [{ assignedAt: 'asc' }, { branchId: 'asc' }],
      select: branchAssignmentSelect,
    });
  }

  async assignFacility(
    input: AssignmentInput & { facilityId: string },
  ): Promise<AssignTenantStaffScopeResult<TenantStaffFacilityAssignmentRecord>> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const eligible = await this.checkMutationEligibility(transaction, input);
        if (eligible.kind !== 'eligible') return eligible;

        const facilityRows = await transaction.$queryRaw<Array<{ id: string; status: string }>>(
          Prisma.sql`
            SELECT \`facility\`.\`id\` AS \`id\`, \`facility\`.\`status\` AS \`status\`
            FROM \`Facility\` AS \`facility\`
            WHERE \`facility\`.\`id\` = ${input.facilityId}
              AND \`facility\`.\`tenantId\` = ${input.tenantId}
            FOR UPDATE
          `,
        );
        const facility = facilityRows[0];
        if (!facility) return { kind: 'not-found' };
        if (facility.status !== FacilityStatus.ACTIVE) return { kind: 'unit-ineligible' };

        const where = {
          staffId_facilityId: { staffId: input.staffId, facilityId: input.facilityId },
        };
        const existing = await transaction.staffFacilityAssignment.findUnique({
          where,
          select: facilityAssignmentSelect,
        });
        if (existing) return { kind: 'already-assigned', assignment: existing };

        const assignment = await transaction.staffFacilityAssignment.create({
          data: {
            tenantId: input.tenantId,
            staffId: input.staffId,
            facilityId: input.facilityId,
          },
          select: facilityAssignmentSelect,
        });
        return { kind: 'changed', assignment };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await this.prisma.staffFacilityAssignment.findFirst({
        where: {
          tenantId: input.tenantId,
          staffId: input.staffId,
          facilityId: input.facilityId,
        },
        select: facilityAssignmentSelect,
      });
      if (!existing) throw error;
      return { kind: 'already-assigned', assignment: existing };
    }
  }

  async assignBranch(
    input: AssignmentInput & { branchId: string },
  ): Promise<AssignTenantStaffScopeResult<TenantStaffBranchAssignmentRecord>> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const eligible = await this.checkMutationEligibility(transaction, input);
        if (eligible.kind !== 'eligible') return eligible;

        const branchRows = await transaction.$queryRaw<
          Array<{
            id: string;
            facilityId: string;
            branchStatus: string;
            facilityStatus: string;
          }>
        >(
          Prisma.sql`
            SELECT
              \`branch\`.\`id\` AS \`id\`,
              \`branch\`.\`facilityId\` AS \`facilityId\`,
              \`branch\`.\`status\` AS \`branchStatus\`,
              \`facility\`.\`status\` AS \`facilityStatus\`
            FROM \`Branch\` AS \`branch\`
            INNER JOIN \`Facility\` AS \`facility\`
              ON \`facility\`.\`id\` = \`branch\`.\`facilityId\`
            WHERE \`branch\`.\`id\` = ${input.branchId}
              AND \`facility\`.\`tenantId\` = ${input.tenantId}
            FOR UPDATE
          `,
        );
        const branch = branchRows[0];
        if (!branch) return { kind: 'not-found' };
        if (
          branch.branchStatus !== BranchStatus.ACTIVE ||
          branch.facilityStatus !== FacilityStatus.ACTIVE
        ) {
          return { kind: 'unit-ineligible' };
        }

        const where = {
          staffId_branchId: { staffId: input.staffId, branchId: input.branchId },
        };
        const existing = await transaction.staffBranchAssignment.findUnique({
          where,
          select: branchAssignmentSelect,
        });
        if (existing) return { kind: 'already-assigned', assignment: existing };

        const assignment = await transaction.staffBranchAssignment.create({
          data: {
            tenantId: input.tenantId,
            staffId: input.staffId,
            facilityId: branch.facilityId,
            branchId: input.branchId,
          },
          select: branchAssignmentSelect,
        });
        return { kind: 'changed', assignment };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await this.prisma.staffBranchAssignment.findFirst({
        where: {
          tenantId: input.tenantId,
          staffId: input.staffId,
          branchId: input.branchId,
        },
        select: branchAssignmentSelect,
      });
      if (!existing) throw error;
      return { kind: 'already-assigned', assignment: existing };
    }
  }

  async removeFacility(
    input: AssignmentInput & { facilityId: string },
  ): Promise<RemoveTenantStaffScopeResult> {
    return this.prisma.$transaction(async (transaction) => {
      const actor = await this.lockActiveTenantAndActor(transaction, input);
      if (actor !== 'eligible') return { kind: actor };

      const staff = await transaction.staff.findFirst({
        where: { id: input.staffId, tenantId: input.tenantId },
        select: { userId: true },
      });
      const facility = await transaction.facility.findFirst({
        where: { id: input.facilityId, tenantId: input.tenantId },
        select: { id: true },
      });
      if (!staff || !facility) return { kind: 'not-found' };

      const removed = await transaction.staffFacilityAssignment.deleteMany({
        where: {
          tenantId: input.tenantId,
          staffId: input.staffId,
          facilityId: input.facilityId,
        },
      });
      if (removed.count !== 1) return { kind: 'not-assigned' };
      return { kind: 'changed', userId: staff.userId };
    });
  }

  async removeBranch(
    input: AssignmentInput & { branchId: string },
  ): Promise<RemoveTenantStaffScopeResult> {
    return this.prisma.$transaction(async (transaction) => {
      const actor = await this.lockActiveTenantAndActor(transaction, input);
      if (actor !== 'eligible') return { kind: actor };

      const staff = await transaction.staff.findFirst({
        where: { id: input.staffId, tenantId: input.tenantId },
        select: { userId: true },
      });
      const branch = await transaction.branch.findFirst({
        where: { id: input.branchId, facility: { is: { tenantId: input.tenantId } } },
        select: { id: true, facilityId: true },
      });
      if (!staff || !branch) return { kind: 'not-found' };

      const removed = await transaction.staffBranchAssignment.deleteMany({
        where: {
          tenantId: input.tenantId,
          staffId: input.staffId,
          branchId: input.branchId,
          facilityId: branch.facilityId,
        },
      });
      if (removed.count !== 1) return { kind: 'not-assigned' };
      return { kind: 'changed', userId: staff.userId };
    });
  }

  async resolveEffectiveScope(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffEffectiveScope | null> {
    const record = await this.prisma.staff.findFirst({
      where: { id: staffId, tenantId, tenant: activeTenantRelation() },
      select: {
        status: true,
        membership: {
          select: {
            status: true,
            platformUser: { select: { status: true } },
          },
        },
        facilityAssignments: {
          where: { tenantId },
          select: {
            facility: {
              select: {
                id: true,
                name: true,
                status: true,
                tenant: { select: { status: true } },
              },
            },
          },
        },
        branchAssignments: {
          where: { tenantId },
          select: {
            branch: {
              select: { id: true, name: true, status: true },
            },
            facility: {
              select: {
                id: true,
                name: true,
                status: true,
                tenant: { select: { status: true } },
              },
            },
          },
        },
      },
    });
    if (!record) return null;

    if (
      record.status !== StaffStatus.ACTIVE ||
      record.membership.status !== TenantMembershipStatus.ACTIVE ||
      record.membership.platformUser.status !== 'ACTIVE'
    ) {
      return { facilities: [], branches: [] };
    }

    return {
      facilities: record.facilityAssignments
        .filter(
          ({ facility }) =>
            facility.status === FacilityStatus.ACTIVE &&
            facility.tenant.status === TenantStatus.ACTIVE,
        )
        .map(({ facility }) => ({ id: facility.id, name: facility.name })),
      branches: record.branchAssignments
        .filter(
          ({ branch, facility }) =>
            branch.status === BranchStatus.ACTIVE &&
            facility.status === FacilityStatus.ACTIVE &&
            facility.tenant.status === TenantStatus.ACTIVE,
        )
        .map(({ branch, facility }) => ({
          id: branch.id,
          name: branch.name,
          facilityId: facility.id,
          facilityName: facility.name,
        })),
    };
  }

  private async checkMutationEligibility(
    transaction: Prisma.TransactionClient,
    input: AssignmentInput,
  ): Promise<EligibilityResult> {
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

    const actor = await transaction.tenantMembership.findFirst({
      where: {
        id: input.actorMembershipId,
        tenantId: input.tenantId,
        platformUserId: input.actorPlatformUserId,
        status: TenantMembershipStatus.ACTIVE,
        tenant: { is: { status: TenantStatus.ACTIVE } },
      },
      select: { id: true },
    });
    if (!actor) return { kind: 'actor-ineligible' };

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
    return { kind: 'eligible', userId: staff.userId };
  }

  private async lockActiveTenantAndActor(
    transaction: Prisma.TransactionClient,
    input: AssignmentInput,
  ): Promise<'eligible' | 'not-found' | 'actor-ineligible'> {
    const activeTenant = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT \`id\`
        FROM \`Tenant\`
        WHERE \`id\` = ${input.tenantId}
          AND \`status\` = 'ACTIVE'
        FOR UPDATE
      `,
    );
    if (activeTenant.length !== 1) return 'not-found';

    const actor = await transaction.tenantMembership.findFirst({
      where: {
        id: input.actorMembershipId,
        tenantId: input.tenantId,
        platformUserId: input.actorPlatformUserId,
        status: TenantMembershipStatus.ACTIVE,
        tenant: { is: { status: TenantStatus.ACTIVE } },
      },
      select: { id: true },
    });
    return actor ? 'eligible' : 'actor-ineligible';
  }
}
