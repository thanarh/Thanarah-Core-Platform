import { StaffStatus, TenantMembershipStatus, TenantStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import { TenantMembershipRoleRepository } from '../src/tenant/tenant-membership-role.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorMembershipId = '22222222-2222-4222-8222-222222222222';
const targetMembershipId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';
const targetUserId = '55555555-5555-4555-8555-555555555555';
const roleId = '66666666-6666-4666-8666-666666666666';
const context = {
  tenantId,
  membershipId: actorMembershipId,
  platformUserId: actorId,
} as unknown as TrustedTenantContext;

describe('TenantMembershipRoleRepository', () => {
  const transaction = {
    $queryRaw: vi.fn(),
    tenant: { findUnique: vi.fn() },
    tenantMembership: { findFirst: vi.fn() },
    tenantRole: { findFirst: vi.fn() },
    tenantMembershipRole: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    staffRoleAssignment: { findFirst: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
    tenantMembership: { findFirst: vi.fn() },
    tenantMembershipRole: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    staffRoleAssignment: { findFirst: vi.fn() },
  };
  const repository = new TenantMembershipRoleRepository(prisma as unknown as PrismaService);

  beforeEach(() => vi.clearAllMocks());

  it('combines membership and active staff role permissions and de-duplicates them', async () => {
    prisma.tenantMembership.findFirst.mockResolvedValueOnce({
      roleAssignments: [
        {
          role: {
            permissions: [
              { permission: { code: 'tenant.roles.read' } },
              { permission: { code: 'tenant.members.read' } },
            ],
          },
        },
        {
          role: {
            permissions: [{ permission: { code: 'tenant.roles.read' } }],
          },
        },
      ],
      staffProfile: {
        status: StaffStatus.ACTIVE,
        roleAssignments: [
          {
            role: {
              permissions: [
                { permission: { code: 'tenant.staff.read' } },
                { permission: { code: 'tenant.roles.read' } },
              ],
            },
          },
        ],
      },
    });

    await expect(repository.resolvePermissionCodes(context)).resolves.toEqual([
      'tenant.roles.read',
      'tenant.members.read',
      'tenant.staff.read',
    ]);
    expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: actorMembershipId,
          tenantId,
          platformUserId: actorId,
          status: TenantMembershipStatus.ACTIVE,
          tenant: { is: { status: TenantStatus.ACTIVE } },
        },
        select: {
          roleAssignments: expect.any(Object),
          staffProfile: expect.any(Object),
        },
      }),
    );
  });

  it('preserves membership role grants when a membership has no staff profile', async () => {
    prisma.tenantMembership.findFirst.mockResolvedValueOnce({
      roleAssignments: [{ role: { permissions: [{ permission: { code: 'tenant.roles.read' } }] } }],
      staffProfile: null,
    });

    await expect(repository.resolvePermissionCodes(context)).resolves.toEqual([
      'tenant.roles.read',
    ]);
  });

  it.each([StaffStatus.SUSPENDED, StaffStatus.DEACTIVATED])(
    'fails closed for %s staff linked to an active membership',
    async (status) => {
      prisma.tenantMembership.findFirst.mockResolvedValueOnce({
        roleAssignments: [
          { role: { permissions: [{ permission: { code: 'tenant.roles.read' } }] } },
        ],
        staffProfile: { status, roleAssignments: [] },
      });

      await expect(repository.resolvePermissionCodes(context)).resolves.toEqual([]);
    },
  );

  it('returns no permissions when the trusted active membership is unavailable', async () => {
    prisma.tenantMembership.findFirst.mockResolvedValueOnce(null);

    await expect(repository.resolvePermissionCodes(context)).resolves.toEqual([]);
  });

  it('does not reveal membership roles when the membership belongs to another tenant', async () => {
    prisma.tenantMembership.findFirst.mockResolvedValue(null);

    await expect(repository.listForMembership(tenantId, targetMembershipId)).resolves.toBeNull();
    expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith({
      where: { id: targetMembershipId, tenantId },
      select: { id: true },
    });
    expect(prisma.tenantMembershipRole.findMany).not.toHaveBeenCalled();
  });

  it('scopes membership role assignments to active actor, active target, role, and tenant', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: tenantId }]);
    transaction.tenant.findUnique.mockResolvedValue({ status: TenantStatus.ACTIVE });
    transaction.tenantMembership.findFirst
      .mockResolvedValueOnce({ id: actorMembershipId })
      .mockResolvedValueOnce({ id: targetMembershipId, platformUserId: targetUserId });
    transaction.tenantRole.findFirst.mockResolvedValue({ id: roleId, code: 'REPORT_VIEWER' });
    transaction.tenantMembershipRole.findUnique.mockResolvedValue(null);
    transaction.tenantMembershipRole.upsert.mockResolvedValue({});

    await expect(
      repository.assign({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorId,
        targetMembershipId,
        roleId,
      }),
    ).resolves.toEqual({
      kind: 'changed',
      platformUserId: targetUserId,
      roleCode: 'REPORT_VIEWER',
    });
    expect(transaction.tenantMembership.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: actorMembershipId,
          tenantId,
          platformUserId: actorId,
          status: TenantMembershipStatus.ACTIVE,
        },
      }),
    );
    expect(transaction.tenantMembership.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: targetMembershipId,
          tenantId,
          status: TenantMembershipStatus.ACTIVE,
        },
      }),
    );
    expect(transaction.tenantRole.findFirst).toHaveBeenCalledWith({
      where: { id: roleId, tenantId },
      select: { id: true, code: true },
    });
    expect(transaction.tenantMembershipRole.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { tenantId, membershipId: targetMembershipId, tenantRoleId: roleId },
      }),
    );
  });

  it('rejects a role ID from another tenant without creating an assignment', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: tenantId }]);
    transaction.tenant.findUnique.mockResolvedValue({ status: TenantStatus.ACTIVE });
    transaction.tenantMembership.findFirst
      .mockResolvedValueOnce({ id: actorMembershipId })
      .mockResolvedValueOnce({ id: targetMembershipId, platformUserId: targetUserId });
    transaction.tenantRole.findFirst.mockResolvedValue(null);

    await expect(
      repository.assign({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorId,
        targetMembershipId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'not-found' });
    expect(transaction.tenantRole.findFirst).toHaveBeenCalledWith({
      where: { id: roleId, tenantId },
      select: { id: true, code: true },
    });
    expect(transaction.tenantMembershipRole.upsert).not.toHaveBeenCalled();
  });

  it('requires an existing owner to assign the OWNER role', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: tenantId }]);
    transaction.tenant.findUnique.mockResolvedValue({ status: TenantStatus.ACTIVE });
    transaction.tenantMembership.findFirst
      .mockResolvedValueOnce({ id: actorMembershipId })
      .mockResolvedValueOnce({ id: targetMembershipId, platformUserId: targetUserId });
    transaction.tenantRole.findFirst.mockResolvedValue({ id: roleId, code: 'OWNER' });
    transaction.tenantMembershipRole.findFirst.mockResolvedValue(null);

    await expect(
      repository.assign({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorId,
        targetMembershipId,
        roleId,
      }),
    ).resolves.toEqual({ kind: 'owner-only' });
    expect(transaction.tenantMembershipRole.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          membershipId: actorMembershipId,
          role: { is: { code: 'OWNER' } },
          membership: {
            is: {
              platformUserId: actorId,
              status: TenantMembershipStatus.ACTIVE,
              tenant: { is: { status: TenantStatus.ACTIVE } },
            },
          },
        },
      }),
    );
    expect(transaction.tenantMembershipRole.upsert).not.toHaveBeenCalled();
  });

  it('recognizes an active staff OWNER as an owner for existing membership role operations', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: tenantId }]);
    transaction.tenant.findUnique.mockResolvedValue({ status: TenantStatus.ACTIVE });
    transaction.tenantMembership.findFirst
      .mockResolvedValueOnce({ id: actorMembershipId })
      .mockResolvedValueOnce({ id: targetMembershipId, platformUserId: targetUserId });
    transaction.tenantRole.findFirst.mockResolvedValue({ id: roleId, code: 'OWNER' });
    transaction.tenantMembershipRole.findFirst.mockResolvedValue(null);
    transaction.staffRoleAssignment.findFirst.mockResolvedValue({ staffId: 'staff-id' });
    transaction.tenantMembershipRole.findUnique.mockResolvedValue(null);
    transaction.tenantMembershipRole.upsert.mockResolvedValue({});

    await expect(
      repository.assign({
        tenantId,
        actorMembershipId,
        actorPlatformUserId: actorId,
        targetMembershipId,
        roleId,
      }),
    ).resolves.toMatchObject({ kind: 'changed', roleCode: 'OWNER' });
    expect(transaction.staffRoleAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          staff: {
            is: expect.objectContaining({
              membershipId: actorMembershipId,
              userId: actorId,
              status: StaffStatus.ACTIVE,
            }),
          },
          role: { is: { code: 'OWNER' } },
        }),
      }),
    );
    expect(transaction.tenantMembershipRole.upsert).toHaveBeenCalled();
  });

  it('refuses owner-role removal and scopes other role removals to the selected tenant', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: tenantId }]);
    transaction.tenant.findUnique.mockResolvedValue({ status: TenantStatus.ACTIVE });
    transaction.tenantMembership.findFirst.mockResolvedValue({ platformUserId: targetUserId });
    transaction.tenantRole.findFirst.mockResolvedValue({ id: roleId, code: 'OWNER' });

    await expect(
      repository.remove({ tenantId, membershipId: targetMembershipId, roleId }),
    ).resolves.toEqual({ kind: 'owner-protected' });
    expect(transaction.tenantMembershipRole.deleteMany).not.toHaveBeenCalled();

    transaction.tenantRole.findFirst.mockResolvedValueOnce({
      id: roleId,
      code: 'REPORT_VIEWER',
    });
    transaction.tenantMembershipRole.deleteMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      repository.remove({ tenantId, membershipId: targetMembershipId, roleId }),
    ).resolves.toEqual({
      kind: 'changed',
      platformUserId: targetUserId,
      roleCode: 'REPORT_VIEWER',
    });
    expect(transaction.tenantMembershipRole.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, membershipId: targetMembershipId, tenantRoleId: roleId },
    });
  });
});
