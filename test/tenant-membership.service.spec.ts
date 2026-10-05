import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  PlatformAuditEventType,
  Prisma,
  TenantMembershipStatus,
  TenantStatus,
  UserStatus,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformUserRepository } from '../src/auth/repositories/platform-user.repository';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import {
  TenantMembershipExistsError,
  TenantMembershipLifecycleConflictError,
} from '../src/tenant/tenant-membership.errors';
import type {
  TenantMembershipRepository,
  TenantMembershipRecord,
} from '../src/tenant/tenant-membership.repository';
import { TenantMembershipService } from '../src/tenant/tenant-membership.service';
import type { TenantRecord, TenantRepository } from '../src/tenant/tenant.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const platformUserId = '22222222-2222-4222-8222-222222222222';
const actorId = '44444444-4444-4444-8444-444444444444';
const membershipId = '33333333-3333-4333-8333-333333333333';
const timestamp = new Date('2026-10-05T12:00:00.000Z');

const actor: AuthenticatedPlatformUser = {
  userId: actorId,
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: [],
};

function tenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: tenantId,
    slug: 'north-clinic',
    legalName: 'North Health Group',
    displayName: 'North Health Group',
    status: TenantStatus.ACTIVE,
    statusChangedAt: timestamp,
    suspendedAt: null,
    deactivatedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function membership(overrides: Partial<TenantMembershipRecord> = {}): TenantMembershipRecord {
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

describe('TenantMembershipService', () => {
  const memberships = {
    create: vi.fn(),
    findByTenantAndPlatformUser: vi.fn(),
    findByIdForTenant: vi.fn(),
    listForTenant: vi.fn(),
    changeStatusIfCurrent: vi.fn(),
    hasActiveMembership: vi.fn(),
  };
  const tenants = { findById: vi.fn() };
  const platformUsers = { findAuthRecordById: vi.fn() };
  const audit = { recordAudit: vi.fn() };
  let service: TenantMembershipService;

  beforeEach(() => {
    vi.clearAllMocks();
    memberships.create.mockResolvedValue(membership());
    memberships.findByTenantAndPlatformUser.mockResolvedValue(null);
    memberships.findByIdForTenant.mockResolvedValue(membership());
    memberships.listForTenant.mockResolvedValue([membership()]);
    memberships.changeStatusIfCurrent.mockResolvedValue(
      membership({ status: TenantMembershipStatus.ACTIVE, activatedAt: timestamp }),
    );
    memberships.hasActiveMembership.mockResolvedValue(false);
    tenants.findById.mockResolvedValue(tenant());
    platformUsers.findAuthRecordById.mockResolvedValue({
      id: platformUserId,
      status: UserStatus.ACTIVE,
      tokenVersion: 0,
    });
    audit.recordAudit.mockResolvedValue(undefined);
    service = new TenantMembershipService(
      memberships as unknown as TenantMembershipRepository,
      tenants as unknown as TenantRepository,
      platformUsers as unknown as PlatformUserRepository,
      audit as unknown as PlatformAuditService,
    );
  });

  it('creates an INVITED membership and audits the trusted actor and both relationship subjects', async () => {
    const result = await service.invite(tenantId, { platformUserId }, actor, {
      requestId: 'membership-request-1',
    });

    expect(result.status).toBe(TenantMembershipStatus.INVITED);
    expect(memberships.create).toHaveBeenCalledWith({ tenantId, platformUserId });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.TENANT_MEMBERSHIP_INVITED,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        subjectUserId: platformUserId,
        subjectTenantId: tenantId,
        requestId: 'membership-request-1',
        metadata: { membershipId, status: TenantMembershipStatus.INVITED },
      }),
    );
  });

  it('prevents duplicate membership rows for the same tenant/user pair', async () => {
    memberships.findByTenantAndPlatformUser.mockResolvedValue(membership());

    await expect(service.invite(tenantId, { platformUserId }, actor)).rejects.toBeInstanceOf(
      TenantMembershipExistsError,
    );
    expect(memberships.create).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('maps a concurrent compound-unique collision to a stable conflict', async () => {
    memberships.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['tenantId', 'platformUserId'] },
      }),
    );

    await expect(service.invite(tenantId, { platformUserId }, actor)).rejects.toBeInstanceOf(
      TenantMembershipExistsError,
    );
  });

  it('rejects an invitation for a nonexistent tenant before checking the user', async () => {
    tenants.findById.mockResolvedValue(null);

    await expect(service.invite(tenantId, { platformUserId }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(platformUsers.findAuthRecordById).not.toHaveBeenCalled();
    expect(memberships.create).not.toHaveBeenCalled();
  });

  it('rejects an invitation for a nonexistent platform user', async () => {
    platformUsers.findAuthRecordById.mockResolvedValue(null);

    await expect(service.invite(tenantId, { platformUserId }, actor)).rejects.toMatchObject({
      status: 404,
      response: {
        code: 'TENANT_MEMBERSHIP_PLATFORM_USER_NOT_FOUND',
      },
    });
    expect(memberships.create).not.toHaveBeenCalled();
  });

  it('prevents self-invitation and rejects actor or tenant-role mass assignment', async () => {
    await expect(
      service.invite(tenantId, { platformUserId: actor.userId }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.invite(
        tenantId,
        { platformUserId, actorUserId: actor.userId, tenantRoleId: 'role-1' } as never,
        actor,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(memberships.create).not.toHaveBeenCalled();
  });

  it('activates only an invited membership and attributes the audit to the manager', async () => {
    memberships.findByIdForTenant.mockResolvedValue(membership());
    memberships.changeStatusIfCurrent.mockResolvedValue(
      membership({ status: TenantMembershipStatus.ACTIVE, activatedAt: timestamp }),
    );

    await service.activate(tenantId, membershipId, actor);

    expect(memberships.changeStatusIfCurrent).toHaveBeenCalledWith(
      membershipId,
      tenantId,
      TenantMembershipStatus.INVITED,
      TenantMembershipStatus.ACTIVE,
      expect.any(Date),
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.TENANT_MEMBERSHIP_ACTIVATED,
        actorUserId: actor.userId,
        subjectUserId: platformUserId,
        subjectTenantId: tenantId,
        metadata: {
          membershipId,
          fromStatus: TenantMembershipStatus.INVITED,
          toStatus: TenantMembershipStatus.ACTIVE,
        },
      }),
    );
  });

  it('suspends active memberships and supports deliberate reactivation from SUSPENDED', async () => {
    memberships.findByIdForTenant
      .mockResolvedValueOnce(membership({ status: TenantMembershipStatus.ACTIVE }))
      .mockResolvedValueOnce(membership({ status: TenantMembershipStatus.SUSPENDED }));
    memberships.changeStatusIfCurrent
      .mockResolvedValueOnce(
        membership({ status: TenantMembershipStatus.SUSPENDED, suspendedAt: timestamp }),
      )
      .mockResolvedValueOnce(
        membership({ status: TenantMembershipStatus.ACTIVE, activatedAt: timestamp }),
      );

    await service.suspend(tenantId, membershipId, actor);
    await service.activate(tenantId, membershipId, actor);

    expect(memberships.changeStatusIfCurrent).toHaveBeenNthCalledWith(
      1,
      membershipId,
      tenantId,
      TenantMembershipStatus.ACTIVE,
      TenantMembershipStatus.SUSPENDED,
      expect.any(Date),
    );
    expect(memberships.changeStatusIfCurrent).toHaveBeenNthCalledWith(
      2,
      membershipId,
      tenantId,
      TenantMembershipStatus.SUSPENDED,
      TenantMembershipStatus.ACTIVE,
      expect.any(Date),
    );
    expect(audit.recordAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: PlatformAuditEventType.TENANT_MEMBERSHIP_SUSPENDED,
      }),
    );
    expect(audit.recordAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: PlatformAuditEventType.TENANT_MEMBERSHIP_ACTIVATED,
      }),
    );
  });

  it('removes an invited membership permanently and records a removal event', async () => {
    memberships.changeStatusIfCurrent.mockResolvedValue(
      membership({ status: TenantMembershipStatus.REMOVED, removedAt: timestamp }),
    );

    await service.remove(tenantId, membershipId, actor);

    expect(memberships.changeStatusIfCurrent).toHaveBeenCalledWith(
      membershipId,
      tenantId,
      TenantMembershipStatus.INVITED,
      TenantMembershipStatus.REMOVED,
      expect.any(Date),
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.TENANT_MEMBERSHIP_REMOVED,
        metadata: {
          membershipId,
          fromStatus: TenantMembershipStatus.INVITED,
          toStatus: TenantMembershipStatus.REMOVED,
        },
      }),
    );
  });

  it('does not reactivate REMOVED memberships and makes repeated transitions idempotent', async () => {
    memberships.findByIdForTenant
      .mockResolvedValueOnce(membership({ status: TenantMembershipStatus.REMOVED }))
      .mockResolvedValueOnce(membership({ status: TenantMembershipStatus.ACTIVE }));

    await expect(service.activate(tenantId, membershipId, actor)).rejects.toBeInstanceOf(
      TenantMembershipLifecycleConflictError,
    );
    await service.activate(tenantId, membershipId, actor);

    expect(memberships.changeStatusIfCurrent).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('fails a stale concurrent lifecycle write closed', async () => {
    memberships.findByIdForTenant
      .mockResolvedValueOnce(membership({ status: TenantMembershipStatus.ACTIVE }))
      .mockResolvedValueOnce(membership({ status: TenantMembershipStatus.REMOVED }));
    memberships.changeStatusIfCurrent.mockResolvedValue(null);

    await expect(service.suspend(tenantId, membershipId, actor)).rejects.toBeInstanceOf(
      TenantMembershipLifecycleConflictError,
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('does not allow an administrator to manage their own membership', async () => {
    memberships.findByIdForTenant.mockResolvedValue(membership({ platformUserId: actor.userId }));

    await expect(service.remove(tenantId, membershipId, actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(memberships.changeStatusIfCurrent).not.toHaveBeenCalled();
  });

  it('scopes membership IDs to the route tenant and prevents cross-tenant confusion', async () => {
    const otherTenantId = '66666666-6666-4666-8666-666666666666';
    memberships.findByIdForTenant.mockResolvedValue(null);

    await expect(service.activate(otherTenantId, membershipId, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(memberships.findByIdForTenant).toHaveBeenCalledWith(membershipId, otherTenantId);
  });

  it('requires the exact tenant/user pair for active-membership checks', async () => {
    memberships.hasActiveMembership.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(service.hasActiveMembership({ tenantId, platformUserId })).resolves.toBe(true);
    await expect(
      service.hasActiveMembership({
        tenantId: '77777777-7777-4777-8777-777777777777',
        platformUserId,
      }),
    ).resolves.toBe(false);

    expect(memberships.hasActiveMembership).toHaveBeenNthCalledWith(1, tenantId, platformUserId);
    expect(memberships.hasActiveMembership).toHaveBeenNthCalledWith(
      2,
      '77777777-7777-4777-8777-777777777777',
      platformUserId,
    );
  });

  it('requires tenant membership input to include both valid identifiers', async () => {
    await expect(service.hasActiveMembership({ tenantId } as never)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.hasActiveMembership({ tenantId: 'not-a-uuid', platformUserId }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('lists memberships with bounded status filters only after confirming the tenant exists', async () => {
    await service.listForTenant(tenantId, {
      status: TenantMembershipStatus.SUSPENDED,
      limit: 20,
      offset: 5,
    });

    expect(memberships.listForTenant).toHaveBeenCalledWith({
      tenantId,
      status: TenantMembershipStatus.SUSPENDED,
      limit: 20,
      offset: 5,
    });
  });

  it('rejects a membership with a malformed identifier before querying', async () => {
    await expect(service.activate(tenantId, 'not-a-uuid', actor)).rejects.toMatchObject({
      status: 400,
    });
    expect(memberships.findByIdForTenant).not.toHaveBeenCalled();
  });
});
