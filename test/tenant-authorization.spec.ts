import { HttpStatus, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PlatformAuditEventType, TenantMembershipStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { AuthenticationError } from '../src/auth/errors/auth.errors';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import { TenantAuthorizationService } from '../src/tenant/tenant-authorization.service';
import { TenantAuthorizationGuard } from '../src/tenant/tenant-authorization.guard';
import {
  TenantContextInvalidError,
  type TrustedTenantContext,
} from '../src/tenant/tenant-context.contract';
import { TenantMembershipValidatorService } from '../src/tenant/tenant-context.service';
import type { TenantMembershipRepository } from '../src/tenant/tenant-membership.repository';
import type { TenantMembershipRoleRepository } from '../src/tenant/tenant-membership-role.repository';
import {
  TenantPermissionDeniedError,
  TenantPermissionRequirementMissingError,
} from '../src/tenant/tenant-authorization.errors';
import { TENANT_REQUIRED_PERMISSIONS } from '../src/tenant/tenant-require-permissions.decorator';

const tenantId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const platformUserId = '33333333-3333-4333-8333-333333333333';
const otherTenantId = '55555555-5555-4555-8555-555555555555';
const otherMembershipId = '66666666-6666-4666-8666-666666666666';
const otherPlatformUserId = '77777777-7777-4777-8777-777777777777';
const context = {
  tenantId,
  membershipId,
  platformUserId,
} as unknown as TrustedTenantContext;
const authenticatedPlatformUser: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '44444444-4444-4444-8444-444444444444',
  tokenVersion: 1,
  platformRoleIds: [],
};

describe('TenantMembershipValidatorService', () => {
  const memberships = { findActiveForTenantAndPlatformUser: vi.fn() };
  let validator: TenantMembershipValidatorService;

  beforeEach(() => {
    vi.clearAllMocks();
    memberships.findActiveForTenantAndPlatformUser.mockResolvedValue({
      id: membershipId,
      tenantId,
      platformUserId,
      status: TenantMembershipStatus.ACTIVE,
    });
    validator = new TenantMembershipValidatorService(
      memberships as unknown as TenantMembershipRepository,
    );
  });

  it('creates validated membership scope only for an active tenant/member pair', async () => {
    const validated = await validator.validateMembership({
      authenticatedPlatformUser,
      tenantIdCandidate: tenantId.toUpperCase(),
    });

    expect(validated).toEqual({ tenantId, membershipId, platformUserId });
    expect(Object.isFrozen(validated)).toBe(true);
    expect(memberships.findActiveForTenantAndPlatformUser).toHaveBeenCalledWith(
      tenantId,
      platformUserId,
    );
  });

  it('rejects malformed tenant IDs before querying for membership', async () => {
    await expect(
      validator.validateMembership({
        authenticatedPlatformUser,
        tenantIdCandidate: 'not-a-tenant-id',
      }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
    expect(memberships.findActiveForTenantAndPlatformUser).not.toHaveBeenCalled();
  });

  it('fails closed when no active tenant/member pair matches', async () => {
    memberships.findActiveForTenantAndPlatformUser.mockResolvedValueOnce(null);
    await expect(
      validator.validateMembership({ authenticatedPlatformUser, tenantIdCandidate: tenantId }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
  });

  it.each([
    TenantMembershipStatus.INVITED,
    TenantMembershipStatus.SUSPENDED,
    TenantMembershipStatus.REMOVED,
  ])('rejects %s memberships for normal tenant operations', async (status) => {
    memberships.findActiveForTenantAndPlatformUser.mockResolvedValueOnce({
      id: membershipId,
      tenantId,
      platformUserId,
      status,
    });

    await expect(
      validator.validateMembership({ authenticatedPlatformUser, tenantIdCandidate: tenantId }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
  });

  it.each([
    { tenantId: otherTenantId, platformUserId },
    { tenantId, platformUserId: otherPlatformUserId },
  ])(
    'rejects a membership record that does not match the requested tenant and actor',
    async (scope) => {
      memberships.findActiveForTenantAndPlatformUser.mockResolvedValueOnce({
        id: otherMembershipId,
        tenantId: scope.tenantId,
        platformUserId: scope.platformUserId,
        status: TenantMembershipStatus.ACTIVE,
      });

      await expect(
        validator.validateMembership({ authenticatedPlatformUser, tenantIdCandidate: tenantId }),
      ).rejects.toBeInstanceOf(TenantContextInvalidError);
    },
  );

  it('resolves the same authenticated user independently in two active tenants', async () => {
    const secondMembershipId = '88888888-8888-4888-8888-888888888888';
    memberships.findActiveForTenantAndPlatformUser.mockImplementation(
      async (requestedTenantId: string, requestedPlatformUserId: string) => ({
        id: requestedTenantId === tenantId ? membershipId : secondMembershipId,
        tenantId: requestedTenantId,
        platformUserId: requestedPlatformUserId,
        status: TenantMembershipStatus.ACTIVE,
      }),
    );

    const first = await validator.validateMembership({
      authenticatedPlatformUser,
      tenantIdCandidate: tenantId,
    });
    const second = await validator.validateMembership({
      authenticatedPlatformUser,
      tenantIdCandidate: otherTenantId,
    });

    expect(first).toEqual({ tenantId, membershipId, platformUserId });
    expect(second).toEqual({
      tenantId: otherTenantId,
      membershipId: secondMembershipId,
      platformUserId,
    });
  });
});

describe('TenantAuthorizationService', () => {
  const memberships = { resolvePermissionCodes: vi.fn() };
  const audit = { recordAudit: vi.fn() };
  let authorization: TenantAuthorizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    memberships.resolvePermissionCodes.mockResolvedValue(['tenant.roles.read']);
    audit.recordAudit.mockResolvedValue(undefined);
    authorization = new TenantAuthorizationService(
      memberships as unknown as TenantMembershipRoleRepository,
      audit as unknown as PlatformAuditService,
    );
  });

  it('resolves a tenant permission from active membership role assignments', async () => {
    await expect(authorization.authorize(context, 'tenant.roles.read')).resolves.toBeUndefined();
    expect(memberships.resolvePermissionCodes).toHaveBeenCalledWith(context);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('denies platform permissions and never consults platform authorization', async () => {
    await expect(authorization.authorize(context, 'platform.manage')).rejects.toBeInstanceOf(
      TenantPermissionDeniedError,
    );
    expect(memberships.resolvePermissionCodes).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('records a denied tenant permission with the trusted actor and tenant', async () => {
    await expect(authorization.authorize(context, 'tenant.roles.manage')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(audit.recordAudit).toHaveBeenCalledWith({
      eventType: PlatformAuditEventType.TENANT_AUTHORIZATION_DENIED,
      actorUserId: platformUserId,
      subjectTenantId: tenantId,
      metadata: { permissionCode: 'tenant.roles.manage' },
    });
  });
});

describe('TenantAuthorizationGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() };
  const authorization = { authorize: vi.fn() };
  const handler = (): undefined => undefined;
  class TestController {}
  let guard: TenantAuthorizationGuard;

  function executionContext(request: object): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(['tenant.roles.read']);
    authorization.authorize.mockResolvedValue(undefined);
    guard = new TenantAuthorizationGuard(
      reflector as unknown as Reflector,
      authorization as unknown as TenantAuthorizationService,
    );
  });

  it('returns 401 when used without an authenticated platform user', async () => {
    await expect(
      guard.canActivate(executionContext({ trustedTenantContext: context, params: { tenantId } })),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
    expect(authorization.authorize).not.toHaveBeenCalled();
  });

  it('returns 401 when the authenticated platform user context is malformed', async () => {
    await expect(
      guard.canActivate(
        executionContext({
          authenticatedPlatformUser: { userId: null },
          trustedTenantContext: context,
          params: { tenantId },
        }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(authorization.authorize).not.toHaveBeenCalled();
  });

  it('rejects trusted contexts belonging to a different actor or route tenant', async () => {
    await expect(
      guard.canActivate(
        executionContext({
          authenticatedPlatformUser,
          trustedTenantContext: context,
          params: { tenantId: otherTenantId },
        }),
      ),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);

    await expect(
      guard.canActivate(
        executionContext({
          authenticatedPlatformUser: { ...authenticatedPlatformUser, userId: otherPlatformUserId },
          trustedTenantContext: context,
          params: { tenantId },
        }),
      ),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
    expect(authorization.authorize).not.toHaveBeenCalled();
  });

  it('uses only server-defined tenant permission metadata', async () => {
    const request = {
      authenticatedPlatformUser,
      trustedTenantContext: context,
      params: { tenantId },
      query: { permission: 'platform.manage', role: 'OWNER' },
      headers: { 'x-tenant-permission': 'platform.manage', 'x-tenant-role': 'OWNER' },
    };

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(TENANT_REQUIRED_PERMISSIONS, [
      handler,
      TestController,
    ]);
    expect(authorization.authorize).toHaveBeenCalledExactlyOnceWith(context, 'tenant.roles.read');
  });

  it('fails closed when a route has no tenant permission metadata', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(undefined);

    await expect(
      guard.canActivate(
        executionContext({
          authenticatedPlatformUser,
          trustedTenantContext: context,
          params: { tenantId },
        }),
      ),
    ).rejects.toBeInstanceOf(TenantPermissionRequirementMissingError);
    expect(authorization.authorize).not.toHaveBeenCalled();
  });
});
