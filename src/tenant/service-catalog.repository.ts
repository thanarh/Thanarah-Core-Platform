import { Injectable } from '@nestjs/common';
import { Prisma, TenantCatalogStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateServiceInput,
  ListServicesQuery,
  UpdateServiceInput,
} from './service-catalog.dto';

const serviceSelect = {
  id: true,
  name: true,
  code: true,
  description: true,
  status: true,
  statusChangedAt: true,
  suspendedAt: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ServiceSelect;

export type ServiceCatalogRecord = Prisma.ServiceGetPayload<{
  select: typeof serviceSelect;
}>;

export type ServiceCatalogMutationResult =
  | { kind: 'changed'; record: ServiceCatalogRecord }
  | { kind: 'tenant-inactive' }
  | { kind: 'not-found' }
  | { kind: 'name-conflict' }
  | { kind: 'code-conflict' }
  | { kind: 'conflict' }
  | { kind: 'not-changed' };

type ServiceCatalogUniqueConflictKind = 'name-conflict' | 'code-conflict' | 'conflict';

@Injectable()
export class ServiceCatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, input: CreateServiceInput): Promise<ServiceCatalogMutationResult> {
    if (!(await this.isTenantActive(tenantId))) return { kind: 'tenant-inactive' };

    try {
      const record = await this.prisma.service.create({
        data: {
          tenantId,
          name: input.name,
          code: input.code ?? null,
          description: input.description ?? null,
        },
        select: serviceSelect,
      });
      return { kind: 'changed', record };
    } catch (error) {
      const conflict = this.uniqueConflict(error);
      if (conflict) return { kind: conflict };
      throw error;
    }
  }

  findById(tenantId: string, id: string): Promise<ServiceCatalogRecord | null> {
    return this.prisma.service.findFirst({
      where: { tenantId, id },
      select: serviceSelect,
    });
  }

  async list(
    tenantId: string,
    query: ListServicesQuery,
  ): Promise<{ items: ServiceCatalogRecord[]; total: number }> {
    const where = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.service.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
        select: serviceSelect,
      }),
      this.prisma.service.count({ where }),
    ]);
    return { items, total };
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateServiceInput,
  ): Promise<ServiceCatalogMutationResult> {
    if (!(await this.isTenantActive(tenantId))) return { kind: 'tenant-inactive' };

    try {
      const result = await this.prisma.service.updateMany({
        where: { tenantId, id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
      if (result.count !== 1) return { kind: 'not-found' };
      const record = await this.findById(tenantId, id);
      return record ? { kind: 'changed', record } : { kind: 'not-found' };
    } catch (error) {
      const conflict = this.uniqueConflict(error);
      if (conflict) return { kind: conflict };
      throw error;
    }
  }

  async changeStatusIfCurrent(
    tenantId: string,
    id: string,
    expectedStatus: TenantCatalogStatus,
    nextStatus: TenantCatalogStatus,
    changedAt: Date,
  ): Promise<ServiceCatalogMutationResult> {
    if (!(await this.isTenantActive(tenantId))) return { kind: 'tenant-inactive' };

    const result = await this.prisma.service.updateMany({
      where: { tenantId, id, status: expectedStatus },
      data: {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
        ...(nextStatus === TenantCatalogStatus.SUSPENDED ? { suspendedAt: changedAt } : {}),
        ...(nextStatus === TenantCatalogStatus.DEACTIVATED ? { deactivatedAt: changedAt } : {}),
      },
    });
    if (result.count !== 1) return { kind: 'not-changed' };
    const record = await this.findById(tenantId, id);
    return record ? { kind: 'changed', record } : { kind: 'not-found' };
  }

  private async isTenantActive(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, status: TenantStatus.ACTIVE },
      select: { id: true },
    });
    return tenant !== null;
  }

  private uniqueConflict(error: unknown): ServiceCatalogUniqueConflictKind | null {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return null;
    }
    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.join(' ').toLowerCase()
      : typeof target === 'string'
        ? target.toLowerCase()
        : '';
    if (fields.includes('name')) return 'name-conflict';
    if (fields.includes('code')) return 'code-conflict';
    return 'conflict';
  }
}
