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
import { BranchController } from '../src/tenant/branch.controller';
import { BranchNotFoundError, BranchParentUnavailableError } from '../src/tenant/branch.errors';
import { BranchService } from '../src/tenant/branch.service';
import { TenantAuthorizationGuard } from '../src/tenant/tenant-authorization.guard';
import { TenantPermissionDeniedError } from '../src/tenant/tenant-authorization.errors';
import { TenantAuthorizationService } from '../src/tenant/tenant-authorization.service';
import {
  TenantContextInvalidError,
  type TenantId,
  type TenantMembershipId,
  type ValidatedTenantMembership,
} from '../src/tenant/tenant-context.contract';
import { TenantContextGuard } from '../src/tenant/tenant-context.guard';
import {
  TenantMembershipValidatorService,
  TrustedTenantContextFactoryService,
} from '../src/tenant/tenant-context.service';
import type { FastifyRequest } from 'fastify';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const facilityId = '33333333-3333-4333-8333-333333333333';
const otherFacilityId = '88888888-8888-4888-8888-888888888888';
const branchId = '44444444-4444-4444-8444-444444444444';
const platformUserId = '55555555-5555-4555-8555-555555555555';
const authenticatedUser: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '66666666-6666-4666-8666-666666666666',
  tokenVersion: 1,
  platformRoleIds: [],
};
const validatedMembership = {
  tenantId: tenantId as TenantId,
  membershipId: membershipId as TenantMembershipId,
  platformUserId,
} as ValidatedTenantMembership;
const branch = {
  id: branchId,
  facilityId,
  name: 'East Wing',
  status: 'ACTIVE',
};
const root = `/api/v1/tenants/${tenantId}/facilities/${facilityId}/branches`;

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

@Controller('branch-platform-authorization-probe')
class BranchPlatformAuthorizationProbeController {
  @Get()
  @UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
  @RequirePermissions('platform.manage')
  probe(): { success: true } {
    return { success: true };
  }
}

describe('Tenant Branch HTTP authorization and routing', () => {
  let app: NestFastifyApplication;
  const validator = { validateMembership: vi.fn() };
  const tenantAuthorization = { authorize: vi.fn() };
  const platformAuthorization = { hasPermissions: vi.fn() };
  const branches = {
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    suspend: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    validator.validateMembership.mockResolvedValue(validatedMembership);
    tenantAuthorization.authorize.mockResolvedValue(undefined);
    platformAuthorization.hasPermissions.mockResolvedValue(false);
    branches.create.mockResolvedValue(branch);
    branches.list.mockResolvedValue({ items: [], limit: 50, offset: 0 });
    branches.findById.mockResolvedValue(branch);
    branches.update.mockResolvedValue(branch);
    branches.suspend.mockResolvedValue(branch);
    branches.activate.mockResolvedValue(branch);
    branches.deactivate.mockResolvedValue(branch);

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
      controllers: [BranchController, BranchPlatformAuthorizationProbeController],
      providers: [
        PlatformAuthorizationGuard,
        TenantContextGuard,
        TenantAuthorizationGuard,
        BranchService,
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
      .overrideProvider(BranchService)
      .useValue(branches)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const validHeaders = { authorization: 'Bearer valid' };

  it('requires platform authentication before tenant resolution', async () => {
    const response = await app.inject({ method: 'GET', url: root });

    expect(response.statusCode).toBe(401);
    expect(validator.validateMembership).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(branches.list).not.toHaveBeenCalled();
  });

  it('rejects a route tenant without an active membership', async () => {
    validator.validateMembership.mockRejectedValueOnce(new TenantContextInvalidError());

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${otherTenantId}/facilities/${facilityId}/branches`,
      headers: validHeaders,
    });

    expect(response.statusCode).toBe(403);
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(branches.list).not.toHaveBeenCalled();
  });

  it('checks the server-defined Branch permission before invoking the service', async () => {
    tenantAuthorization.authorize.mockRejectedValueOnce(new TenantPermissionDeniedError());

    const response = await app.inject({
      method: 'POST',
      url: root,
      headers: validHeaders,
      payload: { name: 'East Wing' },
    });

    expect(response.statusCode).toBe(403);
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.branches.create',
    );
    expect(branches.create).not.toHaveBeenCalled();
  });

  it('does not treat a platform permission or client permission header as Branch permission', async () => {
    tenantAuthorization.authorize.mockRejectedValueOnce(new TenantPermissionDeniedError());
    platformAuthorization.hasPermissions.mockResolvedValueOnce(true);

    const response = await app.inject({
      method: 'POST',
      url: root,
      headers: {
        ...validHeaders,
        'x-tenant-permissions': 'tenant.branches.create',
        'x-platform-permissions': 'platform.manage',
      },
      payload: { name: 'East Wing' },
    });

    expect(response.statusCode).toBe(403);
    expect(platformAuthorization.hasPermissions).not.toHaveBeenCalled();
    expect(branches.create).not.toHaveBeenCalled();
  });

  it('passes trusted tenant context and route Facility separately from the strict body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: root,
      headers: validHeaders,
      payload: { name: '  East   Wing ' },
    });

    expect(response.statusCode).toBe(201);
    expect(branches.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        membershipId,
        platformUserId,
      }),
      facilityId,
      { name: 'East Wing' },
      authenticatedUser,
      expect.objectContaining({ ipAddress: expect.any(String) }),
    );
  });

  it.each([
    { key: 'tenantId', value: otherTenantId },
    { key: 'facilityId', value: otherFacilityId },
    { key: 'status', value: 'DEACTIVATED' },
  ])('rejects client-supplied $key on Branch creation', async ({ key, value }) => {
    const response = await app.inject({
      method: 'POST',
      url: root,
      headers: validHeaders,
      payload: { name: 'East Wing', [key]: value },
    });

    expect(response.statusCode).toBe(400);
    expect(branches.create).not.toHaveBeenCalled();
  });

  it.each([
    { method: 'GET', path: '', permission: 'tenant.branches.read', action: 'list' },
    {
      method: 'GET',
      path: `/${branchId}`,
      permission: 'tenant.branches.read',
      action: 'findById',
    },
    {
      method: 'PATCH',
      path: `/${branchId}`,
      permission: 'tenant.branches.update',
      action: 'update',
    },
    {
      method: 'POST',
      path: `/${branchId}/suspend`,
      permission: 'tenant.branches.suspend',
      action: 'suspend',
    },
    {
      method: 'POST',
      path: `/${branchId}/activate`,
      permission: 'tenant.branches.activate',
      action: 'activate',
    },
    {
      method: 'POST',
      path: `/${branchId}/deactivate`,
      permission: 'tenant.branches.deactivate',
      action: 'deactivate',
    },
  ])('authorizes $method $path with $permission', async ({ method, path, permission, action }) => {
    const payload = method === 'PATCH' ? { name: 'Updated name' } : undefined;
    const response = await app.inject({
      method: method as 'GET' | 'PATCH' | 'POST',
      url: `${root}${path}`,
      headers: validHeaders,
      payload,
    });

    expect(response.statusCode).toBe(method === 'POST' && path === '' ? 201 : 200);
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      permission,
    );
    expect(branches[action as keyof typeof branches]).toHaveBeenCalled();
  });

  it('hides a Branch reached through a different Facility and returns a safe 404', async () => {
    branches.findById.mockRejectedValueOnce(new BranchNotFoundError());

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/facilities/${otherFacilityId}/branches/${branchId}`,
      headers: validHeaders,
    });

    expect(response.statusCode).toBe(404);
    expect(branches.findById).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      otherFacilityId,
      branchId,
    );
    expect(response.body).not.toContain(otherTenantId);
  });

  it('returns 409 when the parent Facility is unavailable', async () => {
    branches.list.mockRejectedValueOnce(new BranchParentUnavailableError());

    const response = await app.inject({
      method: 'GET',
      url: root,
      headers: validHeaders,
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toContain('BRANCH_PARENT_UNAVAILABLE');
  });

  it('does not expose a physical Branch delete route', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `${root}/${branchId}`,
      headers: validHeaders,
    });

    expect(response.statusCode).toBe(404);
    expect(branches).not.toHaveProperty('delete');
  });
});
