import { Injectable } from '@nestjs/common';
import { PatientStatus, Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { CreatePatientInput, ListPatientsQuery, UpdatePatientInput } from './patient.dto';

const patientSelect = {
  id: true,
  patientNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  preferredName: true,
  dateOfBirth: true,
  gender: true,
  phone: true,
  email: true,
  nationalId: true,
  address: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PatientSelect;

export type PatientRecord = Prisma.PatientGetPayload<{ select: typeof patientSelect }>;

export type PatientMutationResult =
  | { kind: 'changed'; record: PatientRecord }
  | { kind: 'tenant-inactive' }
  | { kind: 'not-found' }
  | { kind: 'patient-number-conflict' }
  | { kind: 'not-changed' };

function isPatientNumberConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const fields = Array.isArray(target)
    ? target.join(' ').toLowerCase()
    : typeof target === 'string'
      ? target.toLowerCase()
      : '';
  return fields.includes('patientnumber');
}

@Injectable()
export class PatientRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, input: CreatePatientInput): Promise<PatientMutationResult> {
    if (!(await this.isTenantActive(tenantId))) return { kind: 'tenant-inactive' };

    try {
      const record = await this.prisma.patient.create({
        data: {
          tenantId,
          patientNumber: input.patientNumber,
          firstName: input.firstName,
          middleName: input.middleName ?? null,
          lastName: input.lastName,
          preferredName: input.preferredName ?? null,
          dateOfBirth: input.dateOfBirth ?? null,
          gender: input.gender ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          nationalId: input.nationalId ?? null,
          address: input.address ?? null,
        },
        select: patientSelect,
      });
      return { kind: 'changed', record };
    } catch (error) {
      if (isPatientNumberConflict(error)) return { kind: 'patient-number-conflict' };
      throw error;
    }
  }

  async list(
    tenantId: string,
    query: ListPatientsQuery,
  ): Promise<{ items: PatientRecord[]; total: number }> {
    const where: Prisma.PatientWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.patientNumber ? { patientNumber: query.patientNumber } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.patient.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
        select: patientSelect,
      }),
      this.prisma.patient.count({ where }),
    ]);
    return { items, total };
  }

  findByIdForTenant(tenantId: string, id: string): Promise<PatientRecord | null> {
    return this.prisma.patient.findFirst({
      where: { id, tenantId },
      select: patientSelect,
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdatePatientInput,
  ): Promise<PatientMutationResult> {
    if (!(await this.isTenantActive(tenantId))) return { kind: 'tenant-inactive' };

    try {
      const result = await this.prisma.patient.updateMany({
        where: { id, tenantId },
        data: input,
      });
      if (result.count !== 1) return { kind: 'not-found' };
      const record = await this.findByIdForTenant(tenantId, id);
      return record ? { kind: 'changed', record } : { kind: 'not-found' };
    } catch (error) {
      if (isPatientNumberConflict(error)) return { kind: 'patient-number-conflict' };
      throw error;
    }
  }

  async changeStatusIfCurrent(
    tenantId: string,
    id: string,
    expectedStatus: PatientStatus,
    nextStatus: PatientStatus,
    changedAt: Date,
  ): Promise<PatientMutationResult> {
    if (!(await this.isTenantActive(tenantId))) return { kind: 'tenant-inactive' };

    const result = await this.prisma.patient.updateMany({
      where: { id, tenantId, status: expectedStatus },
      data: { status: nextStatus, updatedAt: changedAt },
    });
    if (result.count !== 1) return { kind: 'not-changed' };
    const record = await this.findByIdForTenant(tenantId, id);
    return record ? { kind: 'changed', record } : { kind: 'not-found' };
  }

  private async isTenantActive(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, status: TenantStatus.ACTIVE },
      select: { id: true },
    });
    return tenant !== null;
  }
}
