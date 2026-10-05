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
import { FacilityController } from '../src/tenant/facility.controller';
import { FacilityNotFoundError } from '../src/tenant/facility.errors';
import { FacilityService } from '../src/tenant/facility.service';
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
const platformUserId = '44444444-4444-4444-8444-444444444444';
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
const facility = {
  id: facilityId,
  tenantId,
  name: 'North Clinic',
  status: 'ACTIVE',
};

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

@Controller('facility-platform-authorization-probe')
class FacilityPlatformAuthorizationProbeController {
  @Get()
  @UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
  @RequirePermissions('platform.manage')
  probe(): { success: true } {
    return { success: true };
  }
}

describe('Tenant Facility HTTP authorization', () => {
  let app: NestFastifyApplication;
  const validator = { validateMembership: vi.fn() };
  const tenantAuthorization = { authorize: vi.fn() };
  const platformAuthorization = { hasPermissions: vi.fn() };
  const facilities = {
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
    facilities.create.mockResolvedValue(facility);
    facilities.list.mockResolvedValue({ items: [], limit: 50, offset: 0 });
    facilities.findById.mockResolvedValue(facility);
    facilities.update.mockResolvedValue(facility);
    facilities.suspend.mockResolvedValue(facility);
    facilities.activate.mockResolvedValue(facility);
    facilities.deactivate.mockResolvedValue(facility);

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
      controllers: [FacilityController, FacilityPlatformAuthorizationProbeController],
      providers: [
        PlatformAuthGuard,
        PlatformAuthorizationGuard,
        TenantContextGuard,
        TenantAuthorizationGuard,
        FacilityService,
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
      .overrideProvider(FacilityService)
      .useValue(facilities)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 before resolving tenant context when platform authentication is absent', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/facilities`,
    });

    expect(response.statusCode).toBe(401);
    expect(validator.validateMembership).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(facilities.list).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user has no membership for the route tenant', async () => {
    validator.validateMembership.mockRejectedValueOnce(new TenantContextInvalidError());

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${otherTenantId}/facilities`,
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(403);
    expect(validator.validateMembership).toHaveBeenCalledWith({
      authenticatedPlatformUser: authenticatedUser,
      tenantIdCandidate: otherTenantId,
    });
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(facilities.list).not.toHaveBeenCalled();
  });

  it('returns 403 without the server-defined facility permission', async () => {
    tenantAuthorization.authorize.mockRejectedValueOnce(new TenantPermissionDeniedError());

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenantId}/facilities`,
      headers: { authorization: 'Bearer valid' },
      payload: { name: 'North Clinic' },
    });

    expect(response.statusCode).toBe(403);
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      'tenant.facilities.create',
    );
    expect(facilities.create).not.toHaveBeenCalled();
  });

  it('uses only the trusted tenant context when creating a facility', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenantId}/facilities`,
      headers: { authorization: 'Bearer valid', 'x-tenant-id': otherTenantId },
      payload: { name: ' North   Clinic ' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(facility);
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      'tenant.facilities.create',
    );
    expect(facilities.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      { name: 'North Clinic' },
      authenticatedUser,
      expect.any(Object),
    );
  });

  it('rejects body-supplied ownership instead of allowing tenant reassignment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenantId}/facilities`,
      headers: { authorization: 'Bearer valid' },
      payload: { name: 'North Clinic', tenantId: otherTenantId },
    });

    expect(response.statusCode).toBe(400);
    expect(facilities.create).not.toHaveBeenCalled();
  });

  it('uses server metadata for reads and ignores client role/permission headers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/facilities?status=ACTIVE`,
      headers: {
        authorization: 'Bearer valid',
        'x-tenant-role': 'OWNER',
        'x-tenant-permission': 'tenant.facilities.deactivate',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      'tenant.facilities.read',
    );
    expect(facilities.list).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      { status: 'ACTIVE', limit: 50, offset: 0 },
    );
  });

  it('performs lifecycle actions through fixed, separately authorized operations', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenantId}/facilities/${facilityId}/suspend`,
      headers: { authorization: 'Bearer valid' },
      payload: { status: 'ACTIVE' },
    });

    expect(response.statusCode).toBe(200);
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      'tenant.facilities.suspend',
    );
    expect(facilities.suspend).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      facilityId,
      authenticatedUser,
      expect.any(Object),
    );
    expect(facilities.activate).not.toHaveBeenCalled();
  });

  it('returns the same scoped not-found error for a facility outside the tenant', async () => {
    facilities.findById.mockRejectedValueOnce(new FacilityNotFoundError());

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/facilities/${facilityId}`,
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(404);
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      'tenant.facilities.read',
    );
  });

  it('does not allow platform permissions to substitute for tenant facility permissions', async () => {
    tenantAuthorization.authorize.mockRejectedValueOnce(new TenantPermissionDeniedError());

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/facilities`,
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.statusCode).toBe(403);
    expect(platformAuthorization.hasPermissions).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, membershipId, platformUserId }),
      'tenant.facilities.read',
    );
    expect(facilities.list).not.toHaveBeenCalled();
  });
});
