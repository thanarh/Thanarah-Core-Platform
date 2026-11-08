import { Injectable } from '@nestjs/common';
import {
  DoctorServiceAssignmentScope,
  Prisma,
  StaffStatus,
  TenantCatalogStatus,
  TenantStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { CreateDoctorInput, UpdateDoctorInput } from './doctor.dto';
import type {
  CreateDoctorResult as CreateDoctorResultContract,
  DoctorListFilter as DoctorListFilterContract,
  DoctorMutationResult as DoctorMutationResultContract,
  DoctorPersistencePort,
  DoctorRecord as DoctorRecordContract,
  DoctorServiceAssignmentInputRecord,
  DoctorServiceAssignmentMutationResult as DoctorServiceAssignmentMutationResultContract,
  DoctorServiceAssignmentRecord as DoctorServiceAssignmentRecordContract,
} from '../persistence/platform-persistence.ports';

const doctorSelect = {
  id: true,
  tenantId: true,
  staffId: true,
  professionalDisplayName: true,
  professionalTitle: true,
  professionalCode: true,
  bio: true,
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

export type DoctorRecord = DoctorRecordContract;
export type DoctorListFilter = DoctorListFilterContract;
export type CreateDoctorResult = CreateDoctorResultContract;
export type DoctorMutationResult = DoctorMutationResultContract;
export type DoctorServiceAssignmentRecord = DoctorServiceAssignmentRecordContract;
export type DoctorServiceAssignmentMutationResult = DoctorServiceAssignmentMutationResultContract;

type Transaction = Prisma.TransactionClient;
type CatalogTable = 'Department' | 'Specialty';

function isPrismaError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function isProfessionalCodeConflict(error: unknown): boolean {
  if (!isPrismaError(error, 'P2002')) return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.some(
      (field) => typeof field === 'string' && field.toLowerCase().includes('professionalcode'),
    );
  }
  return typeof target === 'string' && target.toLowerCase().includes('professionalcode');
}

function activeTenantFilter(): Prisma.DoctorWhereInput['tenant'] {
  return { is: { status: TenantStatus.ACTIVE } };
}

@Injectable()
export class DoctorRepository implements DoctorPersistencePort {
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
            professionalTitle: input.professionalTitle ?? null,
            professionalCode: input.professionalCode ?? null,
            bio: input.bio ?? null,
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
      if (isProfessionalCodeConflict(error)) return { kind: 'professional-code-conflict' };
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
    try {
      return await this.prisma.$transaction(async (transaction) => {
        if (!(await this.lockActiveTenant(transaction, tenantId))) {
          return { kind: 'tenant-inactive' };
        }
        const result = await transaction.doctor.updateMany({
          where: { tenantId, id },
          data: {
            ...(input.professionalDisplayName !== undefined
              ? { professionalDisplayName: input.professionalDisplayName }
              : {}),
            ...(input.professionalTitle !== undefined
              ? { professionalTitle: input.professionalTitle }
              : {}),
            ...(input.professionalCode !== undefined
              ? { professionalCode: input.professionalCode }
              : {}),
            ...(input.bio !== undefined ? { bio: input.bio } : {}),
          },
        });
        if (result.count !== 1) return { kind: 'not-found' };
        const doctor = await this.findWithTransaction(transaction, tenantId, id);
        return doctor ? { kind: 'changed', doctor } : { kind: 'not-found' };
      });
    } catch (error) {
      if (isProfessionalCodeConflict(error)) return { kind: 'professional-code-conflict' };
      throw error;
    }
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

  async listServiceAssignments(
    tenantId: string,
    doctorId: string,
  ): Promise<DoctorServiceAssignmentRecord[]> {
    const assignments = await this.prisma.doctorServiceAssignment.findMany({
      where: { tenantId, doctorId },
      orderBy: [{ createdAt: 'asc' }, { scopeType: 'asc' }, { scopeId: 'asc' }],
      select: {
        tenantId: true,
        doctorId: true,
        serviceId: true,
        facilityId: true,
        branchId: true,
        scopeType: true,
        scopeId: true,
        createdAt: true,
        service: { select: { name: true, status: true } },
        facility: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });
    return assignments.map((assignment) => ({
      tenantId: assignment.tenantId,
      doctorId: assignment.doctorId,
      serviceId: assignment.serviceId,
      serviceName: assignment.service.name,
      serviceStatus: assignment.service.status,
      facilityId: assignment.facilityId,
      facilityName: assignment.facility.name,
      branchId: assignment.branchId,
      branchName: assignment.branch?.name ?? null,
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      assignedAt: assignment.createdAt,
    }));
  }

  async assignService(
    tenantId: string,
    doctorId: string,
    input: DoctorServiceAssignmentInputRecord,
  ): Promise<DoctorServiceAssignmentMutationResult> {
    const scopeType = input.branchId
      ? DoctorServiceAssignmentScope.BRANCH
      : DoctorServiceAssignmentScope.FACILITY;
    const scopeId = input.branchId ?? input.facilityId;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        if (!(await this.lockActiveTenant(transaction, tenantId))) {
          return { kind: 'tenant-inactive' };
        }

        const doctorRows = await transaction.$queryRaw<
          Array<{ id: string; staffId: string; status: string; staffStatus: string }>
        >(Prisma.sql`
          SELECT
            \`doctor\`.\`id\` AS \`id\`,
            \`doctor\`.\`staffId\` AS \`staffId\`,
            \`doctor\`.\`status\` AS \`status\`,
            \`staff\`.\`status\` AS \`staffStatus\`
          FROM \`Doctor\` AS \`doctor\`
          INNER JOIN \`Staff\` AS \`staff\`
            ON \`staff\`.\`id\` = \`doctor\`.\`staffId\`
            AND \`staff\`.\`tenantId\` = \`doctor\`.\`tenantId\`
          WHERE \`doctor\`.\`id\` = ${doctorId}
            AND \`doctor\`.\`tenantId\` = ${tenantId}
          FOR UPDATE
        `);
        const doctor = doctorRows[0];
        if (!doctor) return { kind: 'doctor-not-found' };
        if (
          doctor.status === StaffStatus.DEACTIVATED ||
          doctor.staffStatus === StaffStatus.DEACTIVATED
        ) {
          return { kind: 'doctor-deactivated' };
        }

        const serviceRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT \`id\`
          FROM \`Service\`
          WHERE \`id\` = ${input.serviceId}
            AND \`tenantId\` = ${tenantId}
            AND \`status\` = ${TenantCatalogStatus.ACTIVE}
          FOR UPDATE
        `);
        const facilityRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT \`id\`
          FROM \`Facility\`
          WHERE \`id\` = ${input.facilityId}
            AND \`tenantId\` = ${tenantId}
            AND \`status\` = 'ACTIVE'
          FOR UPDATE
        `);
        if (!serviceRows.length || !facilityRows.length) return { kind: 'target-not-found' };

        if (input.branchId) {
          const branchRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT \`id\`
            FROM \`Branch\`
            WHERE \`id\` = ${input.branchId}
              AND \`facilityId\` = ${input.facilityId}
              AND \`status\` = 'ACTIVE'
            FOR UPDATE
          `);
          if (!branchRows.length) return { kind: 'target-not-found' };
        }

        const facilityScopeRows = await transaction.$queryRaw<Array<{ staffId: string }>>(
          Prisma.sql`
            SELECT \`staffId\`
            FROM \`StaffFacilityAssignment\`
            WHERE \`tenantId\` = ${tenantId}
              AND \`staffId\` = ${doctor.staffId}
              AND \`facilityId\` = ${input.facilityId}
            FOR UPDATE
          `,
        );
        let branchScopeRows: Array<{ staffId: string }> = [];
        if (input.branchId) {
          branchScopeRows = await transaction.$queryRaw<Array<{ staffId: string }>>(Prisma.sql`
            SELECT \`staffId\`
            FROM \`StaffBranchAssignment\`
            WHERE \`tenantId\` = ${tenantId}
              AND \`staffId\` = ${doctor.staffId}
              AND \`facilityId\` = ${input.facilityId}
              AND \`branchId\` = ${input.branchId}
            FOR UPDATE
          `);
        }
        const inScope =
          facilityScopeRows.length > 0 || (input.branchId !== null && branchScopeRows.length > 0);
        if (!inScope) return { kind: 'doctor-out-of-scope' };

        await transaction.doctorServiceAssignment.create({
          data: {
            tenantId,
            doctorId,
            serviceId: input.serviceId,
            facilityId: input.facilityId,
            branchId: input.branchId,
            scopeType,
            scopeId,
          },
        });
        const assignment = await this.findServiceAssignment(
          transaction,
          tenantId,
          doctorId,
          input,
          scopeType,
          scopeId,
        );
        return assignment ? { kind: 'changed', assignment } : { kind: 'doctor-not-found' };
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) return { kind: 'assignment-conflict' };
      throw error;
    }
  }

  async unassignService(
    tenantId: string,
    doctorId: string,
    input: DoctorServiceAssignmentInputRecord,
  ): Promise<DoctorServiceAssignmentMutationResult> {
    const scopeType = input.branchId
      ? DoctorServiceAssignmentScope.BRANCH
      : DoctorServiceAssignmentScope.FACILITY;
    const scopeId = input.branchId ?? input.facilityId;
    return this.prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveTenant(transaction, tenantId))) {
        return { kind: 'tenant-inactive' };
      }
      const assignment = await this.findServiceAssignment(
        transaction,
        tenantId,
        doctorId,
        input,
        scopeType,
        scopeId,
      );
      if (!assignment) return { kind: 'assignment-not-found' };
      const deleted = await transaction.doctorServiceAssignment.deleteMany({
        where: {
          tenantId,
          doctorId,
          serviceId: input.serviceId,
          facilityId: input.facilityId,
          branchId: input.branchId,
          scopeType,
          scopeId,
        },
      });
      return deleted.count === 1
        ? { kind: 'changed', assignment }
        : { kind: 'assignment-not-found' };
    });
  }

  async hasServiceAssignment(
    tenantId: string,
    doctorId: string,
    serviceId: string,
    facilityId: string,
    branchId: string | null,
  ): Promise<boolean> {
    const locationScopes = [
      { scopeType: DoctorServiceAssignmentScope.FACILITY, scopeId: facilityId },
      ...(branchId ? [{ scopeType: DoctorServiceAssignmentScope.BRANCH, scopeId: branchId }] : []),
    ];
    return (
      (await this.prisma.doctorServiceAssignment.findFirst({
        where: {
          tenantId,
          doctorId,
          serviceId,
          facilityId,
          OR: locationScopes,
        },
        select: { doctorId: true },
      })) !== null
    );
  }

  private async findServiceAssignment(
    transaction: Transaction,
    tenantId: string,
    doctorId: string,
    input: DoctorServiceAssignmentInputRecord,
    scopeType: DoctorServiceAssignmentScope,
    scopeId: string,
  ): Promise<DoctorServiceAssignmentRecord | null> {
    const assignment = await transaction.doctorServiceAssignment.findUnique({
      where: {
        tenantId_doctorId_serviceId_scopeType_scopeId: {
          tenantId,
          doctorId,
          serviceId: input.serviceId,
          scopeType,
          scopeId,
        },
      },
      select: {
        tenantId: true,
        doctorId: true,
        serviceId: true,
        facilityId: true,
        branchId: true,
        scopeType: true,
        scopeId: true,
        createdAt: true,
        service: { select: { name: true, status: true } },
        facility: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });
    if (!assignment || assignment.facilityId !== input.facilityId) return null;
    return {
      tenantId: assignment.tenantId,
      doctorId: assignment.doctorId,
      serviceId: assignment.serviceId,
      serviceName: assignment.service.name,
      serviceStatus: assignment.service.status,
      facilityId: assignment.facilityId,
      facilityName: assignment.facility.name,
      branchId: assignment.branchId,
      branchName: assignment.branch?.name ?? null,
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      assignedAt: assignment.createdAt,
    };
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
