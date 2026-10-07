import { Injectable } from '@nestjs/common';
import { Prisma, StaffStatus, TenantCatalogStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { CreateDoctorInput, UpdateDoctorInput } from './doctor.dto';

const doctorSelect = {
  id: true,
  tenantId: true,
  staffId: true,
  professionalDisplayName: true,
  status: true,
  statusChangedAt: true,
  suspendedAt: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
  tenant: { select: { status: true } },
  staff: {
    select: {
      id: true,
      userId: true,
      displayName: true,
      status: true,
    },
  },
  departmentAssignments: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      createdAt: true,
      department: { select: { id: true, name: true, status: true } },
    },
  },
  specialtyAssignments: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      createdAt: true,
      specialty: { select: { id: true, name: true, status: true } },
    },
  },
} satisfies Prisma.DoctorSelect;

export type DoctorRecord = Prisma.DoctorGetPayload<{ select: typeof doctorSelect }>;

export interface DoctorListFilter {
  status?: StaffStatus;
  limit: number;
  offset: number;
}

export type CreateDoctorResult =
  | { kind: 'created'; doctor: DoctorRecord }
  | { kind: 'tenant-inactive' }
  | { kind: 'staff-not-found' }
  | { kind: 'staff-ineligible' }
  | { kind: 'assignment-target-not-found' }
  | { kind: 'already-exists' };

export type DoctorMutationResult =
  | { kind: 'changed'; doctor: DoctorRecord }
  | { kind: 'tenant-inactive' }
  | { kind: 'not-found' }
  | { kind: 'not-changed' }
  | { kind: 'doctor-deactivated' }
  | { kind: 'assignment-target-not-found' }
  | { kind: 'assignment-conflict' }
  | { kind: 'assignment-not-found' };

type Transaction = Prisma.TransactionClient;
type CatalogTable = 'Department' | 'Specialty';

function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function activeTenantFilter(): Prisma.DoctorWhereInput['tenant'] {
  return { is: { status: TenantStatus.ACTIVE } };
}

@Injectable()
export class DoctorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, input: CreateDoctorInput): Promise<CreateDoctorResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        if (!(await this.lockActiveTenant(transaction, tenantId))) {
          return { kind: 'tenant-inactive' };
        }

        const staffRows = await transaction.$queryRaw<
          Array<{
            id: string;
            userId: string;
            status: string;
            membershipStatus: string | null;
            userStatus: string | null;
          }>
        >(Prisma.sql`
          SELECT
            \`staff\`.\`id\` AS \`id\`,
            \`staff\`.\`userId\` AS \`userId\`,
            \`staff\`.\`status\` AS \`status\`,
            \`membership\`.\`status\` AS \`membershipStatus\`,
            \`platformUser\`.\`status\` AS \`userStatus\`
          FROM \`Staff\` AS \`staff\`
          LEFT JOIN \`TenantMembership\` AS \`membership\`
            ON \`membership\`.\`id\` = \`staff\`.\`membershipId\`
            AND \`membership\`.\`tenantId\` = \`staff\`.\`tenantId\`
            AND \`membership\`.\`platformUserId\` = \`staff\`.\`userId\`
          LEFT JOIN \`User\` AS \`platformUser\`
            ON \`platformUser\`.\`id\` = \`staff\`.\`userId\`
          WHERE \`staff\`.\`id\` = ${input.staffId}
            AND \`staff\`.\`tenantId\` = ${tenantId}
          FOR UPDATE
        `);
        const staff = staffRows[0];
        if (!staff) return { kind: 'staff-not-found' };
        if (
          staff.status !== StaffStatus.ACTIVE ||
          staff.membershipStatus !== 'ACTIVE' ||
          staff.userStatus !== 'ACTIVE'
        ) {
          return { kind: 'staff-ineligible' };
        }

        const departmentIds = input.departmentIds ?? [];
        const specialtyIds = input.specialtyIds ?? [];
        const activeDepartments = await this.lockActiveCatalogIds(
          transaction,
          tenantId,
          'Department',
          departmentIds,
        );
        const activeSpecialties = await this.lockActiveCatalogIds(
          transaction,
          tenantId,
          'Specialty',
          specialtyIds,
        );
        if (
          activeDepartments.length !== departmentIds.length ||
          activeSpecialties.length !== specialtyIds.length
        ) {
          return { kind: 'assignment-target-not-found' };
        }

        const doctor = await transaction.doctor.create({
          data: {
            tenantId,
            staffId: input.staffId,
            professionalDisplayName: input.professionalDisplayName ?? null,
            ...(departmentIds.length
              ? {
                  departmentAssignments: {
                    create: departmentIds.map((departmentId) => ({
                      department: { connect: { id_tenantId: { id: departmentId, tenantId } } },
                    })),
                  },
                }
              : {}),
            ...(specialtyIds.length
              ? {
                  specialtyAssignments: {
                    create: specialtyIds.map((specialtyId) => ({
                      specialty: { connect: { id_tenantId: { id: specialtyId, tenantId } } },
                    })),
                  },
                }
              : {}),
          },
          select: doctorSelect,
        });
        return { kind: 'created', doctor };
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) return { kind: 'already-exists' };
      throw error;
    }
  }

  listForTenant(tenantId: string, filter: DoctorListFilter): Promise<DoctorRecord[]> {
    return this.prisma.doctor.findMany({
      where: {
        tenantId,
        tenant: activeTenantFilter(),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.offset,
      take: filter.limit,
      select: doctorSelect,
    });
  }

  findByIdForTenant(tenantId: string, id: string): Promise<DoctorRecord | null> {
    return this.prisma.doctor.findFirst({
      where: { tenantId, id },
      select: doctorSelect,
    });
  }

  async updateForTenant(
    tenantId: string,
    id: string,
    input: UpdateDoctorInput,
  ): Promise<DoctorMutationResult> {
    return this.prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveTenant(transaction, tenantId))) return { kind: 'tenant-inactive' };
      const result = await transaction.doctor.updateMany({
        where: { tenantId, id },
        data: { professionalDisplayName: input.professionalDisplayName },
      });
      if (result.count !== 1) return { kind: 'not-found' };
      const doctor = await this.findWithTransaction(transaction, tenantId, id);
      return doctor ? { kind: 'changed', doctor } : { kind: 'not-found' };
    });
  }

  async changeStatusIfCurrent(
    tenantId: string,
    id: string,
    expectedStatus: StaffStatus,
    nextStatus: StaffStatus,
    changedAt: Date,
  ): Promise<DoctorMutationResult> {
    return this.prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveTenant(transaction, tenantId))) return { kind: 'tenant-inactive' };
      const result = await transaction.doctor.updateMany({
        where: { tenantId, id, status: expectedStatus },
        data: {
          status: nextStatus,
          statusChangedAt: changedAt,
          updatedAt: changedAt,
          ...(nextStatus === StaffStatus.SUSPENDED ? { suspendedAt: changedAt } : {}),
          ...(nextStatus === StaffStatus.DEACTIVATED ? { deactivatedAt: changedAt } : {}),
        },
      });
      if (result.count !== 1) return { kind: 'not-changed' };
      const doctor = await this.findWithTransaction(transaction, tenantId, id);
      return doctor ? { kind: 'changed', doctor } : { kind: 'not-found' };
    });
  }

  async assignDepartment(
    tenantId: string,
    doctorId: string,
    departmentId: string,
  ): Promise<DoctorMutationResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const failure = await this.lockAssignmentTargets(
          transaction,
          tenantId,
          doctorId,
          'Department',
          departmentId,
        );
        if (failure) return failure;
        await transaction.doctorDepartmentAssignment.create({
          data: { tenantId, doctorId, departmentId },
        });
        const doctor = await this.findWithTransaction(transaction, tenantId, doctorId);
        return doctor ? { kind: 'changed', doctor } : { kind: 'not-found' };
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) return { kind: 'assignment-conflict' };
      throw error;
    }
  }

  async unassignDepartment(
    tenantId: string,
    doctorId: string,
    departmentId: string,
  ): Promise<DoctorMutationResult> {
    return this.prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveTenant(transaction, tenantId))) return { kind: 'tenant-inactive' };
      const result = await transaction.doctorDepartmentAssignment.deleteMany({
        where: { tenantId, doctorId, departmentId },
      });
      if (result.count !== 1) return { kind: 'assignment-not-found' };
      const doctor = await this.findWithTransaction(transaction, tenantId, doctorId);
      return doctor ? { kind: 'changed', doctor } : { kind: 'not-found' };
    });
  }

  async assignSpecialty(
    tenantId: string,
    doctorId: string,
    specialtyId: string,
  ): Promise<DoctorMutationResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const failure = await this.lockAssignmentTargets(
          transaction,
          tenantId,
          doctorId,
          'Specialty',
          specialtyId,
        );
        if (failure) return failure;
        await transaction.doctorSpecialtyAssignment.create({
          data: { tenantId, doctorId, specialtyId },
        });
        const doctor = await this.findWithTransaction(transaction, tenantId, doctorId);
        return doctor ? { kind: 'changed', doctor } : { kind: 'not-found' };
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) return { kind: 'assignment-conflict' };
      throw error;
    }
  }

  async unassignSpecialty(
    tenantId: string,
    doctorId: string,
    specialtyId: string,
  ): Promise<DoctorMutationResult> {
    return this.prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveTenant(transaction, tenantId))) return { kind: 'tenant-inactive' };
      const result = await transaction.doctorSpecialtyAssignment.deleteMany({
        where: { tenantId, doctorId, specialtyId },
      });
      if (result.count !== 1) return { kind: 'assignment-not-found' };
      const doctor = await this.findWithTransaction(transaction, tenantId, doctorId);
      return doctor ? { kind: 'changed', doctor } : { kind: 'not-found' };
    });
  }

  private async lockAssignmentTargets(
    transaction: Transaction,
    tenantId: string,
    doctorId: string,
    table: CatalogTable,
    targetId: string,
  ): Promise<DoctorMutationResult | null> {
    if (!(await this.lockActiveTenant(transaction, tenantId))) return { kind: 'tenant-inactive' };
    const doctorRows = await transaction.$queryRaw<
      Array<{ id: string; status: string }>
    >(Prisma.sql`
      SELECT \`id\`, \`status\`
      FROM \`Doctor\`
      WHERE \`id\` = ${doctorId} AND \`tenantId\` = ${tenantId}
      FOR UPDATE
    `);
    const doctor = doctorRows[0];
    if (!doctor) return { kind: 'not-found' };
    if (doctor.status === StaffStatus.DEACTIVATED) return { kind: 'doctor-deactivated' };
    const available = await this.lockActiveCatalogIds(transaction, tenantId, table, [targetId]);
    return available.length === 1 ? null : { kind: 'assignment-target-not-found' };
  }

  private async lockActiveTenant(transaction: Transaction, tenantId: string): Promise<boolean> {
    const tenantRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\`
      FROM \`Tenant\`
      WHERE \`id\` = ${tenantId} AND \`status\` = ${TenantStatus.ACTIVE}
      FOR UPDATE
    `);
    return tenantRows.length === 1;
  }

  private async lockActiveCatalogIds(
    transaction: Transaction,
    tenantId: string,
    table: CatalogTable,
    ids: readonly string[],
  ): Promise<Array<{ id: string }>> {
    if (ids.length === 0) return [];
    const tableName = table === 'Department' ? '`Department`' : '`Specialty`';
    return transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\`
      FROM ${Prisma.raw(tableName)}
      WHERE \`tenantId\` = ${tenantId}
        AND \`status\` = ${TenantCatalogStatus.ACTIVE}
        AND \`id\` IN (${Prisma.join(ids)})
      FOR UPDATE
    `);
  }

  private findWithTransaction(
    transaction: Transaction,
    tenantId: string,
    id: string,
  ): Promise<DoctorRecord | null> {
    return transaction.doctor.findFirst({
      where: { tenantId, id },
      select: doctorSelect,
    });
  }
}
