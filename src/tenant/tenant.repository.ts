import { Injectable } from '@nestjs/common';
import { Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  TenantListFilter,
  TenantPersistencePort,
  TenantRecord,
} from '../persistence/platform-persistence.ports';

export type { TenantListFilter, TenantRecord } from '../persistence/platform-persistence.ports';

const tenantSelect = {
  id: true,
  slug: true,
  legalName: true,
  displayName: true,
  status: true,
  statusChangedAt: true,
  suspendedAt: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantSelect;

@Injectable()
export class TenantRepository implements TenantPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  create(input: { slug: string; legalName: string; displayName: string }): Promise<TenantRecord> {
    return this.prisma.tenant.create({ data: input, select: tenantSelect });
  }

  findById(id: string): Promise<TenantRecord | null> {
    return this.prisma.tenant.findUnique({ where: { id }, select: tenantSelect });
  }

  findBySlug(slug: string): Promise<TenantRecord | null> {
    return this.prisma.tenant.findUnique({ where: { slug }, select: tenantSelect });
  }

  list(filter: TenantListFilter): Promise<TenantRecord[]> {
    return this.prisma.tenant.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.offset,
      take: filter.limit,
      select: tenantSelect,
    });
  }

  async changeStatusIfCurrent(
    id: string,
    expectedStatus: TenantStatus,
    nextStatus: TenantStatus,
    changedAt: Date,
  ): Promise<TenantRecord | null> {
    const result = await this.prisma.tenant.updateMany({
      where: { id, status: expectedStatus },
      data: {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
        ...(nextStatus === TenantStatus.SUSPENDED ? { suspendedAt: changedAt } : {}),
        ...(nextStatus === TenantStatus.DEACTIVATED ? { deactivatedAt: changedAt } : {}),
      },
    });

    return result.count === 1 ? this.findById(id) : null;
  }
}
