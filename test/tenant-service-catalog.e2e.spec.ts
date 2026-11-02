import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
import { TenantContextInvalidError } from '../src/tenant/tenant-context.contract';
import { TenantContextGuard } from '../src/tenant/tenant-context.guard';
import type { TenantMembershipValidatorService } from '../src/tenant/tenant-context.service';
import { TrustedTenantContextFactoryService } from '../src/tenant/tenant-context.service';
import { ServiceCatalogService } from '../src/tenant/service-catalog.service';
import { TenantServiceCatalogController } from '../src/tenant/tenant-service-catalog.controller';
import type { FastifyRequest } from 'fastify';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const serviceId = '33333333-3333-4333-8333-333333333333';
const platformUserId = '44444444-4444-4444-8444-444444444444';

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

const serviceResponse = {
  id: serviceId,
  name: 'Consultation',
  code: 'CONS-01',
  description: 'General consultation',
  status: 'ACTIVE',
  statusChangedAt: '2026-10-07T10:00:00.000Z',
  suspendedAt: null,
  deactivatedAt: null,
  createdAt: '2026-10-07T10:00:00.000Z',
  updatedAt: '2026-10-07T10:00:00.000Z',
};

const responseDescription = (response: unknown): string | undefined =>
  (response as { description?: string } | undefined)?.description;

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

describe('Tenant service catalog HTTP authorization and routing', () => {
  let app: NestFastifyApplication;
  const allowedPermissions = new Set<string>();
  const validator = { validateMembership: vi.fn() };
  const tenantAuthorization = { authorize: vi.fn() };
  const serviceCatalog = {
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    activate: vi.fn(),
    suspend: vi.fn(),
    deactivate: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    allowedPermissions.clear();
    allowedPermissions.add('tenant.services.read');
    allowedPermissions.add('tenant.services.manage');
    validator.validateMembership.mockResolvedValue(validatedMembership);
    tenantAuthorization.authorize.mockImplementation(
      async (_context: unknown, permission: string) => {
        if (!allowedPermissions.has(permission)) throw new ForbiddenException();
      },
    );
    serviceCatalog.create.mockResolvedValue(serviceResponse);
    serviceCatalog.list.mockResolvedValue({
      items: [serviceResponse],
      limit: 50,
      offset: 0,
      total: 1,
      hasNext: false,
    });
    serviceCatalog.findById.mockResolvedValue(serviceResponse);
    serviceCatalog.update.mockResolvedValue(serviceResponse);
    serviceCatalog.activate.mockResolvedValue(serviceResponse);
    serviceCatalog.suspend.mockResolvedValue(serviceResponse);
    serviceCatalog.deactivate.mockResolvedValue(serviceResponse);

    const tenantContextGuard = new TenantContextGuard(
      validator as unknown as TenantMembershipValidatorService,
      new TrustedTenantContextFactoryService(),
    );
    const tenantAuthorizationGuard = new TenantAuthorizationGuard(
      new Reflector(),
      tenantAuthorization as unknown as TenantAuthorizationService,
    );
    const module = await Test.createTestingModule({
      controllers: [TenantServiceCatalogController],
      providers: [TenantContextGuard, TenantAuthorizationGuard, ServiceCatalogService],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(TenantContextGuard)
      .useValue(tenantContextGuard)
      .overrideGuard(TenantAuthorizationGuard)
      .useValue(tenantAuthorizationGuard)
      .overrideProvider(ServiceCatalogService)
      .useValue(serviceCatalog)
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
  const root = `/api/v1/tenants/${tenantId}`;

  it('rejects unauthenticated requests before tenant validation or authorization', async () => {
    const response = await app.inject({ method: 'GET', url: `${root}/services` });

    expect(response.statusCode).toBe(401);
    expect(validator.validateMembership).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(serviceCatalog.list).not.toHaveBeenCalled();
  });

  it('requires separate tenant read and manage permissions', async () => {
    allowedPermissions.delete('tenant.services.read');
    const deniedRead = await app.inject({
      method: 'GET',
      url: `${root}/services`,
      headers,
    });
    expect(deniedRead.statusCode).toBe(403);
    expect(serviceCatalog.list).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.services.read',
    );

    allowedPermissions.add('tenant.services.read');
    const read = await app.inject({ method: 'GET', url: `${root}/services`, headers });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      items: [serviceResponse],
      limit: 50,
      offset: 0,
      total: 1,
      hasNext: false,
    });
    expect(read.json().items[0]).not.toHaveProperty('tenantId');
    expect(serviceCatalog.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), {
      limit: 50,
      offset: 0,
    });

    allowedPermissions.delete('tenant.services.manage');
    const deniedManage = await app.inject({
      method: 'POST',
      url: `${root}/services`,
      headers,
      payload: { name: 'Consultation' },
    });
    expect(deniedManage.statusCode).toBe(403);
    expect(serviceCatalog.create).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.services.manage',
    );
  });

  it('does not allow body, header, cookie, or query values to override trusted tenant scope', async () => {
    const hintedTenant = await app.inject({
      method: 'GET',
      url: `${root}/services`,
      headers: {
        ...headers,
        'x-tenant-id': otherTenantId,
        cookie: `tenantId=${otherTenantId}`,
      },
      payload: { tenantId: otherTenantId },
    });

    expect(hintedTenant.statusCode).toBe(200);
    expect(serviceCatalog.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), {
      limit: 50,
      offset: 0,
    });

    const queryOverride = await app.inject({
      method: 'GET',
      url: `${root}/services?tenantId=${otherTenantId}`,
      headers,
    });
    expect(queryOverride.statusCode).toBe(400);
    expect(serviceCatalog.list).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid pagination and lifecycle query values', async () => {
    for (const query of [
      'status=INVALID',
      'limit=0',
      'limit=-1',
      'limit=101',
      'limit=not-a-number',
      'limit=',
      'offset=-1',
      'offset=not-a-number',
      'offset=100001',
      'offset=',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `${root}/services?${query}`,
        headers,
      });
      expect(response.statusCode, query).toBe(400);
    }
    expect(serviceCatalog.list).not.toHaveBeenCalled();
  });

  it('accepts the maximum bounded limit and offset', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${root}/services?limit=100&offset=100000`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(serviceCatalog.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), {
      limit: 100,
      offset: 100_000,
    });
  });

  it('creates, lists, reads, and updates tenant-owned services', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `${root}/services`,
      headers,
      payload: {
        name: ' Consultation ',
        code: 'CONS-01',
        description: 'General consultation',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(serviceCatalog.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      { name: 'Consultation', code: 'CONS-01', description: 'General consultation' },
      authenticatedUser,
      expect.any(Object),
    );

    const list = await app.inject({
      method: 'GET',
      url: `${root}/services?status=SUSPENDED&limit=10&offset=5`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(serviceCatalog.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), {
      status: 'SUSPENDED',
      limit: 10,
      offset: 5,
    });

    const read = await app.inject({
      method: 'GET',
      url: `${root}/services/${serviceId}`,
      headers,
    });
    expect(read.statusCode).toBe(200);
    expect(serviceCatalog.findById).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      serviceId,
    );

    const updated = await app.inject({
      method: 'PATCH',
      url: `${root}/services/${serviceId}`,
      headers,
      payload: { description: null, code: null },
    });
    expect(updated.statusCode).toBe(200);
    expect(serviceCatalog.update).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      serviceId,
      { code: null, description: null },
      authenticatedUser,
      expect.any(Object),
    );
  });

  it('rejects invalid text, malformed IDs, empty patches, and protected-field injection', async () => {
    for (const payload of [
      { name: ' ' },
      { name: 'Valid', code: ' ' },
      { name: 'Valid', code: 'x'.repeat(65) },
      { name: 'Valid', description: 'x'.repeat(2001) },
      { name: 'Valid', description: '<script>bad</script>' },
      { name: 'Valid', tenantId: otherTenantId },
      { name: 'Valid', status: 'SUSPENDED' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: `${root}/services`,
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }

    for (const payload of [
      {},
      { name: 'Valid', tenantId: otherTenantId },
      { status: 'SUSPENDED' },
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `${root}/services/${serviceId}`,
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }

    const malformedId = await app.inject({
      method: 'GET',
      url: `${root}/services/not-a-uuid`,
      headers,
    });
    expect(malformedId.statusCode).toBe(400);
    const queryOwnership = await app.inject({
      method: 'GET',
      url: `${root}/services?tenantId=${otherTenantId}`,
      headers,
    });
    expect(queryOwnership.statusCode).toBe(400);
    expect(serviceCatalog.create).not.toHaveBeenCalled();
    expect(serviceCatalog.update).not.toHaveBeenCalled();
  });

  it('routes all lifecycle operations with manage permission and does not expose deletion', async () => {
    for (const action of ['activate', 'suspend', 'deactivate'] as const) {
      const response = await app.inject({
        method: 'POST',
        url: `${root}/services/${serviceId}/${action}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(serviceCatalog[action]).toHaveBeenLastCalledWith(
        expect.objectContaining({ tenantId }),
        serviceId,
        authenticatedUser,
        expect.any(Object),
      );
      expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
        expect.objectContaining({ tenantId }),
        'tenant.services.manage',
      );
    }

    const deletion = await app.inject({
      method: 'DELETE',
      url: `${root}/services/${serviceId}`,
      headers,
    });
    expect(deletion.statusCode).toBe(404);
  });

  it('rejects a mismatched tenant and inactive membership before service access', async () => {
    const mismatchedTenant = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${otherTenantId}/services`,
      headers,
    });
    expect(mismatchedTenant.statusCode).toBe(403);

    validator.validateMembership.mockRejectedValueOnce(new TenantContextInvalidError());
    const inactiveMembership = await app.inject({
      method: 'GET',
      url: `${root}/services`,
      headers,
    });
    expect(inactiveMembership.statusCode).toBe(403);
    expect(serviceCatalog.list).not.toHaveBeenCalled();

    validator.validateMembership.mockRejectedValueOnce(new TenantContextInvalidError());
    const inactiveTenant = await app.inject({
      method: 'GET',
      url: `${root}/services`,
      headers,
    });
    expect(inactiveTenant.statusCode).toBe(403);
    expect(serviceCatalog.list).not.toHaveBeenCalled();
  });

  it('documents service DTOs, permissions, filters, lifecycle, and error responses in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Service Catalog API')
        .setVersion('test')
        .addBearerAuth()
        .build(),
    );
    const collectionPath = '/api/v1/tenants/{tenantId}/services';
    const resourcePath = `${collectionPath}/{serviceId}`;
    const create = document.paths[collectionPath]?.post;
    const list = document.paths[collectionPath]?.get;

    expect(create?.security).toEqual([{ bearer: [] }]);
    expect(create?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateServiceRequestDto' },
        },
      },
    });
    expect(responseDescription(create?.responses?.['403'])).toContain('tenant.services.manage');
    expect(responseDescription(list?.responses?.['403'])).toContain('tenant.services.read');
    expect(list?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'status',
          in: 'query',
          schema: { enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'], type: 'string' },
        }),
        expect.objectContaining({
          name: 'limit',
          in: 'query',
          schema: expect.objectContaining({ minimum: 1, maximum: 100 }),
        }),
        expect.objectContaining({
          name: 'offset',
          in: 'query',
          schema: expect.objectContaining({ minimum: 0, maximum: 100000 }),
        }),
      ]),
    );
    expect(list?.description).toContain('createdAt descending then id descending');

    const responseSchema = document.components?.schemas?.ServiceResponseDto as {
      properties?: Record<string, { enum?: string[]; maxLength?: number; nullable?: boolean }>;
    };
    expect(responseSchema.properties?.code).toMatchObject({ maxLength: 64, nullable: true });
    expect(responseSchema.properties?.status?.enum).toEqual(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']);
    expect(responseSchema.properties?.tenantId).toBeUndefined();
    const listSchema = document.components?.schemas?.ServiceListResponseDto as {
      properties?: Record<string, { type?: string; minimum?: number; maximum?: number }>;
    };
    expect(listSchema.properties?.total).toMatchObject({ type: 'number', minimum: 0 });
    expect(listSchema.properties?.hasNext).toMatchObject({ type: 'boolean' });
    for (const path of [
      resourcePath,
      `${resourcePath}/activate`,
      `${resourcePath}/suspend`,
      `${resourcePath}/deactivate`,
    ]) {
      expect(document.paths[path]).toBeDefined();
    }
    expect(document.paths[resourcePath]?.delete).toBeUndefined();
  });
});
