import { FacilityStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { FacilityRepository } from '../src/tenant/facility.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const facilityId = '22222222-2222-4222-8222-222222222222';
const timestamp = new Date('2026-10-06T10:00:00.000Z');

describe('FacilityRepository', () => {
  const prisma = {
    facility: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const repository = new FacilityRepository(prisma as unknown as PrismaService);

  beforeEach(() => vi.clearAllMocks());

  it('creates a facility with the supplied tenant scope and allowed data', async () => {
    prisma.facility.create.mockResolvedValue({ id: facilityId });

    await repository.create(tenantId, { name: 'North Clinic' });

    expect(prisma.facility.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { tenantId, name: 'North Clinic' },
        select: expect.objectContaining({
          id: true,
          tenantId: true,
          status: true,
        }),
      }),
    );
  });

  it('scopes facility lookup by both tenant and facility identifiers', async () => {
    prisma.facility.findFirst.mockResolvedValue(null);

    await repository.findById(tenantId, facilityId);

    expect(prisma.facility.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: facilityId } }),
    );
  });

  it('lists only the trusted tenant facilities with stable ordering and bounded pagination', async () => {
    prisma.facility.findMany.mockResolvedValue([]);

    await repository.listForTenant(tenantId, {
      status: FacilityStatus.SUSPENDED,
      limit: 25,
      offset: 50,
    });

    expect(prisma.facility.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, status: FacilityStatus.SUSPENDED },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 50,
        take: 25,
      }),
    );
  });

  it('updates names only within the supplied tenant scope', async () => {
    prisma.facility.updateMany.mockResolvedValue({ count: 1 });
    prisma.facility.findFirst.mockResolvedValue({ id: facilityId });

    await repository.updateName(tenantId, facilityId, 'Updated Clinic');

    expect(prisma.facility.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, id: facilityId },
        data: { name: 'Updated Clinic' },
      }),
    );
    expect(prisma.facility.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: facilityId } }),
    );
  });

  it('uses tenant-scoped optimistic status matching and does not reread after a stale write', async () => {
    prisma.facility.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.changeStatusIfCurrent(
        tenantId,
        facilityId,
        FacilityStatus.ACTIVE,
        FacilityStatus.DEACTIVATED,
        timestamp,
      ),
    ).resolves.toBeNull();

    expect(prisma.facility.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, id: facilityId, status: FacilityStatus.ACTIVE },
        data: {
          status: FacilityStatus.DEACTIVATED,
          statusChangedAt: timestamp,
          updatedAt: timestamp,
          deactivatedAt: timestamp,
        },
      }),
    );
    expect(prisma.facility.findFirst).not.toHaveBeenCalled();
  });

  it('returns a not-found result for a name update outside the tenant without an unscoped query', async () => {
    prisma.facility.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.updateName(tenantId, facilityId, 'Other tenant facility'),
    ).resolves.toBeNull();

    expect(prisma.facility.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: facilityId } }),
    );
    expect(prisma.facility.findFirst).not.toHaveBeenCalled();
  });
});
