import {
  Controller,
  Get,
  type CanActivate,
  type ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { RequirePermissions } from '../src/auth/decorators/require-permissions.decorator';
import { AuthenticationError } from '../src/auth/errors/auth.errors';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { PlatformAuthorizationGuard } from '../src/auth/guards/platform-authorization.guard';
import type { PlatformAuthorizationService } from '../src/auth/services/platform-authorization.service';
import { APP_CONSTANTS } from '../src/common/constants/app.constants';
import { TenantAuthorizationGuard } from '../src/tenant/tenant-authorization.guard';
import { TenantAuthorizationService } from '../src/tenant/tenant-authorization.service';
import { TenantContextInvalidError } from '../src/tenant/tenant-context.contract';
import { TenantContextGuard } from '../src/tenant/tenant-context.guard';
import {
  TenantMembershipValidatorService,
  TrustedTenantContextFactoryService,
} from '../src/tenant/tenant-context.service';
import { TenantRoleBootstrapController } from '../src/tenant/tenant-role-bootstrap.controller';
import { TenantRoleController } from '../src/tenant/tenant-role.controller';
import { TenantRoleService } from '../src/tenant/tenant-role.service';
import { TenantPermissionDeniedError } from '../src/tenant/tenant-authorization.errors';
import type {
  TenantId,
  TenantMembershipId,
  ValidatedTenantMembership,
} from '../src/tenant/tenant-context.contract';
import type { FastifyRequest } from 'fastify';

const tenantId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const platformUserId = '33333333-3333-4333-8333-333333333333';
const ownerUserId = '44444444-4444-4444-8444-444444444444';
const authenticatedUser: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: [],
};
const validatedMembership = {
  tenantId: tenantId as TenantId,
  membershipId: membershipId as TenantMembershipId,
  platformUserId,
} as ValidatedTenantMembership;

class TestAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.headers.authorization !== 'Bearer valid') {
      throw new AuthenticationError('AUTH_TOKEN_MISSING', 'Authorization token is required');
    }
    request.authenticatedPlatformUser = authenticatedUser;
    return true;
  }
}

@Controller('platform-auth-probe')
class PlatformAuthProbeController {
  @Get()
  @UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
  @RequirePermissions('platform.manage')
  probe(): { success: true } {
    return { success: true };
  }
}

describe('Tenant role administration HTTP authorization', () => {
  let app: NestFastifyApplication;
  const validator = { validateMembership: vi.fn() };
  const tenantAuthorization = { authorize: vi.fn() };
  const platformAuthorization = { hasPermissions: vi.fn() };
  const roles = {
    listRoles: vi.fn(),
    getRole: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    replacePermissions: vi.fn(),
    listMembershipRoles: vi.fn(),
    assignRole: vi.fn(),
    removeRole: vi.fn(),
    bootstrapInitialOwner: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    validator.validateMembership.mockResolvedValue(validatedMembership);
    tenantAuthorization.authorize.mockResolvedValue(undefined);
    platformAuthorization.hasPermissions.mockResolvedValue(false);
    roles.listRoles.mockResolvedValue([]);
    roles.bootstrapInitialOwner.mockResolvedValue({ ownerMembershipId: membershipId, roles: [] });

    const tenantContextGuard = new TenantContextGuard(
      validator as unknown as TenantMembershipValidatorService,
      new TrustedTenantContextFactoryService(),
    );
    const tenantAuthorizationGuard = new TenantAuthorizationGuard(
      new Reflector(),
      tenantAuthorization as unknown as TenantAuthorizationService,
    );
    const platformAuthorizationGuard = new PlatformAuthorizationGuard(
      new Reflector(),
      platformAuthorization as unknown as PlatformAuthorizationService,
    );

    const module = await Test.createTestingModule({
      controllers: [
        TenantRoleController,
        TenantRoleBootstrapController,
        PlatformAuthProbeController,
      ],
      providers: [
        PlatformAuthGuard,
        PlatformAuthorizationGuard,
        TenantContextGuard,
        TenantAuthorizationGuard,
        TenantRoleService,
      ],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(PlatformAuthorizationGuard)
      .useValue(platformAuthorizationGuard)
      .overrideGuard(TenantContextGuard)
      .useValue(tenantContextGuard)
      .overrideGuard(TenantAuthorizationGuard)
      .useValue(tenantAuthorizationGuard)
      .overrideProvider(TenantRoleService)
      .useValue(roles)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 before tenant lookup when platform authentication is absent', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/roles`,
    });

    expect(response.statusCode).toBe(401);
    expect(validator.validateMembership).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated platform user has no active tenant membership', async () => {
    validator.validateMembership.mockRejectedValueOnce(new TenantContextInvalidError());

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/roles`,
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(403);
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(roles.listRoles).not.toHaveBeenCalled();
  });

  it('returns 403 for an active member without tenant.roles.read', async () => {
    tenantAuthorization.authorize.mockRejectedValueOnce(new TenantPermissionDeniedError());

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/roles`,
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(403);
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      'tenant.roles.read',
    );
    expect(roles.listRoles).not.toHaveBeenCalled();
  });

  it('returns success only after building trusted context from the route tenant and authorizing it', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/roles`,
      headers: {
        authorization: 'Bearer valid',
        'x-tenant-id': '99999999-9999-4999-8999-999999999999',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(validator.validateMembership).toHaveBeenCalledWith({
      authenticatedPlatformUser: authenticatedUser,
      tenantIdCandidate: tenantId,
    });
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      'tenant.roles.read',
    );
    expect(roles.listRoles).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
    );
  });

  it('does not let platform.manage authorize tenant role routes', async () => {
    platformAuthorization.hasPermissions.mockResolvedValue(true);
    tenantAuthorization.authorize.mockRejectedValueOnce(new TenantPermissionDeniedError());

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/roles`,
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(403);
    expect(platformAuthorization.hasPermissions).not.toHaveBeenCalled();
    expect(roles.listRoles).not.toHaveBeenCalled();
  });

  it('keeps platform role administration gated by platform.manage, not tenant permissions', async () => {
    tenantAuthorization.authorize.mockResolvedValue(undefined);
    platformAuthorization.hasPermissions.mockResolvedValue(false);

    const response = await app.inject({
      method: 'GET',
      url: '/api/platform-auth-probe',
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(403);
    expect(platformAuthorization.hasPermissions).toHaveBeenCalledWith(platformUserId, [
      'platform.manage',
    ]);
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
  });

  it('keeps initial owner bootstrap behind the platform authorization namespace', async () => {
    platformAuthorization.hasPermissions.mockResolvedValue(true);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/roles/bootstrap`,
      headers: { authorization: 'Bearer valid' },
      payload: { platformUserId: ownerUserId },
    });

    expect(response.statusCode).toBe(200);
    expect(platformAuthorization.hasPermissions).toHaveBeenCalledWith(platformUserId, [
      'platform.manage',
    ]);
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(roles.bootstrapInitialOwner).toHaveBeenCalledWith(
      tenantId,
      { platformUserId: ownerUserId },
      authenticatedUser,
      expect.any(Object),
    );
  });
});
