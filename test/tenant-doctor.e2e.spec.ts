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
import { DoctorController } from '../src/tenant/doctor.controller';
import { DoctorService } from '../src/tenant/doctor.service';
import { DoctorProfessionalCodeConflictError } from '../src/tenant/doctor.errors';
import type { FastifyRequest } from 'fastify';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const staffId = '33333333-3333-4333-8333-333333333333';
const doctorId = '44444444-4444-4444-8444-444444444444';
const departmentId = '55555555-5555-4555-8555-555555555555';
const specialtyId = '66666666-6666-4666-8666-666666666666';
const serviceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const facilityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const branchId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const platformUserId = '77777777-7777-4777-8777-777777777777';

const authenticatedUser: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '88888888-8888-4888-8888-888888888888',
  tokenVersion: 1,
  platformRoleIds: ['PLATFORM_ADMIN'],
};

const validatedMembership = {
  tenantId: tenantId as TenantId,
  membershipId: membershipId as TenantMembershipId,
  platformUserId,
} as ValidatedTenantMembership;

const doctorResponse = {
  id: doctorId,
  tenantId,
  staffId,
  staff: { id: staffId, displayName: 'Taylor Member', status: 'ACTIVE' },
  professionalDisplayName: 'Dr Taylor Member',
  professionalTitle: 'Consultant',
  professionalCode: 'MD-100',
  bio: 'Professional biography',
  status: 'ACTIVE',
  operationallyActive: true,
  departments: [
    {
      id: departmentId,
      name: 'Cardiology',
      status: 'ACTIVE',
      assignedAt: '2026-10-07T10:00:00.000Z',
    },
  ],
  specialties: [
    {
      id: specialtyId,
      name: 'Interventional Cardiology',
      status: 'ACTIVE',
      assignedAt: '2026-10-07T10:00:00.000Z',
    },
  ],
  statusChangedAt: '2026-10-07T10:00:00.000Z',
  suspendedAt: null,
  deactivatedAt: null,
  createdAt: '2026-10-07T10:00:00.000Z',
  updatedAt: '2026-10-07T10:00:00.000Z',
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

describe('Tenant Doctor HTTP authorization and routing', () => {
  let app: NestFastifyApplication;
  const validator = { validateMembership: vi.fn() };
  const tenantAuthorization = { authorize: vi.fn() };
  const doctorService = {
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    activate: vi.fn(),
    suspend: vi.fn(),
    deactivate: vi.fn(),
    listDepartments: vi.fn(),
    assignDepartment: vi.fn(),
    unassignDepartment: vi.fn(),
    listSpecialties: vi.fn(),
    assignSpecialty: vi.fn(),
    unassignSpecialty: vi.fn(),
    listServiceAssignments: vi.fn(),
    assignService: vi.fn(),
    unassignService: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    validator.validateMembership.mockResolvedValue(validatedMembership);
    tenantAuthorization.authorize.mockResolvedValue(undefined);
    doctorService.create.mockResolvedValue(doctorResponse);
    doctorService.list.mockResolvedValue({ items: [doctorResponse], limit: 50, offset: 0 });
    doctorService.findById.mockResolvedValue(doctorResponse);
    doctorService.update.mockResolvedValue(doctorResponse);
    doctorService.activate.mockResolvedValue(doctorResponse);
    doctorService.suspend.mockResolvedValue(doctorResponse);
    doctorService.deactivate.mockResolvedValue(doctorResponse);
    doctorService.listDepartments.mockResolvedValue({ items: doctorResponse.departments });
    doctorService.assignDepartment.mockResolvedValue(doctorResponse);
    doctorService.unassignDepartment.mockResolvedValue(doctorResponse);
    doctorService.listSpecialties.mockResolvedValue({ items: doctorResponse.specialties });
    doctorService.assignSpecialty.mockResolvedValue(doctorResponse);
    doctorService.unassignSpecialty.mockResolvedValue(doctorResponse);
    doctorService.listServiceAssignments.mockResolvedValue({ items: [] });
    doctorService.assignService.mockResolvedValue({
      serviceId,
      facilityId,
      branchId,
      doctorId,
    });
    doctorService.unassignService.mockResolvedValue({
      serviceId,
      facilityId,
      branchId,
      doctorId,
    });

    const tenantContextGuard = new TenantContextGuard(
      validator as unknown as TenantMembershipValidatorService,
      new TrustedTenantContextFactoryService(),
    );
    const tenantAuthorizationGuard = new TenantAuthorizationGuard(
      new Reflector(),
      tenantAuthorization as unknown as TenantAuthorizationService,
    );
    const module = await Test.createTestingModule({
      controllers: [DoctorController],
      providers: [TenantContextGuard, TenantAuthorizationGuard, DoctorService],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(TenantContextGuard)
      .useValue(tenantContextGuard)
      .overrideGuard(TenantAuthorizationGuard)
      .useValue(tenantAuthorizationGuard)
      .overrideProvider(DoctorService)
      .useValue(doctorService)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(APP_CONSTANTS.apiPrefix);
    SwaggerModule.setup(
      APP_CONSTANTS.swagger.path,
      app,
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Doctor API').setVersion('test').addBearerAuth().build(),
      ),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const headers = { authorization: 'Bearer valid' };
  const root = `/api/v1/tenants/${tenantId}/doctors`;

  it('requires platform authentication before tenant or Doctor authorization', async () => {
    const response = await app.inject({ method: 'GET', url: root });

    expect(response.statusCode).toBe(401);
    expect(validator.validateMembership).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(doctorService.list).not.toHaveBeenCalled();
  });

  it('uses separate read and manage permissions and does not trust platform roles', async () => {
    const read = await app.inject({ method: 'GET', url: root, headers });
    expect(read.statusCode).toBe(200);
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.doctors.read',
    );
    expect(doctorService.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), {
      limit: 50,
      offset: 0,
    });

    tenantAuthorization.authorize.mockRejectedValueOnce(new ForbiddenException());
    const create = await app.inject({
      method: 'POST',
      url: root,
      headers,
      payload: { staffId },
    });
    expect(authenticatedUser.platformRoleIds).toContain('PLATFORM_ADMIN');
    expect(create.statusCode).toBe(403);
    expect(doctorService.create).not.toHaveBeenCalled();
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.doctors.manage',
    );
  });

  it('creates profiles for Staff and rejects client-controlled identities and scope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: root,
      headers,
      payload: {
        staffId,
        professionalDisplayName: 'Dr Taylor',
        departmentIds: [departmentId],
        specialtyIds: [specialtyId],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(doctorService.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      {
        staffId,
        professionalDisplayName: 'Dr Taylor',
        departmentIds: [departmentId],
        specialtyIds: [specialtyId],
      },
      authenticatedUser,
      expect.any(Object),
    );

    const injected = await app.inject({
      method: 'POST',
      url: root,
      headers,
      payload: {
        staffId,
        tenantId: otherTenantId,
        platformUserId,
        membershipId,
        roleIds: ['OWNER'],
        permissionCodes: ['tenant.doctors.manage'],
        facilityIds: [],
        branchIds: [],
      },
    });
    expect(injected.statusCode).toBe(400);
    expect(doctorService.create).toHaveBeenCalledOnce();
  });

  it('supports scoped reads, updates, and the three explicit lifecycle routes', async () => {
    const read = await app.inject({
      method: 'GET',
      url: `${root}/${doctorId}`,
      headers,
    });
    expect(read.statusCode).toBe(200);
    expect(doctorService.findById).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      doctorId,
    );

    const update = await app.inject({
      method: 'PATCH',
      url: `${root}/${doctorId}`,
      headers,
      payload: {
        professionalTitle: ' Consultant ',
        professionalCode: ' MD-200 ',
        bio: ' About this professional ',
      },
    });
    expect(update.statusCode).toBe(200);
    expect(doctorService.update).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      doctorId,
      {
        professionalTitle: 'Consultant',
        professionalCode: 'MD-200',
        bio: 'About this professional',
      },
      authenticatedUser,
      expect.any(Object),
    );
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.doctors.manage',
    );

    for (const action of ['activate', 'suspend', 'deactivate'] as const) {
      const response = await app.inject({
        method: 'POST',
        url: `${root}/${doctorId}/${action}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(doctorService[action]).toHaveBeenLastCalledWith(
        expect.objectContaining({ tenantId }),
        doctorId,
        authenticatedUser,
        expect.any(Object),
      );
      expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
        expect.objectContaining({ tenantId }),
        'tenant.doctors.manage',
      );
    }
  });

  it('requires read/manage permissions and rejects protected profile fields', async () => {
    tenantAuthorization.authorize.mockRejectedValueOnce(new ForbiddenException());
    const deniedRead = await app.inject({
      method: 'GET',
      url: `${root}/${doctorId}`,
      headers,
    });
    expect(deniedRead.statusCode).toBe(403);
    expect(doctorService.findById).not.toHaveBeenCalled();

    tenantAuthorization.authorize.mockRejectedValueOnce(new ForbiddenException());
    const deniedUpdate = await app.inject({
      method: 'PATCH',
      url: `${root}/${doctorId}`,
      headers,
      payload: { professionalTitle: 'Consultant' },
    });
    expect(deniedUpdate.statusCode).toBe(403);
    expect(doctorService.update).not.toHaveBeenCalled();

    const protectedPayloads = [
      { doctorId },
      { tenantId: otherTenantId },
      { staffId },
      { userId: platformUserId },
      { membershipId },
      { roleIds: ['OWNER'] },
      { permissionIds: ['tenant.doctors.manage'] },
      { facilityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { branchId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { subscriptionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      { entitlementId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      { quota: 1 },
      { status: 'ACTIVE' },
      { yearsOfExperience: 10 },
      { departmentIds: [departmentId] },
      { specialtyIds: [specialtyId] },
    ];
    for (const payload of protectedPayloads) {
      const response = await app.inject({
        method: 'PATCH',
        url: `${root}/${doctorId}`,
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(doctorService.update).not.toHaveBeenCalled();
  });

  it('returns a conflict when the tenant professional code is already used', async () => {
    doctorService.update.mockRejectedValueOnce(new DoctorProfessionalCodeConflictError());

    const response = await app.inject({
      method: 'PATCH',
      url: `${root}/${doctorId}`,
      headers,
      payload: { professionalCode: 'MD-100' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('lists, assigns, and unassigns Department and Specialty relationships independently', async () => {
    const departmentList = await app.inject({
      method: 'GET',
      url: `${root}/${doctorId}/departments`,
      headers,
    });
    expect(departmentList.statusCode).toBe(200);
    expect(doctorService.listDepartments).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      doctorId,
    );

    const department = await app.inject({
      method: 'POST',
      url: `${root}/${doctorId}/departments`,
      headers,
      payload: { departmentId },
    });
    expect(department.statusCode).toBe(201);
    expect(doctorService.assignDepartment).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      doctorId,
      { departmentId },
      authenticatedUser,
      expect.any(Object),
    );

    const departmentRemoval = await app.inject({
      method: 'DELETE',
      url: `${root}/${doctorId}/departments/${departmentId}`,
      headers,
    });
    expect(departmentRemoval.statusCode).toBe(200);
    expect(doctorService.unassignDepartment).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      doctorId,
      departmentId,
      authenticatedUser,
      expect.any(Object),
    );

    const specialtyList = await app.inject({
      method: 'GET',
      url: `${root}/${doctorId}/specialties`,
      headers,
    });
    expect(specialtyList.statusCode).toBe(200);
    expect(doctorService.listSpecialties).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      doctorId,
    );

    const specialty = await app.inject({
      method: 'POST',
      url: `${root}/${doctorId}/specialties`,
      headers,
      payload: { specialtyId },
    });
    expect(specialty.statusCode).toBe(201);
    expect(doctorService.assignSpecialty).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      doctorId,
      { specialtyId },
      authenticatedUser,
      expect.any(Object),
    );
    expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.doctors.manage',
    );

    const specialtyRemoval = await app.inject({
      method: 'DELETE',
      url: `${root}/${doctorId}/specialties/${specialtyId}`,
      headers,
    });
    expect(specialtyRemoval.statusCode).toBe(200);
    expect(doctorService.unassignSpecialty).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      doctorId,
      specialtyId,
      authenticatedUser,
      expect.any(Object),
    );
  });

  it('lists, assigns and removes service links with explicit location scope', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `${root}/${doctorId}/services`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(doctorService.listServiceAssignments).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      doctorId,
    );
    expect(tenantAuthorization.authorize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tenantId }),
      'tenant.doctors.read',
    );
    expect(tenantAuthorization.authorize).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ tenantId }),
      'tenant.branches.read',
    );

    const assignment = await app.inject({
      method: 'POST',
      url: `${root}/${doctorId}/services`,
      headers,
      payload: { serviceId, facilityId, branchId },
    });
    expect(assignment.statusCode).toBe(201);
    expect(doctorService.assignService).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      doctorId,
      { serviceId, facilityId, branchId },
      authenticatedUser,
      expect.any(Object),
    );

    const removal = await app.inject({
      method: 'DELETE',
      url: `${root}/${doctorId}/services/${serviceId}?facilityId=${facilityId}&branchId=${branchId}`,
      headers,
    });
    expect(removal.statusCode).toBe(200);
    expect(doctorService.unassignService).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      doctorId,
      serviceId,
      { facilityId, branchId },
      authenticatedUser,
      expect.any(Object),
    );

    const invalid = await app.inject({
      method: 'POST',
      url: `${root}/${doctorId}/services`,
      headers,
      payload: { serviceId, facilityId, branchId, tenantId: otherTenantId },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('requires both doctor and service/location permissions to create an assignment', async () => {
    tenantAuthorization.authorize.mockImplementation(async (_context, permission) => {
      if (permission === 'tenant.services.manage') throw new ForbiddenException();
    });
    const response = await app.inject({
      method: 'POST',
      url: `${root}/${doctorId}/services`,
      headers,
      payload: { serviceId, facilityId },
    });
    expect(response.statusCode).toBe(403);
    expect(doctorService.assignService).not.toHaveBeenCalled();
    tenantAuthorization.authorize.mockResolvedValue(undefined);
  });

  it('rejects cross-tenant context and client permission injection', async () => {
    const routeTenantMismatch = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${otherTenantId}/doctors`,
      headers,
    });
    expect(routeTenantMismatch.statusCode).toBe(403);
    expect(doctorService.list).not.toHaveBeenCalled();

    const updateTenantMismatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${otherTenantId}/doctors/${doctorId}`,
      headers,
      payload: { professionalTitle: 'Consultant' },
    });
    expect(updateTenantMismatch.statusCode).toBe(403);
    expect(doctorService.update).not.toHaveBeenCalled();

    const queryInjection = await app.inject({
      method: 'GET',
      url: `${root}?tenantId=${otherTenantId}&permissionCodes=tenant.doctors.manage`,
      headers,
    });
    expect(queryInjection.statusCode).toBe(400);
    expect(doctorService.list).not.toHaveBeenCalled();

    validator.validateMembership.mockRejectedValueOnce(new TenantContextInvalidError());
    const inactiveMembership = await app.inject({
      method: 'POST',
      url: root,
      headers,
      payload: { staffId },
    });
    expect(inactiveMembership.statusCode).toBe(403);
    expect(doctorService.create).not.toHaveBeenCalled();
  });

  it('does not expose Doctor hard deletion and documents the Doctor API in OpenAPI', async () => {
    const deletion = await app.inject({
      method: 'DELETE',
      url: `${root}/${doctorId}`,
      headers,
    });
    expect(deletion.statusCode).toBe(404);

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Doctor API').setVersion('test').addBearerAuth().build(),
    );
    const docsResponse = await app.inject({
      method: 'GET',
      url: `/${APP_CONSTANTS.swagger.path}-json`,
    });
    expect(docsResponse.statusCode).toBe(200);
    expect(docsResponse.json().paths).toHaveProperty(
      '/api/v1/tenants/{tenantId}/doctors/{doctorId}',
    );
    const doctorPath = '/api/v1/tenants/{tenantId}/doctors';
    const detailPath = `${doctorPath}/{doctorId}`;
    expect(document.paths[doctorPath]?.get?.security).toEqual([{ bearer: [] }]);
    expect(document.paths[doctorPath]?.post?.requestBody).toBeDefined();
    expect(document.paths[detailPath]?.patch?.responses?.['400']).toBeDefined();
    expect(document.paths[detailPath]?.patch?.responses?.['409']).toBeDefined();
    expect(document.components?.schemas?.UpdateDoctorRequestDto).toMatchObject({
      properties: {
        professionalDisplayName: expect.any(Object),
        professionalTitle: expect.any(Object),
        professionalCode: expect.any(Object),
        bio: expect.any(Object),
      },
    });
    expect(document.components?.schemas?.DoctorResponseDto).toMatchObject({
      properties: {
        professionalTitle: expect.any(Object),
        professionalCode: expect.any(Object),
        bio: expect.any(Object),
      },
    });
    expect(document.paths[`${detailPath}/profile`]).toBeUndefined();
    for (const path of [
      `${detailPath}/activate`,
      `${detailPath}/suspend`,
      `${detailPath}/deactivate`,
      `${detailPath}/departments`,
      `${detailPath}/departments/{departmentId}`,
      `${detailPath}/specialties`,
      `${detailPath}/specialties/{specialtyId}`,
    ]) {
      expect(document.paths[path]).toBeDefined();
    }
    expect(document.paths[detailPath]?.delete).toBeUndefined();
    expect(document.paths).not.toHaveProperty('/api/v1/tenants/{tenantId}/patients');
    expect(document.paths).not.toHaveProperty('/api/v1/tenants/{tenantId}/appointments');
  });
});
