import { Injectable } from '@nestjs/common';
import { Prisma, TenantMembershipStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  TenantMembershipDirectoryRecord,
  TenantMembershipListFilter,
  TenantMembershipPersistencePort,
  TenantMembershipRecord,
  TenantMembershipStatusChangeResult,
  TenantWorkspaceMembershipRecord,
} from '../persistence/platform-persistence.ports';

export type {
  TenantMembershipDirectoryRecord,
  TenantMembershipListFilter,
  TenantMembershipRecord,
  TenantMembershipStatusChangeResult,
  TenantWorkspaceMembershipRecord,
} from '../persistence/platform-persistence.ports';

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

const tenantMembershipDirectorySelect = {
  id: true,
  tenantId: true,
  platformUserId: true,
  status: true,
  statusChangedAt: true,
  createdAt: true,
  platformUser: { select: { fullName: true, status: true } },
} satisfies Prisma.TenantMembershipSelect;

const tenantWorkspaceMembershipSelect = {
  id: true,
  tenantId: true,
  tenant: {
    select: {
      displayName: true,
      slug: true,
    },
  },
} satisfies Prisma.TenantMembershipSelect;

@Injectable()
export class TenantMembershipRepository implements TenantMembershipPersistencePort {
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

  findActiveForTenantAndPlatformUser(
    tenantId: string,
    platformUserId: string,
  ): Promise<TenantMembershipRecord | null> {
    return this.prisma.tenantMembership.findFirst({
      where: {
        tenantId,
        platformUserId,
        status: TenantMembershipStatus.ACTIVE,
        tenant: { is: { status: TenantStatus.ACTIVE } },
      },
      select: tenantMembershipSelect,
    });
  }

  listActiveForPlatformUser(platformUserId: string): Promise<TenantWorkspaceMembershipRecord[]> {
    return this.prisma.tenantMembership.findMany({
      where: {
        platformUserId,
        status: TenantMembershipStatus.ACTIVE,
        tenant: { is: { status: TenantStatus.ACTIVE } },
      },
      orderBy: [{ tenantId: 'asc' }],
      select: tenantWorkspaceMembershipSelect,
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

  listDirectoryForTenant(
    filter: TenantMembershipListFilter,
  ): Promise<TenantMembershipDirectoryRecord[]> {
    return this.prisma.tenantMembership.findMany({
      where: {
        tenantId: filter.tenantId,
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.offset,
      take: filter.limit,
      select: tenantMembershipDirectorySelect,
    });
  }

  async changeStatusIfCurrent(
    id: string,
    tenantId: string,
    expectedStatus: TenantMembershipStatus,
    nextStatus: TenantMembershipStatus,
    changedAt: Date,
  ): Promise<TenantMembershipStatusChangeResult> {
    return this.prisma.$transaction(async (transaction) => {
      const lockedTenant = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT \`id\` FROM \`Tenant\` WHERE \`id\` = ${tenantId} FOR UPDATE`,
      );
      if (lockedTenant.length === 0) return { kind: 'stale' };

      const current = await transaction.tenantMembership.findFirst({
        where: { id, tenantId, status: expectedStatus },
        select: { id: true },
      });
      if (!current) return { kind: 'stale' };

      if (nextStatus !== TenantMembershipStatus.ACTIVE) {
        const ownerAssignment = await transaction.tenantMembershipRole.findFirst({
          where: {
            membershipId: id,
            tenantId,
            role: { is: { code: 'OWNER' } },
          },
          select: { membershipId: true },
        });
        if (ownerAssignment) return { kind: 'owner-protected' };
      }

      const result = await transaction.tenantMembership.updateMany({
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
      if (result.count !== 1) return { kind: 'stale' };

      const membership = await transaction.tenantMembership.findFirst({
        where: { id, tenantId },
        select: tenantMembershipSelect,
      });
      return membership ? { kind: 'updated', membership } : { kind: 'stale' };
    });
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
