import {
  Controller,
  ForbiddenException,
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
import { TenantStaffController } from '../src/tenant/tenant-staff.controller';
import { TenantStaffNotFoundError } from '../src/tenant/tenant-staff.errors';
import { TenantStaffService } from '../src/tenant/tenant-staff.service';
import { TenantAuthorizationGuard } from '../src/tenant/tenant-authorization.guard';
import type { TenantAuthorizationService } from '../src/tenant/tenant-authorization.service';
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
const staffId = '33333333-3333-4333-8333-333333333333';
const platformUserId = '44444444-4444-4444-8444-444444444444';
const staff = {
  id: staffId,
  membershipId,
  displayName: 'Taylor Member',
  jobTitle: null,
  status: 'ACTIVE',
  statusChangedAt: '2026-10-06T10:00:00.000Z',
  suspendedAt: null,
  deactivatedAt: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  updatedAt: '2026-10-06T10:00:00.000Z',
};
const root = `/api/v1/tenants/${tenantId}/staff`;
const authenticatedUser: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: ['PLATFORM_ADMIN'],
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

@Controller('staff-platform-authorization-probe')
class StaffPlatformAuthorizationProbeController {
  @Get()
  @UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
  @RequirePermissions('platform.manage')
  probe(): { success: true } {
    return { success: true };
  }
}

describe('Tenant Staff HTTP authorization and routing', () => {
  let app: NestFastifyApplication;
  const validator = { validateMembership: vi.fn() };
  const tenantAuthorization = { authorize: vi.fn() };
  const platformAuthorization = { hasPermissions: vi.fn() };
  const staffService = {
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
    staffService.create.mockResolvedValue(staff);
    staffService.list.mockResolvedValue({ items: [staff], limit: 50, offset: 0 });
    staffService.findById.mockResolvedValue(staff);
    staffService.update.mockResolvedValue(staff);
    staffService.suspend.mockResolvedValue(staff);
    staffService.activate.mockResolvedValue(staff);
    staffService.deactivate.mockResolvedValue(staff);

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
      controllers: [TenantStaffController, StaffPlatformAuthorizationProbeController],
      providers: [
        PlatformAuthGuard,
        PlatformAuthorizationGuard,
        TenantContextGuard,
        TenantAuthorizationGuard,
        TenantStaffService,
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
      .overrideProvider(TenantStaffService)
      .useValue(staffService)
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
    expect(staffService.list).not.toHaveBeenCalled();
  });

  it('rejects a route tenant without an active membership', async () => {
    validator.validateMembership.mockRejectedValueOnce(new TenantContextInvalidError());

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${otherTenantId}/staff`,
      headers: validHeaders,
    });

    expect(response.statusCode).toBe(403);
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(staffService.list).not.toHaveBeenCalled();
  });

  it('requires tenant permission even when the platform user has a platform role', async () => {
    tenantAuthorization.authorize.mockRejectedValueOnce(new ForbiddenException());

    const response = await app.inject({
      method: 'POST',
      url: root,
      headers: validHeaders,
      payload: { membershipId },
    });

    expect(response.statusCode).toBe(403);
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.staff.manage',
    );
    expect(staffService.create).not.toHaveBeenCalled();
  });

  it.each([
    { key: 'tenantId', value: otherTenantId },
    { key: 'userId', value: otherTenantId },
    { key: 'status', value: 'DEACTIVATED' },
    { key: 'roleId', value: otherTenantId },
  ])('rejects client-supplied $key on staff creation', async ({ key, value }) => {
    const response = await app.inject({
      method: 'POST',
      url: root,
      headers: validHeaders,
      payload: { membershipId, [key]: value },
    });

    expect(response.statusCode).toBe(400);
    expect(staffService.create).not.toHaveBeenCalled();
  });

  it('rejects tenant selectors supplied outside the trusted route context', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${root}?tenantId=${otherTenantId}`,
      headers: validHeaders,
    });

    expect(response.statusCode).toBe(400);
    expect(staffService.list).not.toHaveBeenCalled();
  });

  it.each([
    { method: 'GET', path: '', permission: 'tenant.staff.read', action: 'list' },
    {
      method: 'GET',
      path: `/${staffId}`,
      permission: 'tenant.staff.read',
      action: 'findById',
    },
    {
      method: 'POST',
      path: '',
      permission: 'tenant.staff.manage',
      action: 'create',
    },
    {
      method: 'PATCH',
      path: `/${staffId}`,
      permission: 'tenant.staff.manage',
      action: 'update',
    },
    {
      method: 'POST',
      path: `/${staffId}/suspend`,
      permission: 'tenant.staff.manage',
      action: 'suspend',
    },
    {
      method: 'POST',
      path: `/${staffId}/activate`,
      permission: 'tenant.staff.manage',
      action: 'activate',
    },
    {
      method: 'POST',
      path: `/${staffId}/deactivate`,
      permission: 'tenant.staff.manage',
      action: 'deactivate',
    },
  ])('authorizes $method $path with $permission', async ({ method, path, permission, action }) => {
    const payload =
      method === 'PATCH'
        ? { displayName: 'Taylor Updated' }
        : method === 'POST' && path === ''
          ? { membershipId }
          : undefined;
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
    expect(staffService[action as keyof typeof staffService]).toHaveBeenCalled();
  });

  it('returns only the staff presentation fields from the API', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${root}/${staffId}`,
      headers: validHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: staffId,
      membershipId,
      displayName: 'Taylor Member',
    });
    expect(response.json()).not.toHaveProperty('tenantId');
    expect(response.json()).not.toHaveProperty('userId');
  });

  it('returns a safe 404 when a staff ID is outside the trusted tenant', async () => {
    staffService.findById.mockRejectedValueOnce(new TenantStaffNotFoundError());

    const response = await app.inject({
      method: 'GET',
      url: `${root}/${staffId}`,
      headers: validHeaders,
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(otherTenantId);
    expect(staffService.findById).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      staffId,
    );
  });
});
