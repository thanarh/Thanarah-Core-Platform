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
import { PatientStatus } from '../src/tenant/patient.model';
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
import { PatientService } from '../src/tenant/patient.service';
import { TenantPatientController } from '../src/tenant/tenant-patient.controller';
import type { FastifyRequest } from 'fastify';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const patientId = '33333333-3333-4333-8333-333333333333';
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

const patientResponse = {
  id: patientId,
  patientNumber: 'PAT-000001',
  firstName: 'Amina',
  middleName: null,
  lastName: 'Hassan',
  preferredName: null,
  dateOfBirth: '1990-06-15',
  gender: null,
  phone: null,
  email: null,
  nationalId: null,
  address: null,
  status: PatientStatus.ACTIVE,
  createdAt: '2026-10-07T10:00:00.000Z',
  updatedAt: '2026-10-07T10:00:00.000Z',
};

const patientDirectoryResponse = {
  id: patientId,
  patientNumber: 'PAT-000001',
  firstName: 'Amina',
  middleName: null,
  lastName: 'Hassan',
  preferredName: null,
  phone: null,
  email: null,
  status: PatientStatus.ACTIVE,
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

describe('Tenant patient HTTP authorization and routing', () => {
  let app: NestFastifyApplication;
  const allowedPermissions = new Set<string>();
  const validator = { validateMembership: vi.fn() };
  const tenantAuthorization = { authorize: vi.fn() };
  const patients = {
    create: vi.fn(),
    list: vi.fn(),
    findByPatientNumber: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    allowedPermissions.clear();
    allowedPermissions.add('tenant.patients.read');
    allowedPermissions.add('tenant.patients.manage');
    validator.validateMembership.mockResolvedValue(validatedMembership);
    tenantAuthorization.authorize.mockImplementation(
      async (_context: unknown, permission: string) => {
        if (!allowedPermissions.has(permission)) throw new ForbiddenException();
      },
    );
    patients.create.mockResolvedValue(patientResponse);
    patients.list.mockResolvedValue({
      items: [patientDirectoryResponse],
      limit: 50,
      offset: 0,
      total: 1,
      hasNext: false,
    });
    patients.findByPatientNumber.mockResolvedValue(patientResponse);
    patients.findById.mockResolvedValue(patientResponse);
    patients.update.mockResolvedValue(patientResponse);
    patients.activate.mockResolvedValue(patientResponse);
    patients.deactivate.mockResolvedValue({ ...patientResponse, status: PatientStatus.INACTIVE });

    const tenantContextGuard = new TenantContextGuard(
      validator as unknown as TenantMembershipValidatorService,
      new TrustedTenantContextFactoryService(),
    );
    const tenantAuthorizationGuard = new TenantAuthorizationGuard(
      new Reflector(),
      tenantAuthorization as unknown as TenantAuthorizationService,
    );
    const module = await Test.createTestingModule({
      controllers: [TenantPatientController],
      providers: [PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard, PatientService],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(TenantContextGuard)
      .useValue(tenantContextGuard)
      .overrideGuard(TenantAuthorizationGuard)
      .useValue(tenantAuthorizationGuard)
      .overrideProvider(PatientService)
      .useValue(patients)
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
    const response = await app.inject({ method: 'GET', url: `${root}/patients` });

    expect(response.statusCode).toBe(401);
    expect(validator.validateMembership).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(patients.list).not.toHaveBeenCalled();
  });

  it('requires separate patient read and manage permissions', async () => {
    allowedPermissions.delete('tenant.patients.read');
    const deniedRead = await app.inject({
      method: 'GET',
      url: `${root}/patients`,
      headers,
    });
    expect(deniedRead.statusCode).toBe(403);
    expect(patients.list).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.patients.read',
    );

    const deniedDetailRead = await app.inject({
      method: 'GET',
      url: `${root}/patients/${patientId}`,
      headers,
    });
    expect(deniedDetailRead.statusCode).toBe(403);
    expect(patients.findById).not.toHaveBeenCalled();

    allowedPermissions.add('tenant.patients.read');
    const read = await app.inject({ method: 'GET', url: `${root}/patients`, headers });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      items: [patientDirectoryResponse],
      limit: 50,
      offset: 0,
      total: 1,
      hasNext: false,
    });
    expect(read.json().items[0]).not.toHaveProperty('tenantId');
    expect(read.json().items[0]).not.toHaveProperty('nationalId');
    expect(read.json().items[0]).not.toHaveProperty('address');

    allowedPermissions.delete('tenant.patients.read');
    const deniedNumberRead = await app.inject({
      method: 'GET',
      url: `${root}/patients/by-number/PAT-000001`,
      headers,
    });
    expect(deniedNumberRead.statusCode).toBe(403);
    expect(patients.findByPatientNumber).not.toHaveBeenCalled();
    allowedPermissions.add('tenant.patients.read');

    const numberRead = await app.inject({
      method: 'GET',
      url: `${root}/patients/by-number/PAT-000001`,
      headers,
    });
    expect(numberRead.statusCode).toBe(200);
    expect(patients.findByPatientNumber).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      'PAT-000001',
    );

    allowedPermissions.delete('tenant.patients.manage');
    const deniedManage = await app.inject({
      method: 'POST',
      url: `${root}/patients`,
      headers,
      payload: {
        patientNumber: 'PAT-000001',
        firstName: 'Amina',
        lastName: 'Hassan',
      },
    });
    expect(deniedManage.statusCode).toBe(403);
    expect(patients.create).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.patients.manage',
    );
  });

  it('does not allow client tenant hints to override the trusted tenant', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `${root}/patients`,
      headers: {
        ...headers,
        'x-tenant-id': otherTenantId,
        cookie: `tenantId=${otherTenantId}`,
      },
    });
    expect(list.statusCode).toBe(200);
    expect(patients.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), {
      limit: 50,
      offset: 0,
    });

    const bodyOverride = await app.inject({
      method: 'POST',
      url: `${root}/patients`,
      headers,
      payload: {
        tenantId: otherTenantId,
        patientNumber: 'PAT-000001',
        firstName: 'Amina',
        lastName: 'Hassan',
      },
    });
    expect(bodyOverride.statusCode).toBe(400);

    const queryOverride = await app.inject({
      method: 'GET',
      url: `${root}/patients?tenantId=${otherTenantId}`,
      headers,
    });
    expect(queryOverride.statusCode).toBe(400);
  });

  it('creates, lists, reads, updates, and clears nullable patient fields', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `${root}/patients`,
      headers,
      payload: {
        patientNumber: ' PAT-000001 ',
        firstName: ' Amina ',
        lastName: ' Hassan ',
        dateOfBirth: '1990-06-15',
        email: ' PERSON@EXAMPLE.COM ',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(patients.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      {
        patientNumber: 'PAT-000001',
        firstName: 'Amina',
        lastName: 'Hassan',
        dateOfBirth: new Date('1990-06-15T00:00:00.000Z'),
        email: 'person@example.com',
      },
      authenticatedUser,
      expect.any(Object),
    );

    const list = await app.inject({
      method: 'GET',
      url: `${root}/patients?status=INACTIVE&patientNumber=PAT-000001&search=mina&limit=10&offset=5`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(patients.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), {
      status: PatientStatus.INACTIVE,
      patientNumber: 'PAT-000001',
      search: 'mina',
      limit: 10,
      offset: 5,
    });

    const emptySearch = await app.inject({
      method: 'GET',
      url: `${root}/patients?search=%20%20`,
      headers,
    });
    expect(emptySearch.statusCode).toBe(200);
    expect(patients.list.mock.calls.at(-1)?.[1]).toMatchObject({
      limit: 50,
      offset: 0,
    });
    expect((patients.list.mock.calls.at(-1)?.[1] as { search?: string } | undefined)?.search).toBe(
      undefined,
    );

    const read = await app.inject({
      method: 'GET',
      url: `${root}/patients/${patientId}`,
      headers,
    });
    expect(read.statusCode).toBe(200);
    expect(patients.findById).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      patientId,
    );

    const updated = await app.inject({
      method: 'PATCH',
      url: `${root}/patients/${patientId}`,
      headers,
      payload: { phone: null, address: null },
    });
    expect(updated.statusCode).toBe(200);
    expect(patients.update).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      patientId,
      { phone: null, address: null },
      authenticatedUser,
      expect.any(Object),
    );
  });

  it('rejects invalid demographic/contact data, malformed IDs, and protected-field injection', async () => {
    const invalidPayloads = [
      { patientNumber: 'PAT-1', firstName: ' ', lastName: 'Hassan' },
      { patientNumber: 'PAT-1', firstName: 'Amina', lastName: 'Hassan', email: 'invalid' },
      { patientNumber: 'PAT-1', firstName: 'Amina', lastName: 'Hassan', phone: 'phone' },
      { patientNumber: 'PAT-1', firstName: 'Amina', lastName: 'Hassan', dateOfBirth: '2030-01-01' },
      {
        patientNumber: 'PAT-1',
        firstName: 'Amina',
        lastName: 'Hassan',
        address: '<script>bad</script>',
      },
      { patientNumber: 'PAT-1', firstName: 'A'.repeat(192), lastName: 'Hassan' },
      {
        patientNumber: 'PAT-1',
        firstName: 'Amina',
        lastName: 'Hassan',
        status: PatientStatus.INACTIVE,
      },
    ];
    for (const payload of invalidPayloads) {
      const response = await app.inject({
        method: 'POST',
        url: `${root}/patients`,
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }

    for (const payload of [{}, { tenantId: otherTenantId }, { status: PatientStatus.INACTIVE }]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `${root}/patients/${patientId}`,
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }

    const invalidDirectoryQueries = [
      `search=${'x'.repeat(101)}`,
      'search%5B%24regex%5D=.%2A',
      'filter%5B%24where%5D=true',
      'sort=patientNumber',
      'projection=nationalId',
      'status=UNKNOWN',
    ];
    for (const query of invalidDirectoryQueries) {
      const response = await app.inject({
        method: 'GET',
        url: `${root}/patients?${query}`,
        headers,
      });
      expect(response.statusCode).toBe(400);
    }

    const malformedId = await app.inject({
      method: 'GET',
      url: `${root}/patients/not-a-uuid`,
      headers,
    });
    expect(malformedId.statusCode).toBe(400);
    expect(patients.create).not.toHaveBeenCalled();
    expect(patients.list).not.toHaveBeenCalled();
    expect(patients.update).not.toHaveBeenCalled();
  });

  it('exposes only the explicit activate/deactivate lifecycle routes and no deletion', async () => {
    for (const action of ['activate', 'deactivate'] as const) {
      const response = await app.inject({
        method: 'POST',
        url: `${root}/patients/${patientId}/${action}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(patients[action]).toHaveBeenLastCalledWith(
        expect.objectContaining({ tenantId }),
        patientId,
        authenticatedUser,
        expect.any(Object),
      );
      expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
        expect.objectContaining({ tenantId }),
        'tenant.patients.manage',
      );
    }

    const deletion = await app.inject({
      method: 'DELETE',
      url: `${root}/patients/${patientId}`,
      headers,
    });
    expect(deletion.statusCode).toBe(404);
  });

  it('rejects a route tenant that differs from the validated tenant membership', async () => {
    const mismatchedTenant = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${otherTenantId}/patients`,
      headers,
    });
    expect(mismatchedTenant.statusCode).toBe(403);

    const mismatchedNumberLookup = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${otherTenantId}/patients/by-number/PAT-000001`,
      headers,
    });
    expect(mismatchedNumberLookup.statusCode).toBe(403);

    validator.validateMembership
      .mockRejectedValueOnce(new TenantContextInvalidError())
      .mockRejectedValueOnce(new TenantContextInvalidError())
      .mockRejectedValueOnce(new TenantContextInvalidError());
    const inactiveNumberMembership = await app.inject({
      method: 'GET',
      url: `${root}/patients/by-number/PAT-000001`,
      headers,
    });
    expect(inactiveNumberMembership.statusCode).toBe(403);
    const inactiveDetailMembership = await app.inject({
      method: 'GET',
      url: `${root}/patients/${patientId}`,
      headers,
    });
    expect(inactiveDetailMembership.statusCode).toBe(403);
    const inactiveMembership = await app.inject({
      method: 'GET',
      url: `${root}/patients`,
      headers,
    });
    expect(inactiveMembership.statusCode).toBe(403);
    expect(patients.list).not.toHaveBeenCalled();
    expect(patients.findById).not.toHaveBeenCalled();
    expect(patients.findByPatientNumber).not.toHaveBeenCalled();
  });

  it('publishes patient request, response, permission, filter, and lifecycle contracts in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Tenant Patient API')
        .setVersion('test')
        .addBearerAuth()
        .build(),
    );
    const collectionPath = '/api/v1/tenants/{tenantId}/patients';
    const resourcePath = `${collectionPath}/{patientId}`;
    const byNumberPath = `${collectionPath}/by-number/{patientNumber}`;
    const create = document.paths[collectionPath]?.post;
    const list = document.paths[collectionPath]?.get;
    const byNumber = document.paths[byNumberPath]?.get;

    expect(create?.security).toEqual([{ bearer: [] }]);
    expect(create?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreatePatientRequestDto' },
        },
      },
    });
    expect(responseDescription(create?.responses?.['403'])).toContain('tenant.patients.manage');
    expect(responseDescription(list?.responses?.['403'])).toContain('tenant.patients.read');
    expect(list?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'search',
          in: 'query',
          schema: expect.objectContaining({ maxLength: 100 }),
        }),
        expect.objectContaining({
          name: 'status',
          in: 'query',
          schema: { enum: ['ACTIVE', 'INACTIVE'], type: 'string' },
        }),
        expect.objectContaining({
          name: 'patientNumber',
          in: 'query',
          schema: expect.objectContaining({ maxLength: 64 }),
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
    expect(list?.description).toContain('createdAt descending then ID descending');
    expect(list?.description).toContain('case-insensitive literal substring');
    expect(byNumber?.security).toEqual([{ bearer: [] }]);
    expect(byNumber?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'patientNumber',
          in: 'path',
          schema: { type: 'string', minLength: 1, maxLength: 64 },
        }),
      ]),
    );
    expect(responseDescription(byNumber?.responses?.['403'])).toContain('tenant.patients.read');
    const directorySchema = document.components?.schemas?.PatientDirectoryEntryDto as {
      properties?: Record<string, unknown>;
    };
    expect(directorySchema.properties).toHaveProperty('patientNumber');
    expect(directorySchema.properties).not.toHaveProperty('nationalId');
    expect(directorySchema.properties).not.toHaveProperty('address');
    expect(directorySchema.properties).not.toHaveProperty('dateOfBirth');
    expect(document.paths[`${resourcePath}/activate`]?.post).toBeDefined();
    expect(document.paths[`${resourcePath}/deactivate`]?.post).toBeDefined();
    expect(document.paths[resourcePath]?.delete).toBeUndefined();

    const responseSchema = document.components?.schemas?.PatientResponseDto as {
      properties?: Record<string, { format?: string; maxLength?: number; nullable?: boolean }>;
    };
    expect(responseSchema.properties?.dateOfBirth).toMatchObject({
      format: 'date',
      nullable: true,
    });
    expect(responseSchema.properties?.nationalId).toMatchObject({ maxLength: 64, nullable: true });
  });
});
