import { Injectable } from '@nestjs/common';
import { Prisma, TenantMembershipStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const tenantMembershipSelect = {
  id: true,
  tenantId: true,
  platformUserId: true,
  status: true,
  statusChangedAt: true,
  activatedAt: true,
  suspendedAt: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantMembershipSelect;

export type TenantMembershipRecord = Prisma.TenantMembershipGetPayload<{
  select: typeof tenantMembershipSelect;
}>;

export interface TenantMembershipListFilter {
  tenantId: string;
  status?: TenantMembershipStatus;
  limit: number;
  offset: number;
}

@Injectable()
export class TenantMembershipRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: { tenantId: string; platformUserId: string }): Promise<TenantMembershipRecord> {
    return this.prisma.tenantMembership.create({
      data: input,
      select: tenantMembershipSelect,
    });
  }

  findByTenantAndPlatformUser(
    tenantId: string,
    platformUserId: string,
  ): Promise<TenantMembershipRecord | null> {
    return this.prisma.tenantMembership.findUnique({
      where: {
        tenantId_platformUserId: { tenantId, platformUserId },
      },
      select: tenantMembershipSelect,
    });
  }

  findByIdForTenant(id: string, tenantId: string): Promise<TenantMembershipRecord | null> {
    return this.prisma.tenantMembership.findFirst({
      where: { id, tenantId },
      select: tenantMembershipSelect,
    });
  }

  listForTenant(filter: TenantMembershipListFilter): Promise<TenantMembershipRecord[]> {
    return this.prisma.tenantMembership.findMany({
      where: {
        tenantId: filter.tenantId,
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.offset,
      take: filter.limit,
      select: tenantMembershipSelect,
    });
  }

  async changeStatusIfCurrent(
    id: string,
    tenantId: string,
    expectedStatus: TenantMembershipStatus,
    nextStatus: TenantMembershipStatus,
    changedAt: Date,
  ): Promise<TenantMembershipRecord | null> {
    const result = await this.prisma.tenantMembership.updateMany({
      where: { id, tenantId, status: expectedStatus },
      data: {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
        ...(nextStatus === TenantMembershipStatus.ACTIVE ? { activatedAt: changedAt } : {}),
        ...(nextStatus === TenantMembershipStatus.SUSPENDED ? { suspendedAt: changedAt } : {}),
        ...(nextStatus === TenantMembershipStatus.REMOVED ? { removedAt: changedAt } : {}),
      },
    });

    return result.count === 1 ? this.findByIdForTenant(id, tenantId) : null;
  }

  async hasActiveMembership(tenantId: string, platformUserId: string): Promise<boolean> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: {
        tenantId_platformUserId: { tenantId, platformUserId },
      },
      select: { status: true },
    });

    return membership?.status === TenantMembershipStatus.ACTIVE;
  }
}
