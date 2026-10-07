import { StaffStatus, TenantMembershipStatus, TenantStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import type { TenantStaffRoleAssignmentRecord } from '../src/tenant/tenant-staff-role.repository';
import { TenantStaffRoleRepository } from '../src/tenant/tenant-staff-role.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorMembershipId = '22222222-2222-4222-8222-222222222222';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const targetUserId = '55555555-5555-4555-8555-555555555555';
const staffId = '66666666-6666-4666-8666-666666666666';
const roleId = '77777777-7777-4777-8777-777777777777';
const fixedTime = new Date('2026-10-07T10:00:00.000Z');

const assignment: TenantStaffRoleAssignmentRecord = {
  tenantId,
  staffId,
  tenantRoleId: roleId,
  assignedAt: fixedTime,
  staff: { userId: targetUserId },
  role: {
    id: roleId,
    code: 'REPORT_VIEWER',
    name: 'Report Viewer',
    description: null,
    isSystemRole: false,
  },
};

const activeStaffRow = {
  id: staffId,
  userId: targetUserId,
  staffStatus: StaffStatus.ACTIVE,
  membershipStatus: TenantMembershipStatus.ACTIVE,
  userStatus: 'ACTIVE',
};

describe('TenantStaffRoleRepository', () => {
  const transaction = {
    $queryRaw: vi.fn(),
    tenantMembership: { findFirst: vi.fn() },
    tenantRole: { findFirst: vi.fn() },
    tenantMembershipRole: { findFirst: vi.fn() },
    staff: { findFirst: vi.fn() },
    staffRoleAssignment: {
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(),
    staff: { findFirst: vi.fn() },
    staffRoleAssignment: { findMany: vi.fn() },
  };
  let repository: TenantStaffRoleRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([activeStaffRow]);
    transaction.tenantMembership.findFirst.mockResolvedValue({ id: actorMembershipId });
    transaction.tenantRole.findFirst.mockResolvedValue({ id: roleId, code: 'REPORT_VIEWER' });
    transaction.tenantMembershipRole.findFirst.mockResolvedValue(null);
    transaction.staffRoleAssignment.findFirst.mockResolvedValue(null);
    transaction.staffRoleAssignment.findUnique.mockResolvedValue(null);
    transaction.staffRoleAssignment.upsert.mockResolvedValue(assignment);
    transaction.staff.findFirst.mockResolvedValue({ id: staffId, userId: targetUserId });
    transaction.staffRoleAssignment.deleteMany.mockResolvedValue({ count: 1 });
    prisma.staff.findFirst.mockResolvedValue({ id: staffId });
    prisma.staffRoleAssignment.findMany.mockResolvedValue([assignment]);
    repository = new TenantStaffRoleRepository(prisma as unknown as PrismaService);
  });

  it('lists only assignments for the requested tenant and staff profile', async () => {
    await expect(repository.listForStaff(tenantId, staffId)).resolves.toEqual([assignment]);
    expect(prisma.staff.findFirst).toHaveBeenCalledWith({
      where: {
        id: staffId,
        tenantId,
        tenant: { is: { status: TenantStatus.ACTIVE } },
      },
      select: { id: true },
    });
    expect(prisma.staffRoleAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, staffId } }),
    );
  });

  it('returns not found without querying assignments for a staff ID outside the tenant', async () => {
    prisma.staff.findFirst.mockResolvedValueOnce(null);

    await expect(repository.listForStaff(tenantId, staffId)).resolves.toBeNull();
    expect(prisma.staffRoleAssignment.findMany).not.toHaveBeenCalled();
  });

  it('assigns a same-tenant role after checking active actor, staff, membership, and user', async () => {
    await expect(
      repository.assign({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'changed', assignment });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.tenantMembership.findFirst).toHaveBeenCalledWith({
      where: {
        id: actorMembershipId,
        tenantId,
        platformUserId: actorUserId,
        status: TenantMembershipStatus.ACTIVE,
        tenant: { is: { status: TenantStatus.ACTIVE } },
      },
      select: { id: true },
    });
    expect(transaction.tenantRole.findFirst).toHaveBeenCalledWith({
      where: { id: roleId, tenantId },
      select: { id: true, code: true },
    });
    expect(transaction.staffRoleAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { tenantId, staffId, tenantRoleId: roleId },
      }),
    );
  });

  it('handles an existing assignment idempotently without treating it as a mutation', async () => {
    transaction.staffRoleAssignment.findUnique.mockResolvedValueOnce({ staffId });

    await expect(
      repository.assign({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'already-assigned', assignment });
  });

  it('rejects an out-of-tenant or membership-mismatched staff ID before assigning a role', async () => {
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([]);

    await expect(
      repository.assign({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'not-found' });
    expect(transaction.$queryRaw.mock.calls[1][0]).toMatchObject({
      sql: expect.stringContaining('`membership`.`platformUserId` = `staff`.`userId`'),
    });
    expect(transaction.tenantRole.findFirst).not.toHaveBeenCalled();
    expect(transaction.staffRoleAssignment.upsert).not.toHaveBeenCalled();
  });

  it.each([
    { staffStatus: StaffStatus.SUSPENDED, membershipStatus: TenantMembershipStatus.ACTIVE },
    { staffStatus: StaffStatus.ACTIVE, membershipStatus: TenantMembershipStatus.REMOVED },
    {
      staffStatus: StaffStatus.ACTIVE,
      membershipStatus: TenantMembershipStatus.ACTIVE,
      userStatus: 'INACTIVE',
    },
  ])('rejects ineligible staff, membership, or platform user', async (override) => {
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([{ ...activeStaffRow, ...override }]);

    await expect(
      repository.assign({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'staff-ineligible' });
    expect(transaction.staffRoleAssignment.upsert).not.toHaveBeenCalled();
  });

  it('rejects a role ID from another tenant without creating an assignment', async () => {
    transaction.tenantRole.findFirst.mockResolvedValueOnce(null);

    await expect(
      repository.assign({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'not-found' });
    expect(transaction.staffRoleAssignment.upsert).not.toHaveBeenCalled();
  });

  it('prevents self-assignment', async () => {
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([{ ...activeStaffRow, userId: actorUserId }]);

    await expect(
      repository.assign({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'self-assignment' });
    expect(transaction.tenantRole.findFirst).not.toHaveBeenCalled();
  });

  it('allows OWNER role assignment only when an existing owner role is active', async () => {
    transaction.tenantRole.findFirst.mockResolvedValueOnce({ id: roleId, code: 'OWNER' });

    await expect(
      repository.assign({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toMatchObject({ kind: 'owner-only' });
    expect(transaction.staffRoleAssignment.upsert).not.toHaveBeenCalled();
  });

  it('refuses to remove OWNER and removes only the selected assignment', async () => {
    transaction.tenantRole.findFirst.mockResolvedValueOnce({ id: roleId, code: 'OWNER' });

    await expect(
      repository.remove({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'owner-protected' });
    expect(transaction.staffRoleAssignment.deleteMany).not.toHaveBeenCalled();

    transaction.tenantRole.findFirst.mockResolvedValueOnce({ id: roleId, code: 'REPORT_VIEWER' });
    await expect(
      repository.remove({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'changed', userId: targetUserId, roleCode: 'REPORT_VIEWER' });
    expect(transaction.staffRoleAssignment.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, staffId, tenantRoleId: roleId },
    });
  });

  it('does not turn removal of a missing assignment into a successful mutation', async () => {
    transaction.staffRoleAssignment.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      repository.remove({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'not-assigned' });
  });

  it('does not remove an assignment using a staff or role ID from another tenant', async () => {
    transaction.staff.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.remove({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'not-found' });

    transaction.tenantRole.findFirst.mockResolvedValueOnce(null);
    await expect(
      repository.remove({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorUserId,
        staffId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'not-found' });
    expect(transaction.staffRoleAssignment.deleteMany).not.toHaveBeenCalled();
  });
});
