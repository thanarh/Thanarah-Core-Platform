import { ForbiddenException } from '@nestjs/common';
import { PlatformAuditEventType, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { AuthorizationForbiddenError } from '../src/auth/errors/authorization.errors';
import type { PlatformAuthorizationService } from '../src/auth/services/platform-authorization.service';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import type { TenantAuthorizationService } from '../src/tenant/tenant-authorization.service';
import {
  TenantMembershipRoleTargetNotFoundError,
  TenantOwnerAssignmentForbiddenError,
  TenantOwnerProtectionError,
  TenantPermissionAssignmentInvalidError,
  TenantRoleInputValidationError,
  TenantSystemRoleProtectedError,
} from '../src/tenant/tenant-authorization.errors';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import type { TenantMembershipRoleRepository } from '../src/tenant/tenant-membership-role.repository';
import { TenantRoleService } from '../src/tenant/tenant-role.service';
import type { TenantRoleRecord, TenantRoleRepository } from '../src/tenant/tenant-role.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const targetUserId = '33333333-3333-4333-8333-333333333333';
const membershipId = '44444444-4444-4444-8444-444444444444';
const roleId = '55555555-5555-4555-8555-555555555555';
const context = {
  tenantId,
  membershipId: '66666666-6666-4666-8666-666666666666',
  platformUserId: actorId,
} as unknown as TrustedTenantContext;
const actor: AuthenticatedPlatformUser = {
  userId: actorId,
  sessionId: '77777777-7777-4777-8777-777777777777',
  tokenVersion: 1,
  platformRoleIds: [],
};
const timestamp = new Date('2026-10-05T12:00:00.000Z');

function role(overrides: Partial<TenantRoleRecord> = {}): TenantRoleRecord {
  return {
    id: roleId,
    tenantId,
    code: 'REPORT_VIEWER',
    name: 'Report Viewer',
    description: null,
    isSystemRole: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    permissions: [],
    ...overrides,
  };
}

describe('TenantRoleService', () => {
  const roles = {
    create: vi.fn(),
    findByIdForTenant: vi.fn(),
    listForTenant: vi.fn(),
    updateMetadata: vi.fn(),
    replacePermissions: vi.fn(),
    bootstrapInitialOwner: vi.fn(),
  };
  const membershipRoles = {
    listForMembership: vi.fn(),
    assign: vi.fn(),
    remove: vi.fn(),
  };
  const tenantAuthorization = { authorize: vi.fn() };
  const platformAuthorization = { hasPermissions: vi.fn() };
  const audit = { recordAudit: vi.fn() };
  let service: TenantRoleService;

  beforeEach(() => {
    vi.clearAllMocks();
    roles.create.mockResolvedValue(role());
    roles.findByIdForTenant.mockResolvedValue(role());
    roles.listForTenant.mockResolvedValue([role()]);
    roles.updateMetadata.mockResolvedValue(role());
    roles.replacePermissions.mockResolvedValue(role());
    roles.bootstrapInitialOwner.mockResolvedValue({
      ownerMembershipId: membershipId,
      roles: [role({ code: 'OWNER', name: 'Owner', isSystemRole: true })],
      createdRoleCodes: ['OWNER'],
      updatedPermissionRoleCodes: [],
    });
    membershipRoles.listForMembership.mockResolvedValue([]);
    membershipRoles.assign.mockResolvedValue({
      kind: 'changed',
      platformUserId: targetUserId,
      roleCode: 'REPORT_VIEWER',
    });
    membershipRoles.remove.mockResolvedValue({
      kind: 'changed',
      platformUserId: targetUserId,
      roleCode: 'REPORT_VIEWER',
    });
    tenantAuthorization.authorize.mockResolvedValue(undefined);
    platformAuthorization.hasPermissions.mockResolvedValue(true);
    audit.recordAudit.mockResolvedValue(undefined);
    service = new TenantRoleService(
      roles as unknown as TenantRoleRepository,
      membershipRoles as unknown as TenantMembershipRoleRepository,
      tenantAuthorization as unknown as TenantAuthorizationService,
      platformAuthorization as unknown as PlatformAuthorizationService,
      audit as unknown as PlatformAuditService,
    );
  });

  it('creates a tenant-specific custom role and audits the authenticated actor', async () => {
    const result = await service.createRole(
      context,
      { code: 'report_viewer', name: ' Report Viewer ' },
      actor,
      { requestId: 'role-create-1' },
    );

    expect(result.code).toBe('REPORT_VIEWER');
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(context, 'tenant.roles.manage');
    expect(roles.create).toHaveBeenCalledWith({
      tenantId,
      code: 'REPORT_VIEWER',
      name: 'Report Viewer',
      description: undefined,
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.TENANT_ROLE_CREATED,
        actorUserId: actorId,
        sessionId: actor.sessionId,
        subjectTenantId: tenantId,
        requestId: 'role-create-1',
      }),
    );
  });

  it('blocks reserved default role codes and maps per-tenant unique conflicts', async () => {
    await expect(
      service.createRole(context, { code: 'OWNER', name: 'Tenant Owner' }, actor),
    ).rejects.toBeInstanceOf(TenantRoleInputValidationError);
    expect(roles.create).not.toHaveBeenCalled();

    roles.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['tenantId', 'code'] },
      }),
    );
    await expect(
      service.createRole(context, { code: 'REPORT_VIEWER', name: 'Report Viewer' }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('prevents metadata changes to system roles', async () => {
    roles.findByIdForTenant.mockResolvedValueOnce(role({ code: 'ADMIN', isSystemRole: true }));

    await expect(
      service.updateRole(context, roleId, { name: 'Renamed' }, actor),
    ).rejects.toBeInstanceOf(TenantSystemRoleProtectedError);
    expect(roles.updateMetadata).not.toHaveBeenCalled();
  });

  it('allows an owner to update custom role permission codes, but not grant owner-only permission', async () => {
    const permissionCodes = ['tenant.roles.read'] as const;
    roles.replacePermissions.mockResolvedValueOnce(
      role({
        permissions: [{ permission: { code: 'tenant.roles.read' } }],
      }),
    );
    const updated = await service.replacePermissions(
      context,
      roleId,
      { permissionCodes: [...permissionCodes] },
      actor,
    );

    expect(updated.permissionCodes).toEqual(['tenant.roles.read']);
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      context,
      'tenant.roles.permissions.manage',
    );
    expect(roles.replacePermissions).toHaveBeenCalledWith(tenantId, roleId, permissionCodes);

    await expect(
      service.replacePermissions(
        context,
        roleId,
        { permissionCodes: ['tenant.roles.permissions.manage'] },
        actor,
      ),
    ).rejects.toBeInstanceOf(TenantPermissionAssignmentInvalidError);
  });

  it('scopes membership role assignments to trusted tenant and rejects missing cross-tenant targets', async () => {
    membershipRoles.assign.mockResolvedValueOnce({ kind: 'not-found' });

    await expect(service.assignRole(context, membershipId, roleId, actor)).rejects.toBeInstanceOf(
      TenantMembershipRoleTargetNotFoundError,
    );
    expect(membershipRoles.assign).toHaveBeenCalledWith({
      tenantId,
      actorMembershipId: context.membershipId,
      actorPlatformUserId: actorId,
      targetMembershipId: membershipId,
      roleId,
    });
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects self-assignment even when the client supplies a valid tenant role ID', async () => {
    membershipRoles.assign.mockResolvedValueOnce({ kind: 'self-assignment' });

    await expect(service.assignRole(context, membershipId, roleId, actor)).rejects.toMatchObject({
      status: 403,
    });
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('requires existing owner authorization to assign OWNER to another member', async () => {
    roles.findByIdForTenant.mockResolvedValueOnce(
      role({ code: 'OWNER', name: 'Owner', isSystemRole: true }),
    );
    membershipRoles.assign.mockResolvedValueOnce({
      kind: 'changed',
      platformUserId: targetUserId,
      roleCode: 'OWNER',
    });

    await service.assignRole(context, membershipId, roleId, actor);

    expect(tenantAuthorization.authorize).toHaveBeenNthCalledWith(
      1,
      context,
      'tenant.members.roles.manage',
    );
    expect(tenantAuthorization.authorize).toHaveBeenNthCalledWith(
      2,
      context,
      'tenant.roles.permissions.manage',
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.TENANT_OWNER_ASSIGNED,
        actorUserId: actorId,
        subjectUserId: targetUserId,
        metadata: expect.objectContaining({ roleCode: 'OWNER' }),
      }),
    );
  });

  it('rejects OWNER assignment when the assignment repository does not confirm owner status', async () => {
    roles.findByIdForTenant.mockResolvedValueOnce(
      role({ code: 'OWNER', name: 'Owner', isSystemRole: true }),
    );
    membershipRoles.assign.mockResolvedValueOnce({ kind: 'owner-only' });

    await expect(service.assignRole(context, membershipId, roleId, actor)).rejects.toBeInstanceOf(
      TenantOwnerAssignmentForbiddenError,
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('never removes OWNER assignments through ordinary tenant role management', async () => {
    membershipRoles.remove.mockResolvedValueOnce({ kind: 'owner-protected' });

    await expect(service.removeRole(context, membershipId, roleId, actor)).rejects.toBeInstanceOf(
      TenantOwnerProtectionError,
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('uses the platform.manage namespace to bootstrap defaults and a different active member as owner', async () => {
    const result = await service.bootstrapInitialOwner(
      tenantId,
      { platformUserId: targetUserId },
      actor,
    );

    expect(platformAuthorization.hasPermissions).toHaveBeenCalledWith(actorId, ['platform.manage']);
    expect(roles.bootstrapInitialOwner).toHaveBeenCalledWith({
      tenantId,
      platformUserId: targetUserId,
    });
    expect(result.ownerMembershipId).toBe(membershipId);
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.TENANT_OWNER_ASSIGNED,
        actorUserId: actorId,
        subjectUserId: targetUserId,
        subjectTenantId: tenantId,
      }),
    );
  });

  it('denies bootstrap when the platform actor lacks platform.manage or targets themselves', async () => {
    platformAuthorization.hasPermissions.mockResolvedValue(false);
    await expect(
      service.bootstrapInitialOwner(tenantId, { platformUserId: targetUserId }, actor),
    ).rejects.toBeInstanceOf(AuthorizationForbiddenError);
    expect(roles.bootstrapInitialOwner).not.toHaveBeenCalled();

    await expect(
      service.bootstrapInitialOwner(tenantId, { platformUserId: actorId }, actor),
    ).rejects.toBeInstanceOf(TenantOwnerAssignmentForbiddenError);
    expect(roles.bootstrapInitialOwner).not.toHaveBeenCalled();
  });

  it('rejects tenant authorization actions if audit actor and trusted tenant actor differ', async () => {
    await expect(
      service.createRole(
        context,
        { code: 'REPORT_VIEWER', name: 'Report Viewer' },
        {
          ...actor,
          userId: targetUserId,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
  });
});
