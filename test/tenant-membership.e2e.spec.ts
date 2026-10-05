import { CanActivate, Controller, ExecutionContext, Get, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TenantMembershipStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { RequirePermissions } from '../src/auth/decorators/require-permissions.decorator';
import { AuthenticationError } from '../src/auth/errors/auth.errors';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { PlatformAuthorizationGuard } from '../src/auth/guards/platform-authorization.guard';
import type { PlatformAuthorizationService } from '../src/auth/services/platform-authorization.service';
import { APP_CONSTANTS } from '../src/common/constants/app.constants';
import { TenantMembershipController } from '../src/tenant/tenant-membership.controller';
import { TenantMembershipService } from '../src/tenant/tenant-membership.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const platformUserId = '22222222-2222-4222-8222-222222222222';
const membershipId = '33333333-3333-4333-8333-333333333333';

const authenticatedUser: AuthenticatedPlatformUser = {
  userId: '44444444-4444-4444-8444-444444444444',
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: [],
};

const sampleMembership = {
  id: membershipId,
  tenantId,
  platformUserId,
  status: TenantMembershipStatus.INVITED,
  statusChangedAt: new Date('2026-10-05T12:00:00.000Z'),
  activatedAt: null,
  suspendedAt: null,
  removedAt: null,
  createdAt: new Date('2026-10-05T12:00:00.000Z'),
  updatedAt: new Date('2026-10-05T12:00:00.000Z'),
};

class TestAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      authenticatedPlatformUser?: AuthenticatedPlatformUser;
    }>();
    if (request.headers.authorization !== 'Bearer valid') {
      throw new AuthenticationError('AUTH_TOKEN_MISSING', 'Authorization token is required');
    }
    request.authenticatedPlatformUser = authenticatedUser;
    return true;
  }
}

@Controller('tenant-membership-guard-probe')
class TenantMembershipGuardProbeController {
  @Get()
  @UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
  @RequirePermissions('platform.manage')
  probe(): { success: true } {
    return { success: true };
  }
}

describe('Tenant membership administration HTTP security boundary', () => {
  let app: NestFastifyApplication;
  const authorization = { hasPermissions: vi.fn() };
  const memberships = {
    invite: vi.fn(),
    listForTenant: vi.fn(),
    activate: vi.fn(),
    suspend: vi.fn(),
    remove: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    authorization.hasPermissions.mockResolvedValue(false);
    memberships.invite.mockResolvedValue(sampleMembership);
    memberships.listForTenant.mockResolvedValue({
      items: [sampleMembership],
      limit: 50,
      offset: 0,
    });
    memberships.activate.mockResolvedValue({
      ...sampleMembership,
      status: TenantMembershipStatus.ACTIVE,
    });
    memberships.suspend.mockResolvedValue({
      ...sampleMembership,
      status: TenantMembershipStatus.SUSPENDED,
    });
    memberships.remove.mockResolvedValue({
      ...sampleMembership,
      status: TenantMembershipStatus.REMOVED,
    });

    const authorizationGuard = new PlatformAuthorizationGuard(
      new Reflector(),
      authorization as unknown as PlatformAuthorizationService,
    );
    const module = await Test.createTestingModule({
      controllers: [TenantMembershipController, TenantMembershipGuardProbeController],
      providers: [PlatformAuthGuard, PlatformAuthorizationGuard, TenantMembershipService],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(PlatformAuthorizationGuard)
      .useValue(authorizationGuard)
      .overrideProvider(TenantMembershipService)
      .useValue(memberships)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires platform authentication before membership administration', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/memberships`,
      payload: { platformUserId },
    });

    expect(response.statusCode).toBe(401);
    expect(authorization.hasPermissions).not.toHaveBeenCalled();
    expect(memberships.invite).not.toHaveBeenCalled();
  });

  it('requires platform permissions and does not authorize from a tenant ID', async () => {
    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/memberships`,
      headers: { authorization: 'Bearer valid' },
      payload: { platformUserId },
    });
    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/platform/tenants/${tenantId}/memberships`,
      headers: { authorization: 'Bearer valid' },
    });

    expect(inviteResponse.statusCode).toBe(403);
    expect(listResponse.statusCode).toBe(403);
    expect(authorization.hasPermissions).toHaveBeenNthCalledWith(1, authenticatedUser.userId, [
      'platform.manage',
    ]);
    expect(authorization.hasPermissions).toHaveBeenNthCalledWith(2, authenticatedUser.userId, [
      'platform.read',
    ]);
    expect(memberships.invite).not.toHaveBeenCalled();
    expect(memberships.listForTenant).not.toHaveBeenCalled();
  });

  it('rejects client actor/role assignment and uses the trusted actor for invitations', async () => {
    authorization.hasPermissions.mockResolvedValue(true);
    const invalidResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/memberships`,
      headers: { authorization: 'Bearer valid' },
      payload: { platformUserId, actorUserId: platformUserId, tenantRoleId: 'role-1' },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/memberships`,
      headers: { authorization: 'Bearer valid' },
      payload: { platformUserId },
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(memberships.invite).toHaveBeenCalledTimes(1);
    expect(memberships.invite).toHaveBeenCalledWith(
      tenantId,
      { platformUserId },
      authenticatedUser,
      expect.any(Object),
    );
    expect(response.statusCode).toBe(201);
  });

  it('allows a platform administrator to activate without honoring a client-supplied status', async () => {
    authorization.hasPermissions.mockResolvedValue(true);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/memberships/${membershipId}/activate`,
      headers: { authorization: 'Bearer valid' },
      payload: { status: 'REMOVED', tenantRoleId: 'role-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: TenantMembershipStatus.ACTIVE });
    expect(memberships.activate).toHaveBeenCalledWith(
      tenantId,
      membershipId,
      authenticatedUser,
      expect.any(Object),
    );
  });

  it('uses platform.manage on privileged guard routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tenant-membership-guard-probe',
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(403);
    expect(authorization.hasPermissions).toHaveBeenCalledWith(authenticatedUser.userId, [
      'platform.manage',
    ]);
  });
});
