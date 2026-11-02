import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { AuthenticationError } from '../src/auth/errors/auth.errors';
import { PlatformAuthGuard } from '../src/auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../src/common/constants/app.constants';
import { TenantAuthorizationGuard } from '../src/tenant/tenant-authorization.guard';
import type { TenantAuthorizationService } from '../src/tenant/tenant-authorization.service';
import {
  type TenantId,
  type TenantMembershipId,
  type ValidatedTenantMembership,
} from '../src/tenant/tenant-context.contract';
import { TenantContextGuard } from '../src/tenant/tenant-context.guard';
import type { TenantMembershipValidatorService } from '../src/tenant/tenant-context.service';
import { TrustedTenantContextFactoryService } from '../src/tenant/tenant-context.service';
import { TenantStaffScopeController } from '../src/tenant/tenant-staff-scope.controller';
import { TenantStaffScopeService } from '../src/tenant/tenant-staff-scope.service';
import type { FastifyRequest } from 'fastify';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const staffId = '33333333-3333-4333-8333-333333333333';
const facilityId = '44444444-4444-4444-8444-444444444444';
const branchId = '55555555-5555-4555-8555-555555555555';
const platformUserId = '66666666-6666-4666-8666-666666666666';

const authenticatedUser: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '77777777-7777-4777-8777-777777777777',
  tokenVersion: 1,
  platformRoleIds: ['PLATFORM_ADMIN'],
};

const validatedMembership = {
  tenantId: tenantId as TenantId,
  membershipId: membershipId as TenantMembershipId,
  platformUserId,
} as ValidatedTenantMembership;

const facilityResponse = {
  staffId,
  facilityId,
  facilityName: 'North Facility',
  facilityStatus: 'ACTIVE',
  assignedAt: '2026-10-07T10:00:00.000Z',
};
const branchResponse = {
  staffId,
  branchId,
  branchName: 'Central Branch',
  branchStatus: 'ACTIVE',
  facility: { id: facilityId, name: 'North Facility', status: 'ACTIVE' },
  assignedAt: '2026-10-07T10:00:00.000Z',
};

class TestAuthenticationGuard {
  canActivate(context: { switchToHttp(): { getRequest(): FastifyRequest } }): boolean {
    const request = context.switchToHttp().getRequest();
    if (request.headers.authorization !== 'Bearer valid') {
      throw new AuthenticationError('AUTH_TOKEN_MISSING', 'Authorization token is required');
    }
    request.authenticatedPlatformUser = authenticatedUser;
    return true;
  }
}

describe('Tenant staff scope HTTP authorization and routing', () => {
  let app: NestFastifyApplication;
  const validator = { validateMembership: vi.fn() };
  const tenantAuthorization = { authorize: vi.fn() };
  const scopeService = {
    listFacilities: vi.fn(),
    assignFacility: vi.fn(),
    removeFacility: vi.fn(),
    listBranches: vi.fn(),
    assignBranch: vi.fn(),
    removeBranch: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    validator.validateMembership.mockResolvedValue(validatedMembership);
    tenantAuthorization.authorize.mockResolvedValue(undefined);
    scopeService.listFacilities.mockResolvedValue({ items: [facilityResponse] });
    scopeService.assignFacility.mockResolvedValue(facilityResponse);
    scopeService.removeFacility.mockResolvedValue(undefined);
    scopeService.listBranches.mockResolvedValue({ items: [branchResponse] });
    scopeService.assignBranch.mockResolvedValue(branchResponse);
    scopeService.removeBranch.mockResolvedValue(undefined);

    const tenantContextGuard = new TenantContextGuard(
      validator as unknown as TenantMembershipValidatorService,
      new TrustedTenantContextFactoryService(),
    );
    const tenantAuthorizationGuard = new TenantAuthorizationGuard(
      new Reflector(),
      tenantAuthorization as unknown as TenantAuthorizationService,
    );

    const module = await Test.createTestingModule({
      controllers: [TenantStaffScopeController],
      providers: [TenantContextGuard, TenantAuthorizationGuard, TenantStaffScopeService],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(TenantContextGuard)
      .useValue(tenantContextGuard)
      .overrideGuard(TenantAuthorizationGuard)
      .useValue(tenantAuthorizationGuard)
      .overrideProvider(TenantStaffScopeService)
      .useValue(scopeService)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const headers = { authorization: 'Bearer valid' };
  const root = `/api/v1/tenants/${tenantId}/staff/${staffId}`;

  it('requires platform authentication before resolving tenant scope', async () => {
    const response = await app.inject({ method: 'GET', url: `${root}/facilities` });

    expect(response.statusCode).toBe(401);
    expect(validator.validateMembership).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(scopeService.listFacilities).not.toHaveBeenCalled();
  });

  it('requires the tenant scope read permission for facility and branch lists', async () => {
    const facilities = await app.inject({ method: 'GET', url: `${root}/facilities`, headers });
    expect(facilities.statusCode).toBe(200);
    expect(facilities.json()).toEqual({ items: [facilityResponse] });
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.staff.scope.read',
    );
    expect(scopeService.listFacilities).toHaveBeenCalledOnce();

    tenantAuthorization.authorize.mockClear();
    const branches = await app.inject({ method: 'GET', url: `${root}/branches`, headers });
    expect(branches.statusCode).toBe(200);
    expect(branches.json()).toEqual({ items: [branchResponse] });
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.staff.scope.read',
    );
    expect(scopeService.listBranches).toHaveBeenCalledOnce();
  });

  it('denies reads before reaching the service when scope permission is absent', async () => {
    tenantAuthorization.authorize.mockRejectedValueOnce(new ForbiddenException());

    const response = await app.inject({ method: 'GET', url: `${root}/facilities`, headers });

    expect(response.statusCode).toBe(403);
    expect(scopeService.listFacilities).not.toHaveBeenCalled();
  });

  it('denies assignment mutations before reaching the service without manage permission', async () => {
    tenantAuthorization.authorize.mockRejectedValueOnce(new ForbiddenException());

    const response = await app.inject({
      method: 'POST',
      url: `${root}/facilities`,
      headers,
      payload: { facilityId },
    });

    expect(response.statusCode).toBe(403);
    expect(scopeService.assignFacility).not.toHaveBeenCalled();
  });

  it('requires manage permission and accepts only a facility or branch ID', async () => {
    const assignFacility = await app.inject({
      method: 'POST',
      url: `${root}/facilities`,
      headers,
      payload: { facilityId },
    });
    expect(assignFacility.statusCode).toBe(201);
    expect(scopeService.assignFacility).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      staffId,
      { facilityId },
      authenticatedUser,
      expect.any(Object),
    );
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.staff.scope.manage',
    );

    const assignBranch = await app.inject({
      method: 'POST',
      url: `${root}/branches`,
      headers,
      payload: { branchId },
    });
    expect(assignBranch.statusCode).toBe(201);
    expect(scopeService.assignBranch).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      staffId,
      { branchId },
      authenticatedUser,
      expect.any(Object),
    );
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.staff.scope.manage',
    );

    const injectedAuthority = await app.inject({
      method: 'POST',
      url: `${root}/branches`,
      headers,
      payload: { branchId, tenantId, permissionCodes: ['tenant.staff.scope.manage'] },
    });
    expect(injectedAuthority.statusCode).toBe(400);
    expect(scopeService.assignBranch).toHaveBeenCalledOnce();
  });

  it('removes only the requested assignment and returns no content', async () => {
    const facility = await app.inject({
      method: 'DELETE',
      url: `${root}/facilities/${facilityId}`,
      headers,
    });
    expect(facility.statusCode).toBe(204);
    expect(scopeService.removeFacility).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      staffId,
      facilityId,
      authenticatedUser,
      expect.any(Object),
    );

    const branch = await app.inject({
      method: 'DELETE',
      url: `${root}/branches/${branchId}`,
      headers,
    });
    expect(branch.statusCode).toBe(204);
    expect(scopeService.removeBranch).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      staffId,
      branchId,
      authenticatedUser,
      expect.any(Object),
    );
    expect(tenantAuthorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.staff.scope.manage',
    );
  });

  it('rejects a route tenant that does not match the server-validated membership', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${otherTenantId}/staff/${staffId}/branches`,
      headers,
    });

    expect(response.statusCode).toBe(403);
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(scopeService.listBranches).not.toHaveBeenCalled();
  });
});
