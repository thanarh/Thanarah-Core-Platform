import { StaffStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import {
  TenantStaffRepository,
  type TenantStaffRecord,
} from '../src/tenant/tenant-staff.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const staffUserId = '33333333-3333-4333-8333-333333333333';
const staffId = '44444444-4444-4444-8444-444444444444';
const fixedTime = new Date('2026-10-06T10:00:00.000Z');

const staffRecord: TenantStaffRecord = {
  id: staffId,
  tenantId,
  userId: staffUserId,
  membershipId,
  displayName: 'Taylor Member',
  jobTitle: null,
  status: StaffStatus.ACTIVE,
  statusChangedAt: fixedTime,
  suspendedAt: null,
  deactivatedAt: null,
  createdAt: fixedTime,
  updatedAt: fixedTime,
};

describe('TenantStaffRepository', () => {
  const transaction = {
    $queryRaw: vi.fn(),
    staff: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(),
  };
  let repository: TenantStaffRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([
        { id: membershipId, platformUserId: staffUserId, fullName: 'Taylor Member' },
      ]);
    transaction.staff.findUnique.mockResolvedValue(null);
    transaction.staff.create.mockResolvedValue(staffRecord);
    prisma.$transaction.mockImplementation(
      (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    repository = new TenantStaffRepository(prisma as unknown as PrismaService);
  });

  it('derives the platform user from an active membership while locking the tenant and member', async () => {
    const result = await repository.createForActiveMembership(tenantId, membershipId, {
      jobTitle: 'Coordinator',
    });

    expect(result).toEqual({ kind: 'created', staff: staffRecord });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.staff.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tenantId,
          userId: staffUserId,
          membershipId,
          displayName: 'Taylor Member',
          jobTitle: 'Coordinator',
        },
      }),
    );
  });

  it('does not create a profile when the membership or platform user is ineligible', async () => {
    transaction.$queryRaw.mockReset();
    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]).mockResolvedValueOnce([]);

    const result = await repository.createForActiveMembership(tenantId, membershipId, {});

    expect(result).toEqual({ kind: 'membership-ineligible' });
    expect(transaction.staff.create).not.toHaveBeenCalled();
  });

  it('stops before membership lookup when the tenant is inactive or missing', async () => {
    transaction.$queryRaw.mockReset().mockResolvedValueOnce([]);

    const result = await repository.createForActiveMembership(tenantId, membershipId, {});

    expect(result).toEqual({ kind: 'tenant-unavailable' });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.staff.create).not.toHaveBeenCalled();
  });

  it('treats an existing tenant-user profile as a duplicate', async () => {
    transaction.staff.findUnique.mockResolvedValueOnce({ id: staffId });

    const result = await repository.createForActiveMembership(tenantId, membershipId, {});

    expect(result).toEqual({ kind: 'already-exists' });
    expect(transaction.staff.create).not.toHaveBeenCalled();
  });
});
