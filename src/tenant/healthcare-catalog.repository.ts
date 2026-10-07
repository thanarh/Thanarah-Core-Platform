import { Injectable } from '@nestjs/common';
import { Prisma, TenantCatalogStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateHealthcareCatalogInput,
  HealthcareCatalogKind,
  ListHealthcareCatalogQuery,
  UpdateHealthcareCatalogInput,
} from './healthcare-catalog.dto';

const healthcareCatalogSelect = {
  id: true,
  tenantId: true,
  name: true,
  description: true,
  status: true,
  statusChangedAt: true,
  suspendedAt: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DepartmentSelect & Prisma.SpecialtySelect;

type DepartmentRecord = Prisma.DepartmentGetPayload<{
  select: typeof healthcareCatalogSelect;
}>;
type SpecialtyRecord = Prisma.SpecialtyGetPayload<{
  select: typeof healthcareCatalogSelect;
}>;

export type HealthcareCatalogRecord = DepartmentRecord | SpecialtyRecord;

export type HealthcareCatalogMutationResult =
  | { kind: 'changed'; record: HealthcareCatalogRecord }
  | { kind: 'tenant-inactive' }
  | { kind: 'not-found' }
  | { kind: 'name-conflict' }
  | { kind: 'not-changed' };

@Injectable()
export class HealthcareCatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    kind: HealthcareCatalogKind,
    tenantId: string,
    input: CreateHealthcareCatalogInput,
  ): Promise<HealthcareCatalogMutationResult> {
    if (!(await this.isTenantActive(tenantId))) return { kind: 'tenant-inactive' };

    try {
      const data = {
        tenantId,
        name: input.name,
        description: input.description ?? null,
      };
      const record =
        kind === 'department'
          ? await this.prisma.department.create({ data, select: healthcareCatalogSelect })
          : await this.prisma.specialty.create({ data, select: healthcareCatalogSelect });
      return { kind: 'changed', record };
    } catch (error) {
      if (this.isUniqueConflict(error)) return { kind: 'name-conflict' };
      throw error;
    }
  }

  findById(
    kind: HealthcareCatalogKind,
    tenantId: string,
    id: string,
  ): Promise<HealthcareCatalogRecord | null> {
    return kind === 'department'
      ? this.prisma.department.findFirst({
          where: { tenantId, id },
          select: healthcareCatalogSelect,
        })
      : this.prisma.specialty.findFirst({
          where: { tenantId, id },
          select: healthcareCatalogSelect,
        });
  }

  list(
    kind: HealthcareCatalogKind,
    tenantId: string,
    query: ListHealthcareCatalogQuery,
  ): Promise<HealthcareCatalogRecord[]> {
    const where = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
    };
    const args = {
      where,
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      skip: query.offset,
      take: query.limit,
      select: healthcareCatalogSelect,
    };
    return kind === 'department'
      ? this.prisma.department.findMany(args)
      : this.prisma.specialty.findMany(args);
  }

  async update(
    kind: HealthcareCatalogKind,
    tenantId: string,
    id: string,
    input: UpdateHealthcareCatalogInput,
  ): Promise<HealthcareCatalogMutationResult> {
    if (!(await this.isTenantActive(tenantId))) return { kind: 'tenant-inactive' };

    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    };

    try {
      const result =
        kind === 'department'
          ? await this.prisma.department.updateMany({ where: { tenantId, id }, data })
          : await this.prisma.specialty.updateMany({ where: { tenantId, id }, data });
      if (result.count !== 1) return { kind: 'not-found' };
      const record = await this.findById(kind, tenantId, id);
      return record ? { kind: 'changed', record } : { kind: 'not-found' };
    } catch (error) {
      if (this.isUniqueConflict(error)) return { kind: 'name-conflict' };
      throw error;
    }
  }

  async changeStatusIfCurrent(
    kind: HealthcareCatalogKind,
    tenantId: string,
    id: string,
    expectedStatus: TenantCatalogStatus,
    nextStatus: TenantCatalogStatus,
    changedAt: Date,
  ): Promise<HealthcareCatalogMutationResult> {
    if (!(await this.isTenantActive(tenantId))) return { kind: 'tenant-inactive' };

    const data = {
      status: nextStatus,
      statusChangedAt: changedAt,
      updatedAt: changedAt,
      ...(nextStatus === TenantCatalogStatus.SUSPENDED ? { suspendedAt: changedAt } : {}),
      ...(nextStatus === TenantCatalogStatus.DEACTIVATED ? { deactivatedAt: changedAt } : {}),
    };
    const result =
      kind === 'department'
        ? await this.prisma.department.updateMany({
            where: { tenantId, id, status: expectedStatus },
            data,
          })
        : await this.prisma.specialty.updateMany({
            where: { tenantId, id, status: expectedStatus },
            data,
          });
    if (result.count !== 1) return { kind: 'not-changed' };
    const record = await this.findById(kind, tenantId, id);
    return record ? { kind: 'changed', record } : { kind: 'not-found' };
  }

  private async isTenantActive(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, status: TenantStatus.ACTIVE },
      select: { id: true },
    });
    return tenant !== null;
  }

  private isUniqueConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
