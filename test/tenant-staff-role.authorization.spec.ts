import { StaffStatus, TenantMembershipStatus, TenantStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PrismaService } from '../src/database/prisma.service';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import { TenantAuthorizationService } from '../src/tenant/tenant-authorization.service';
import { TenantPermissionDeniedError } from '../src/tenant/tenant-authorization.errors';
import { TenantMembershipRoleRepository } from '../src/tenant/tenant-membership-role.repository';
import { TenantStaffRoleRepository } from '../src/tenant/tenant-staff-role.repository';
import { TenantStaffRoleService } from '../src/tenant/tenant-staff-role.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorMembershipId = '22222222-2222-4222-8222-222222222222';
const targetMembershipId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const targetUserId = '55555555-5555-4555-8555-555555555555';
const staffId = '66666666-6666-4666-8666-666666666666';
const roleId = '77777777-7777-4777-8777-777777777777';

const actorContext = {
  tenantId,
  membershipId: actorMembershipId,
  platformUserId: actorUserId,
} as unknown as TrustedTenantContext;
const targetContext = {
  tenantId,
  membershipId: targetMembershipId,
  platformUserId: targetUserId,
} as unknown as TrustedTenantContext;
const actor: AuthenticatedPlatformUser = {
  userId: actorUserId,
  sessionId: '88888888-8888-4888-8888-888888888888',
  tokenVersion: 1,
  platformRoleIds: [],
};
const rolePermissionCodes = ['tenant.branches.read'];
const rolePermissionLinks = rolePermissionCodes.map((code) => ({ permission: { code } }));
const assignmentRecord = {
  tenantId,
  staffId,
  tenantRoleId: roleId,
  assignedAt: new Date('2026-10-07T10:00:00.000Z'),
  staff: { userId: targetUserId },
  role: {
    id: roleId,
    code: 'REPORT_VIEWER',
    name: 'Report Viewer',
    description: null,
    isSystemRole: false,
  },
};

describe('staff role assignment authorization flow', () => {
  let roleAssigned: boolean;
  let membershipActive: boolean;
  const transaction = {
    $queryRaw: vi.fn(),
    tenantMembership: { findFirst: vi.fn() },
    tenantRole: { findFirst: vi.fn() },
    tenantMembershipRole: { findFirst: vi.fn() },
    staff: { findFirst: vi.fn() },
    staffRoleAssignment: {
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(),
    tenantMembership: { findFirst: vi.fn() },
  };
  const membershipLookup = prisma.tenantMembership.findFirst;
  const audit = { recordAudit: vi.fn() };
  let authorization: TenantAuthorizationService;
  let staffRoleService: TenantStaffRoleService;

  beforeEach(() => {
    vi.clearAllMocks();
    roleAssigned = false;
    membershipActive = true;
    prisma.$transaction.mockImplementation(
      (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]).mockResolvedValueOnce([
      {
        id: staffId,
        userId: targetUserId,
        staffStatus: StaffStatus.ACTIVE,
        membershipStatus: TenantMembershipStatus.ACTIVE,
        userStatus: 'ACTIVE',
      },
    ]);
    transaction.tenantMembership.findFirst.mockResolvedValue({ id: actorMembershipId });
    transaction.tenantRole.findFirst.mockResolvedValue({ id: roleId, code: 'REPORT_VIEWER' });
    transaction.tenantMembershipRole.findFirst.mockResolvedValue(null);
    transaction.staffRoleAssignment.findFirst.mockResolvedValue(null);
    transaction.staffRoleAssignment.findUnique.mockImplementation(async () =>
      roleAssigned ? { staffId } : null,
    );
    transaction.staffRoleAssignment.upsert.mockImplementation(async () => {
      roleAssigned = true;
      return assignmentRecord;
    });
    transaction.staffRoleAssignment.deleteMany.mockImplementation(async () => {
      const count = roleAssigned ? 1 : 0;
      roleAssigned = false;
      return { count };
    });
    transaction.staff.findFirst.mockResolvedValue({ id: staffId, userId: targetUserId });
    membershipLookup.mockImplementation(
      async (query: {
        where: {
          id: string;
          tenantId: string;
          platformUserId: string;
          status: TenantMembershipStatus;
          tenant: { is: { status: TenantStatus } };
        };
      }) => {
        if (
          !membershipActive ||
          query.where.id !== targetMembershipId ||
          query.where.tenantId !== tenantId ||
          query.where.platformUserId !== targetUserId ||
          query.where.status !== TenantMembershipStatus.ACTIVE ||
          query.where.tenant.is.status !== TenantStatus.ACTIVE
        ) {
          return null;
        }
        return {
          roleAssignments: [],
          staffProfile: {
            status: StaffStatus.ACTIVE,
            roleAssignments: roleAssigned ? [{ role: { permissions: rolePermissionLinks } }] : [],
          },
        };
      },
    );

    const membershipRoleRepository = new TenantMembershipRoleRepository(
      prisma as unknown as PrismaService,
    );
    const staffRoleRepository = new TenantStaffRoleRepository(prisma as unknown as PrismaService);
    audit.recordAudit.mockResolvedValue(undefined);
    authorization = new TenantAuthorizationService(
      membershipRoleRepository,
      audit as unknown as PlatformAuditService,
    );

    staffRoleService = new TenantStaffRoleService(
      staffRoleRepository,
      audit as unknown as PlatformAuditService,
    );
  });

  it('resolves role permissions through tenant authorization and removes them without stale cache', async () => {
    await expect(
      authorization.authorize(targetContext, 'tenant.branches.read'),
    ).rejects.toBeInstanceOf(TenantPermissionDeniedError);

    await staffRoleService.assign(actorContext, staffId, { roleId }, actor);
    await expect(
      authorization.authorize(targetContext, 'tenant.branches.read'),
    ).resolves.toBeUndefined();
    await expect(
      authorization.authorize(targetContext, 'tenant.facilities.update'),
    ).rejects.toBeInstanceOf(TenantPermissionDeniedError);
    expect(rolePermissionCodes).toEqual(['tenant.branches.read']);

    membershipActive = false;
    await expect(
      authorization.authorize(targetContext, 'tenant.branches.read'),
    ).rejects.toBeInstanceOf(TenantPermissionDeniedError);
    membershipActive = true;
    await expect(
      authorization.authorize(targetContext, 'tenant.branches.read'),
    ).resolves.toBeUndefined();

    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]);
    await staffRoleService.remove(actorContext, staffId, roleId, actor);
    await expect(
      authorization.authorize(targetContext, 'tenant.branches.read'),
    ).rejects.toBeInstanceOf(TenantPermissionDeniedError);
    expect(rolePermissionCodes).toEqual(['tenant.branches.read']);
    expect(transaction.staffRoleAssignment.upsert).toHaveBeenCalledOnce();
    expect(transaction.staffRoleAssignment.deleteMany).toHaveBeenCalledOnce();
    expect(membershipLookup).toHaveBeenCalledTimes(6);
  });
});
