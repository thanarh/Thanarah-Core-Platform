import { PlatformAuditEventType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import {
  TenantOwnerAssignmentForbiddenError,
  TenantOwnerProtectionError,
} from '../src/tenant/tenant-authorization.errors';
import {
  TenantStaffRoleAssignmentConflictError,
  TenantStaffRoleAssignmentInputValidationError,
  TenantStaffRoleAssignmentNotFoundError,
  TenantStaffRoleSelfAssignmentError,
} from '../src/tenant/tenant-staff-role.errors';
import type {
  TenantStaffRoleAssignmentRecord,
  TenantStaffRoleRepository,
} from '../src/tenant/tenant-staff-role.repository';
import { TenantStaffRoleService } from '../src/tenant/tenant-staff-role.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorMembershipId = '22222222-2222-4222-8222-222222222222';
const staffId = '33333333-3333-4333-8333-333333333333';
const roleId = '44444444-4444-4444-8444-444444444444';
const actorUserId = '55555555-5555-4555-8555-555555555555';
const targetUserId = '66666666-6666-4666-8666-666666666666';
const assignedAt = new Date('2026-10-07T10:00:00.000Z');

const context = {
  tenantId,
  membershipId: actorMembershipId,
  platformUserId: actorUserId,
} as unknown as TrustedTenantContext;
const actor: AuthenticatedPlatformUser = {
  userId: actorUserId,
  sessionId: '77777777-7777-4777-8777-777777777777',
  tokenVersion: 1,
  platformRoleIds: [],
};
const record: TenantStaffRoleAssignmentRecord = {
  tenantId,
  staffId,
  tenantRoleId: roleId,
  assignedAt,
  staff: { userId: targetUserId },
  role: {
    id: roleId,
    code: 'REPORT_VIEWER',
    name: 'Report Viewer',
    description: null,
    isSystemRole: false,
  },
};

describe('TenantStaffRoleService', () => {
  const assignments = {
    listForStaff: vi.fn(),
    assign: vi.fn(),
    remove: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  let service: TenantStaffRoleService;

  beforeEach(() => {
    vi.clearAllMocks();
    assignments.listForStaff.mockResolvedValue([record]);
    assignments.assign.mockResolvedValue({ kind: 'changed', assignment: record });
    assignments.remove.mockResolvedValue({
      kind: 'changed',
      userId: targetUserId,
      roleCode: 'REPORT_VIEWER',
    });
    audit.recordAudit.mockResolvedValue(undefined);
    service = new TenantStaffRoleService(
      assignments as unknown as TenantStaffRoleRepository,
      audit as unknown as PlatformAuditService,
    );
  });

  it('returns a safe role assignment representation for a tenant staff profile', async () => {
    await expect(service.list(context, staffId)).resolves.toEqual({
      items: [
        {
          staffId,
          roleId,
          roleCode: 'REPORT_VIEWER',
          roleName: 'Report Viewer',
          roleDescription: null,
          isSystemRole: false,
          assignedAt,
        },
      ],
    });
    expect(assignments.listForStaff).toHaveBeenCalledWith(tenantId, staffId);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('audits a successful role assignment with trusted actor, tenant, staff, and role', async () => {
    await expect(service.assign(context, staffId, { roleId }, actor)).resolves.toMatchObject({
      staffId,
      roleId,
      roleCode: 'REPORT_VIEWER',
    });
    expect(assignments.assign).toHaveBeenCalledWith({
      tenantId,
      actorMembershipId,
      actorPlatformUserId: actorUserId,
      staffId,
      roleId,
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.STAFF_ROLE_ASSIGNED,
        actorUserId,
        subjectUserId: targetUserId,
        subjectTenantId: tenantId,
        metadata: {
          staffId,
          roleId,
          roleCode: 'REPORT_VIEWER',
          result: 'assigned',
        },
      }),
    );
  });

  it('treats duplicate role assignment as idempotent without a second audit', async () => {
    assignments.assign.mockResolvedValueOnce({ kind: 'already-assigned', assignment: record });

    await expect(service.assign(context, staffId, { roleId }, actor)).resolves.toMatchObject({
      roleId,
    });
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    ['not-found', TenantStaffRoleAssignmentNotFoundError],
    ['staff-ineligible', TenantStaffRoleAssignmentConflictError],
    ['self-assignment', TenantStaffRoleSelfAssignmentError],
    ['owner-only', TenantOwnerAssignmentForbiddenError],
  ] as const)(
    'maps %s assignment results without false success audits',
    async (kind, ErrorType) => {
      assignments.assign.mockResolvedValueOnce({ kind });

      await expect(service.assign(context, staffId, { roleId }, actor)).rejects.toBeInstanceOf(
        ErrorType,
      );
      expect(audit.recordAudit).not.toHaveBeenCalled();
    },
  );

  it('rejects extra client-supplied authority fields', async () => {
    const injected = { roleId, tenantId, permissionIds: ['platform.manage'] };

    await expect(service.assign(context, staffId, injected as never, actor)).rejects.toBeInstanceOf(
      TenantStaffRoleAssignmentInputValidationError,
    );
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('audits successful removal and changes no role definition', async () => {
    await expect(service.remove(context, staffId, roleId, actor)).resolves.toBeUndefined();
    expect(assignments.remove).toHaveBeenCalledWith({
      tenantId,
      actorMembershipId,
      actorPlatformUserId: actorUserId,
      staffId,
      roleId,
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.STAFF_ROLE_REMOVED,
        actorUserId,
        subjectUserId: targetUserId,
        subjectTenantId: tenantId,
        metadata: {
          staffId,
          roleId,
          roleCode: 'REPORT_VIEWER',
          result: 'removed',
        },
      }),
    );
  });

  it('does not audit failed, missing, or protected removals', async () => {
    assignments.remove.mockResolvedValueOnce({ kind: 'not-assigned' });
    await expect(service.remove(context, staffId, roleId, actor)).rejects.toBeInstanceOf(
      TenantStaffRoleAssignmentNotFoundError,
    );

    assignments.remove.mockResolvedValueOnce({ kind: 'owner-protected' });
    await expect(service.remove(context, staffId, roleId, actor)).rejects.toBeInstanceOf(
      TenantOwnerProtectionError,
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});
