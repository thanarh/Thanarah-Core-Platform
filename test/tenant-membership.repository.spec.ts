import { TenantMembershipStatus, TenantStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { TenantMembershipRepository } from '../src/tenant/tenant-membership.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const platformUserId = '22222222-2222-4222-8222-222222222222';
const membershipId = '33333333-3333-4333-8333-333333333333';
const timestamp = new Date('2026-10-05T12:00:00.000Z');

function membership(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: membershipId,
    tenantId,
    platformUserId,
    status: TenantMembershipStatus.INVITED,
    statusChangedAt: timestamp,
    activatedAt: null,
    suspendedAt: null,
    removedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('TenantMembershipRepository', () => {
  const transaction = {
    $queryRaw: vi.fn(),
    tenantMembership: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    tenantMembershipRole: {
      findFirst: vi.fn(),
    },
  };
  const prisma = {
    ...transaction,
    $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  };
  const repository = new TenantMembershipRepository(prisma as unknown as PrismaService);

  beforeEach(() => vi.clearAllMocks());

  it('creates only the tenant/user relationship and relies on INVITED as the database default', async () => {
    prisma.tenantMembership.create.mockResolvedValue(membership());

    await repository.create({ tenantId, platformUserId });

    expect(prisma.tenantMembership.create).toHaveBeenCalledWith({
      data: { tenantId, platformUserId },
      select: expect.objectContaining({
        id: true,
        tenantId: true,
        platformUserId: true,
        status: true,
      }),
    });
  });

  it('looks up memberships by the unique tenant/platform-user pair', async () => {
    prisma.tenantMembership.findUnique.mockResolvedValue(membership());

    await repository.findByTenantAndPlatformUser(tenantId, platformUserId);

    expect(prisma.tenantMembership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_platformUserId: { tenantId, platformUserId } },
      }),
    );
  });

  it('validates active membership and tenant state in one tenant-scoped lookup', async () => {
    prisma.tenantMembership.findFirst.mockResolvedValue(null);

    await repository.findActiveForTenantAndPlatformUser(tenantId, platformUserId);

    expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          platformUserId,
          status: TenantMembershipStatus.ACTIVE,
          tenant: { is: { status: TenantStatus.ACTIVE } },
        },
      }),
    );
  });

  it('lists only the authenticated user’s active memberships in active tenants', async () => {
    prisma.tenantMembership.findMany.mockResolvedValue([]);

    await repository.listActiveForPlatformUser(platformUserId);

    expect(prisma.tenantMembership.findMany).toHaveBeenCalledWith({
      where: {
        platformUserId,
        status: TenantMembershipStatus.ACTIVE,
        tenant: { is: { status: TenantStatus.ACTIVE } },
      },
      orderBy: [{ tenantId: 'asc' }],
      select: {
        id: true,
        tenantId: true,
        tenant: { select: { displayName: true, slug: true } },
      },
    });
  });

  it('scopes membership IDs to the requested tenant', async () => {
    prisma.tenantMembership.findFirst.mockResolvedValue(null);
    const otherTenantId = '44444444-4444-4444-8444-444444444444';

    await repository.findByIdForTenant(membershipId, otherTenantId);

    expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: membershipId, tenantId: otherTenantId },
      }),
    );
  });

  it('lists only the selected tenant and status with stable bounded ordering', async () => {
    prisma.tenantMembership.findMany.mockResolvedValue([]);

    await repository.listForTenant({
      tenantId,
      status: TenantMembershipStatus.SUSPENDED,
      limit: 20,
      offset: 5,
    });

    expect(prisma.tenantMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, status: TenantMembershipStatus.SUSPENDED },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 5,
        take: 20,
      }),
    );
  });

  it('uses tenant, membership, and current status together for lifecycle writes', async () => {
    const otherTenantId = '44444444-4444-4444-8444-444444444444';
    prisma.$queryRaw.mockResolvedValue([{ id: otherTenantId }]);
    prisma.tenantMembership.findFirst
      .mockResolvedValueOnce({ id: membershipId })
      .mockResolvedValueOnce(
        membership({ status: TenantMembershipStatus.ACTIVE, activatedAt: timestamp }),
      );
    prisma.tenantMembership.updateMany.mockResolvedValue({ count: 1 });

    const result = await repository.changeStatusIfCurrent(
      membershipId,
      otherTenantId,
      TenantMembershipStatus.INVITED,
      TenantMembershipStatus.ACTIVE,
      timestamp,
    );

    expect(result).toMatchObject({
      kind: 'updated',
      membership: { status: TenantMembershipStatus.ACTIVE },
    });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.tenantMembership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: membershipId,
          tenantId: otherTenantId,
          status: TenantMembershipStatus.INVITED,
        },
        data: expect.objectContaining({
          status: TenantMembershipStatus.ACTIVE,
          statusChangedAt: timestamp,
          activatedAt: timestamp,
          updatedAt: timestamp,
        }),
      }),
    );
    expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: membershipId, tenantId: otherTenantId },
        select: expect.objectContaining({ status: true }),
      }),
    );
  });

  it('locks tenant lifecycle writes and refuses to deactivate an assigned owner', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: tenantId }]);
    prisma.tenantMembership.findFirst.mockResolvedValueOnce({ id: membershipId });
    prisma.tenantMembershipRole.findFirst.mockResolvedValue({ membershipId });

    const result = await repository.changeStatusIfCurrent(
      membershipId,
      tenantId,
      TenantMembershipStatus.ACTIVE,
      TenantMembershipStatus.SUSPENDED,
      timestamp,
    );

    expect(result).toEqual({ kind: 'owner-protected' });
    expect(prisma.tenantMembershipRole.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          membershipId,
          tenantId,
          role: { is: { code: 'OWNER' } },
        },
      }),
    );
    expect(prisma.tenantMembership.updateMany).not.toHaveBeenCalled();
  });

  it('satisfies the active-membership contract only for ACTIVE rows on the exact pair', async () => {
    prisma.tenantMembership.findUnique.mockResolvedValueOnce({
      status: TenantMembershipStatus.ACTIVE,
    });
    prisma.tenantMembership.findUnique.mockResolvedValueOnce({
      status: TenantMembershipStatus.SUSPENDED,
    });
    prisma.tenantMembership.findUnique.mockResolvedValueOnce({
      status: TenantMembershipStatus.REMOVED,
    });

    await expect(repository.hasActiveMembership(tenantId, platformUserId)).resolves.toBe(true);
    await expect(repository.hasActiveMembership(tenantId, platformUserId)).resolves.toBe(false);
    await expect(repository.hasActiveMembership(tenantId, platformUserId)).resolves.toBe(false);

    expect(prisma.tenantMembership.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { tenantId_platformUserId: { tenantId, platformUserId } },
        select: { status: true },
      }),
    );
  });
});
