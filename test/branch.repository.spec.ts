import { BranchStatus, FacilityStatus, TenantStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { BranchRepository } from '../src/tenant/branch.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const facilityId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const timestamp = new Date('2026-10-06T10:00:00.000Z');

describe('BranchRepository', () => {
  const transaction = {
    $queryRaw: vi.fn(),
    branch: { create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
    facility: { findFirst: vi.fn() },
    branch: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const repository = new BranchRepository(prisma as unknown as PrismaService);

  beforeEach(() => vi.clearAllMocks());

  it('resolves a Facility only when it belongs to the trusted tenant', async () => {
    prisma.facility.findFirst.mockResolvedValue(null);

    await repository.findFacilityScope(tenantId, facilityId);

    expect(prisma.facility.findFirst).toHaveBeenCalledWith({
      where: { id: facilityId, tenantId },
      select: {
        id: true,
        status: true,
        tenant: { select: { status: true } },
      },
    });
  });

  it('locks the active tenant and Facility before creating without a client-supplied owner', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: facilityId }]);
    transaction.branch.create.mockResolvedValue({ id: branchId, facilityId });

    await repository.createUnderActiveFacility(tenantId, facilityId, { name: 'East Wing' });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    const lockQuery = transaction.$queryRaw.mock.calls[0][0];
    expect(lockQuery.sql).toContain('INNER JOIN `Tenant`');
    expect(lockQuery.sql).toContain("`facility`.`status` = 'ACTIVE'");
    expect(lockQuery.sql).toContain("`tenant`.`status` = 'ACTIVE'");
    expect(lockQuery.values).toEqual([facilityId, tenantId]);
    expect(transaction.branch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { facilityId, name: 'East Wing' },
        select: expect.objectContaining({ id: true, facilityId: true, status: true }),
      }),
    );
    expect(transaction.branch.create.mock.calls[0][0].data).not.toHaveProperty('tenantId');
  });

  it('does not create when the Facility or its Tenant is no longer active', async () => {
    transaction.$queryRaw.mockResolvedValue([]);

    await expect(
      repository.createUnderActiveFacility(tenantId, facilityId, { name: 'East Wing' }),
    ).resolves.toBeNull();

    expect(transaction.branch.create).not.toHaveBeenCalled();
  });

  it('lists Branches only through the active Facility-to-Tenant relationship', async () => {
    prisma.branch.findMany.mockResolvedValue([]);

    await repository.listForFacility(tenantId, facilityId, {
      status: BranchStatus.SUSPENDED,
      limit: 25,
      offset: 50,
    });

    expect(prisma.branch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          facilityId,
          facility: {
            is: {
              id: facilityId,
              tenantId,
              status: FacilityStatus.ACTIVE,
              tenant: { is: { status: TenantStatus.ACTIVE } },
            },
          },
          status: BranchStatus.SUSPENDED,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 50,
        take: 25,
      }),
    );
  });

  it('requires tenant, Facility, and Branch identifiers in a single scoped lookup', async () => {
    prisma.branch.findFirst.mockResolvedValue(null);

    await repository.findByIdWithinFacility(tenantId, facilityId, branchId);

    expect(prisma.branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: branchId,
          facilityId,
          facility: {
            is: {
              id: facilityId,
              tenantId,
              status: FacilityStatus.ACTIVE,
              tenant: { is: { status: TenantStatus.ACTIVE } },
            },
          },
        },
      }),
    );
  });

  it('updates only a Branch found through the requested Facility and tenant', async () => {
    prisma.branch.updateMany.mockResolvedValue({ count: 1 });
    prisma.branch.findFirst.mockResolvedValue({ id: branchId });

    await repository.updateNameWithinFacility(tenantId, facilityId, branchId, 'West Wing');

    expect(prisma.branch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: branchId,
          facilityId,
          facility: expect.objectContaining({
            is: expect.objectContaining({ id: facilityId, tenantId }),
          }),
        }),
        data: { name: 'West Wing' },
      }),
    );
    expect(prisma.branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: branchId, facilityId }),
      }),
    );
  });

  it('uses conditional status updates and records lifecycle timestamps', async () => {
    prisma.branch.updateMany.mockResolvedValue({ count: 1 });
    prisma.branch.findFirst.mockResolvedValue({ id: branchId });

    await repository.changeStatusIfCurrentWithinFacility(
      tenantId,
      facilityId,
      branchId,
      BranchStatus.ACTIVE,
      BranchStatus.SUSPENDED,
      timestamp,
    );

    expect(prisma.branch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: branchId,
          facilityId,
          status: BranchStatus.ACTIVE,
          facility: expect.objectContaining({
            is: expect.objectContaining({
              id: facilityId,
              tenantId,
              status: FacilityStatus.ACTIVE,
            }),
          }),
        }),
        data: {
          status: BranchStatus.SUSPENDED,
          statusChangedAt: timestamp,
          updatedAt: timestamp,
          suspendedAt: timestamp,
        },
      }),
    );
  });

  it('does not perform an unscoped reread when a concurrent status update wins', async () => {
    prisma.branch.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.changeStatusIfCurrentWithinFacility(
        tenantId,
        facilityId,
        branchId,
        BranchStatus.ACTIVE,
        BranchStatus.DEACTIVATED,
        timestamp,
      ),
    ).resolves.toBeNull();

    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });
});
