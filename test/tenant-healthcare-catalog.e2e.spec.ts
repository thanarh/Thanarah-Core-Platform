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
import { TenantContextGuard } from '../src/tenant/tenant-context.guard';
import { TenantContextInvalidError } from '../src/tenant/tenant-context.contract';
import type { TenantMembershipValidatorService } from '../src/tenant/tenant-context.service';
import { TrustedTenantContextFactoryService } from '../src/tenant/tenant-context.service';
import { TenantHealthcareCatalogController } from '../src/tenant/tenant-healthcare-catalog.controller';
import { HealthcareCatalogService } from '../src/tenant/healthcare-catalog.service';
import type { FastifyRequest } from 'fastify';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const departmentId = '33333333-3333-4333-8333-333333333333';
const specialtyId = '44444444-4444-4444-8444-444444444444';
const platformUserId = '55555555-5555-4555-8555-555555555555';

const authenticatedUser: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '66666666-6666-4666-8666-666666666666',
  tokenVersion: 1,
  platformRoleIds: ['PLATFORM_ADMIN'],
};

const validatedMembership = {
  tenantId: tenantId as TenantId,
  membershipId: membershipId as TenantMembershipId,
  platformUserId,
} as ValidatedTenantMembership;

const departmentResponse = {
  id: departmentId,
  tenantId,
  name: 'Cardiology',
  description: null,
  status: 'ACTIVE',
  statusChangedAt: '2026-10-07T10:00:00.000Z',
  suspendedAt: null,
  deactivatedAt: null,
  createdAt: '2026-10-07T10:00:00.000Z',
  updatedAt: '2026-10-07T10:00:00.000Z',
};
const specialtyResponse = { ...departmentResponse, id: specialtyId, name: 'Cardiology' };

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

describe('Tenant healthcare catalog HTTP authorization and routing', () => {
  let app: NestFastifyApplication;
  const validator = { validateMembership: vi.fn() };
  const tenantAuthorization = { authorize: vi.fn() };
  const catalogService = {
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
    validator.validateMembership.mockResolvedValue(validatedMembership);
    tenantAuthorization.authorize.mockResolvedValue(undefined);
    catalogService.create.mockImplementation(async (kind: string) =>
      kind === 'department' ? departmentResponse : specialtyResponse,
    );
    catalogService.list.mockImplementation(async (kind: string) => ({
      items: [kind === 'department' ? departmentResponse : specialtyResponse],
      limit: 50,
      offset: 0,
    }));
    catalogService.findById.mockImplementation(async (kind: string) =>
      kind === 'department' ? departmentResponse : specialtyResponse,
    );
    catalogService.update.mockImplementation(async (kind: string) =>
      kind === 'department' ? departmentResponse : specialtyResponse,
    );
    catalogService.activate.mockImplementation(async (kind: string) =>
      kind === 'department' ? departmentResponse : specialtyResponse,
    );
    catalogService.suspend.mockImplementation(async (kind: string) =>
      kind === 'department' ? departmentResponse : specialtyResponse,
    );
    catalogService.deactivate.mockImplementation(async (kind: string) =>
      kind === 'department' ? departmentResponse : specialtyResponse,
    );

    const tenantContextGuard = new TenantContextGuard(
      validator as unknown as TenantMembershipValidatorService,
      new TrustedTenantContextFactoryService(),
    );
    const tenantAuthorizationGuard = new TenantAuthorizationGuard(
      new Reflector(),
      tenantAuthorization as unknown as TenantAuthorizationService,
    );

    const module = await Test.createTestingModule({
      controllers: [TenantHealthcareCatalogController],
      providers: [
        PlatformAuthGuard,
        TenantContextGuard,
        TenantAuthorizationGuard,
        HealthcareCatalogService,
      ],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(TenantContextGuard)
      .useValue(tenantContextGuard)
      .overrideGuard(TenantAuthorizationGuard)
      .useValue(tenantAuthorizationGuard)
      .overrideProvider(HealthcareCatalogService)
      .useValue(catalogService)
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

  it('requires platform authentication before checking tenant membership', async () => {
    const response = await app.inject({ method: 'GET', url: `${root}/departments` });

    expect(response.statusCode).toBe(401);
    expect(validator.validateMembership).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(catalogService.list).not.toHaveBeenCalled();
  });

  it('requires the separate read permissions and returns lifecycle-aware lists', async () => {
    const departments = await app.inject({
      method: 'GET',
      url: `${root}/departments?status=SUSPENDED&limit=10&offset=5`,
      headers,
    });
    expect(departments.statusCode).toBe(200);
    expect(departments.json()).toEqual({
      items: [departmentResponse],
      limit: 50,
      offset: 0,
    });
    expect(catalogService.list).toHaveBeenCalledWith(
      'department',
      expect.objectContaining({ tenantId }),
      { status: 'SUSPENDED', limit: 10, offset: 5 },
    );
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.departments.read',
    );

    const specialties = await app.inject({
      method: 'GET',
      url: `${root}/specialties`,
      headers,
    });
    expect(specialties.statusCode).toBe(200);
    expect(catalogService.list).toHaveBeenLastCalledWith(
      'specialty',
      expect.objectContaining({ tenantId }),
      { limit: 50, offset: 0 },
    );
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.specialties.read',
    );
  });

  it('requires tenant permissions even when the authenticated user has a platform role', async () => {
    expect(authenticatedUser.platformRoleIds).toContain('PLATFORM_ADMIN');
    tenantAuthorization.authorize.mockRejectedValueOnce(new ForbiddenException());
    const read = await app.inject({ method: 'GET', url: `${root}/departments`, headers });
    expect(read.statusCode).toBe(403);
    expect(catalogService.list).not.toHaveBeenCalled();

    tenantAuthorization.authorize.mockRejectedValueOnce(new ForbiddenException());
    const write = await app.inject({
      method: 'POST',
      url: `${root}/specialties`,
      headers,
      payload: { name: 'Cardiology' },
    });
    expect(write.statusCode).toBe(403);
    expect(catalogService.create).not.toHaveBeenCalled();
  });

  it('creates tenant-owned definitions through strict payloads and manages no client permissions', async () => {
    const department = await app.inject({
      method: 'POST',
      url: `${root}/departments`,
      headers,
      payload: { name: 'Cardiology', description: 'Clinical division' },
    });
    expect(department.statusCode).toBe(201);
    expect(catalogService.create).toHaveBeenCalledWith(
      'department',
      expect.objectContaining({ tenantId }),
      { name: 'Cardiology', description: 'Clinical division' },
      authenticatedUser,
      expect.any(Object),
    );
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.departments.manage',
    );

    const specialty = await app.inject({
      method: 'POST',
      url: `${root}/specialties`,
      headers,
      payload: { name: 'Cardiology' },
    });
    expect(specialty.statusCode).toBe(201);
    expect(catalogService.create).toHaveBeenLastCalledWith(
      'specialty',
      expect.objectContaining({ tenantId }),
      { name: 'Cardiology' },
      authenticatedUser,
      expect.any(Object),
    );
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.specialties.manage',
    );

    const injectedFields = await app.inject({
      method: 'POST',
      url: `${root}/departments`,
      headers,
      payload: {
        name: 'Neurology',
        tenantId: otherTenantId,
        permissionCodes: ['tenant.departments.manage'],
        status: 'DEACTIVATED',
      },
    });
    expect(injectedFields.statusCode).toBe(400);
    expect(catalogService.create).toHaveBeenCalledTimes(2);
  });

  it('supports tenant-scoped read and update routes without exposing ownership changes', async () => {
    const department = await app.inject({
      method: 'GET',
      url: `${root}/departments/${departmentId}`,
      headers,
    });
    expect(department.statusCode).toBe(200);
    expect(catalogService.findById).toHaveBeenCalledWith(
      'department',
      expect.objectContaining({ tenantId }),
      departmentId,
    );

    const specialty = await app.inject({
      method: 'GET',
      url: `${root}/specialties/${specialtyId}`,
      headers,
    });
    expect(specialty.statusCode).toBe(200);
    expect(catalogService.findById).toHaveBeenLastCalledWith(
      'specialty',
      expect.objectContaining({ tenantId }),
      specialtyId,
    );

    const update = await app.inject({
      method: 'PATCH',
      url: `${root}/departments/${departmentId}`,
      headers,
      payload: { description: 'Updated description' },
    });
    expect(update.statusCode).toBe(200);
    expect(catalogService.update).toHaveBeenCalledWith(
      'department',
      expect.objectContaining({ tenantId }),
      departmentId,
      { description: 'Updated description' },
      authenticatedUser,
      expect.any(Object),
    );

    const injectedTenant = await app.inject({
      method: 'PATCH',
      url: `${root}/specialties/${specialtyId}`,
      headers,
      payload: { name: 'Neuro', tenantId: otherTenantId },
    });
    expect(injectedTenant.statusCode).toBe(400);
    const injectedStatus = await app.inject({
      method: 'PATCH',
      url: `${root}/specialties/${specialtyId}`,
      headers,
      payload: { name: 'Neuro', status: 'SUSPENDED' },
    });
    expect(injectedStatus.statusCode).toBe(400);
  });

  it('exposes the six dedicated lifecycle operations with manage permission', async () => {
    for (const resource of [
      { path: 'departments', id: departmentId, kind: 'department' },
      { path: 'specialties', id: specialtyId, kind: 'specialty' },
    ] as const) {
      for (const action of ['activate', 'suspend', 'deactivate'] as const) {
        const response = await app.inject({
          method: 'POST',
          url: `${root}/${resource.path}/${resource.id}/${action}`,
          headers,
        });
        expect(response.statusCode).toBe(200);
        expect(catalogService[action]).toHaveBeenLastCalledWith(
          resource.kind,
          expect.objectContaining({ tenantId }),
          resource.id,
          authenticatedUser,
          expect.any(Object),
        );
        expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
          expect.objectContaining({ tenantId }),
          `tenant.${resource.path}.manage`,
        );
      }
    }
  });

  it('rejects a route tenant that differs from the trusted membership', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${otherTenantId}/specialties`,
      headers,
    });

    expect(response.statusCode).toBe(403);
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(catalogService.list).not.toHaveBeenCalled();
  });

  it('does not allow an inactive tenant membership to mutate its catalog', async () => {
    validator.validateMembership.mockRejectedValueOnce(new TenantContextInvalidError());

    const response = await app.inject({
      method: 'POST',
      url: `${root}/departments`,
      headers,
      payload: { name: 'Cardiology' },
    });

    expect(response.statusCode).toBe(403);
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(catalogService.create).not.toHaveBeenCalled();
  });

  it('rejects client-supplied query ownership and does not expose delete endpoints', async () => {
    const queryInjection = await app.inject({
      method: 'GET',
      url: `${root}/departments?tenantId=${otherTenantId}`,
      headers,
    });
    expect(queryInjection.statusCode).toBe(400);
    expect(catalogService.list).not.toHaveBeenCalled();

    const deletion = await app.inject({
      method: 'DELETE',
      url: `${root}/departments/${departmentId}`,
      headers,
    });
    expect(deletion.statusCode).toBe(404);
  });

  it('publishes request, response, authorization, lifecycle, and error contracts in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Healthcare Catalog API')
        .setVersion('test')
        .addBearerAuth()
        .build(),
    );
    const departmentsPath = '/api/v1/tenants/{tenantId}/departments';
    const specialtiesPath = '/api/v1/tenants/{tenantId}/specialties';
    const createDepartment = document.paths[departmentsPath]?.post;
    const listDepartment = document.paths[departmentsPath]?.get;
    const createSpecialty = document.paths[specialtiesPath]?.post;
    const listSpecialty = document.paths[specialtiesPath]?.get;

    expect(createDepartment?.security).toEqual([{ bearer: [] }]);
    expect(listDepartment?.security).toEqual([{ bearer: [] }]);
    expect(createSpecialty?.security).toEqual([{ bearer: [] }]);
    expect(listSpecialty?.security).toEqual([{ bearer: [] }]);
    expect(createDepartment?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateHealthcareCatalogRequestDto' },
        },
      },
    });
    expect(createSpecialty?.responses?.['409']?.description).toContain('normalized name');
    expect(listDepartment?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'status',
          in: 'query',
          schema: { enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'], type: 'string' },
        }),
      ]),
    );

    const departmentSchema = document.components?.schemas?.DepartmentResponseDto as {
      properties?: Record<string, { enum?: string[]; format?: string }>;
    };
    const specialtySchema = document.components?.schemas?.SpecialtyResponseDto as {
      properties?: Record<string, { enum?: string[]; format?: string }>;
    };
    expect(departmentSchema.properties?.status?.enum).toEqual([
      'ACTIVE',
      'SUSPENDED',
      'DEACTIVATED',
    ]);
    expect(specialtySchema.properties?.status?.enum).toEqual([
      'ACTIVE',
      'SUSPENDED',
      'DEACTIVATED',
    ]);

    for (const [path, method] of [
      [`${departmentsPath}/{departmentId}`, 'get'],
      [`${departmentsPath}/{departmentId}`, 'patch'],
      [`${departmentsPath}/{departmentId}/activate`, 'post'],
      [`${departmentsPath}/{departmentId}/suspend`, 'post'],
      [`${departmentsPath}/{departmentId}/deactivate`, 'post'],
      [`${specialtiesPath}/{specialtyId}`, 'get'],
      [`${specialtiesPath}/{specialtyId}`, 'patch'],
      [`${specialtiesPath}/{specialtyId}/activate`, 'post'],
      [`${specialtiesPath}/{specialtyId}/suspend`, 'post'],
      [`${specialtiesPath}/{specialtyId}/deactivate`, 'post'],
    ] as const) {
      const operation = document.paths[path]?.[method];
      expect(operation).toBeDefined();
      expect(operation?.security).toEqual([{ bearer: [] }]);
      expect(operation?.responses?.['400']?.description).toBeTruthy();
    }

    expect(document.paths[`${departmentsPath}/{departmentId}`]?.delete).toBeUndefined();
    expect(document.paths).not.toHaveProperty('/api/v1/tenants/{tenantId}/doctors');
    expect(document.paths).not.toHaveProperty('/api/v1/tenants/{tenantId}/patients');
  });
});
