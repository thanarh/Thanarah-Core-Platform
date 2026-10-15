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
import { AppointmentService } from '../src/tenant/appointment.service';
import { AppointmentNotFoundError } from '../src/tenant/appointment.errors';
import { TenantAppointmentController } from '../src/tenant/tenant-appointment.controller';
import type { FastifyRequest } from 'fastify';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const appointmentId = '33333333-3333-4333-8333-333333333333';
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

const appointmentResponse = {
  id: appointmentId,
  patientId: '66666666-6666-4666-8666-666666666666',
  doctorId: '77777777-7777-4777-8777-777777777777',
  facilityId: '88888888-8888-4888-8888-888888888888',
  branchId: null,
  serviceId: null,
  startsAt: '2026-10-15T09:00:00.000Z',
  endsAt: '2026-10-15T09:30:00.000Z',
  status: 'SCHEDULED',
  reason: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
  cancelledAt: null,
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

describe('Tenant appointment HTTP authorization and routing', () => {
  let app: NestFastifyApplication;
  const allowedPermissions = new Set<string>();
  const validator = { validateMembership: vi.fn() };
  const tenantAuthorization = { authorize: vi.fn() };
  const appointments = {
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    reschedule: vi.fn(),
    cancel: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    allowedPermissions.clear();
    for (const permission of [
      'tenant.appointments.read',
      'tenant.appointments.create',
      'tenant.appointments.update',
      'tenant.appointments.reschedule',
      'tenant.appointments.cancel',
    ]) {
      allowedPermissions.add(permission);
    }
    validator.validateMembership.mockImplementation(
      async ({ tenantIdCandidate }: { tenantIdCandidate: string }) => {
        if (tenantIdCandidate !== tenantId) throw new TenantContextInvalidError();
        return validatedMembership;
      },
    );
    tenantAuthorization.authorize.mockImplementation(
      async (_context: unknown, permission: string) => {
        if (!allowedPermissions.has(permission)) throw new ForbiddenException();
      },
    );
    appointments.create.mockResolvedValue(appointmentResponse);
    appointments.list.mockImplementation(async (_context, query) => ({
      items: [appointmentResponse],
      limit: query.limit,
      offset: query.offset,
      total: 1,
      hasNext: false,
    }));
    appointments.findById.mockResolvedValue(appointmentResponse);
    appointments.update.mockResolvedValue(appointmentResponse);
    appointments.reschedule.mockResolvedValue(appointmentResponse);
    appointments.cancel.mockResolvedValue({ ...appointmentResponse, status: 'CANCELLED' });

    const tenantContextGuard = new TenantContextGuard(
      validator as unknown as TenantMembershipValidatorService,
      new TrustedTenantContextFactoryService(),
    );
    const tenantAuthorizationGuard = new TenantAuthorizationGuard(
      new Reflector(),
      tenantAuthorization as unknown as TenantAuthorizationService,
    );
    const module = await Test.createTestingModule({
      controllers: [TenantAppointmentController],
      providers: [
        PlatformAuthGuard,
        TenantContextGuard,
        TenantAuthorizationGuard,
        AppointmentService,
      ],
    })
      .overrideGuard(PlatformAuthGuard)
      .useClass(TestAuthenticationGuard)
      .overrideGuard(TenantContextGuard)
      .useValue(tenantContextGuard)
      .overrideGuard(TenantAuthorizationGuard)
      .useValue(tenantAuthorizationGuard)
      .overrideProvider(AppointmentService)
      .useValue(appointments)
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

  it('rejects unauthenticated requests before tenant lookup or appointment access', async () => {
    const response = await app.inject({ method: 'GET', url: `${root}/appointments` });

    expect(response.statusCode).toBe(401);
    expect(validator.validateMembership).not.toHaveBeenCalled();
    expect(appointments.list).not.toHaveBeenCalled();
  });

  it('requires separate permissions for reading, creating, updating, rescheduling, and cancelling', async () => {
    const checks = [
      {
        permission: 'tenant.appointments.read',
        method: 'GET' as const,
        url: `${root}/appointments`,
        operation: appointments.list,
      },
      {
        permission: 'tenant.appointments.create',
        method: 'POST' as const,
        url: `${root}/appointments`,
        payload: {
          patientId: appointmentResponse.patientId,
          doctorId: appointmentResponse.doctorId,
          facilityId: appointmentResponse.facilityId,
          startsAt: appointmentResponse.startsAt,
          endsAt: appointmentResponse.endsAt,
        },
        operation: appointments.create,
      },
      {
        permission: 'tenant.appointments.update',
        method: 'PATCH' as const,
        url: `${root}/appointments/${appointmentId}`,
        payload: { reason: 'Follow-up' },
        operation: appointments.update,
      },
      {
        permission: 'tenant.appointments.reschedule',
        method: 'POST' as const,
        url: `${root}/appointments/${appointmentId}/reschedule`,
        payload: {
          startsAt: '2026-10-15T10:00:00.000Z',
          endsAt: '2026-10-15T10:30:00.000Z',
        },
        operation: appointments.reschedule,
      },
      {
        permission: 'tenant.appointments.cancel',
        method: 'POST' as const,
        url: `${root}/appointments/${appointmentId}/cancel`,
        operation: appointments.cancel,
      },
    ];

    for (const check of checks) {
      allowedPermissions.delete(check.permission);
      const denied = await app.inject({
        method: check.method,
        url: check.url,
        headers,
        ...(check.payload ? { payload: check.payload } : {}),
      });
      expect(denied.statusCode).toBe(403);
      expect(check.operation).not.toHaveBeenCalled();
      expect(tenantAuthorization.authorize).toHaveBeenLastCalledWith(
        expect.objectContaining({ tenantId }),
        check.permission,
      );
      allowedPermissions.add(check.permission);
    }
  });

  it('routes tenant-scoped reads and mutations and returns no patient demographics', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `${root}/appointments`,
      headers,
      payload: {
        patientId: appointmentResponse.patientId,
        doctorId: appointmentResponse.doctorId,
        facilityId: appointmentResponse.facilityId,
        startsAt: appointmentResponse.startsAt,
        endsAt: appointmentResponse.endsAt,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(appointmentResponse);
    expect(created.json()).not.toHaveProperty('patient');
    expect(created.json()).not.toHaveProperty('tenantId');

    const listed = await app.inject({
      method: 'GET',
      url: `${root}/appointments?limit=10`,
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ items: [appointmentResponse], limit: 10, total: 1 });

    const fetched = await app.inject({
      method: 'GET',
      url: `${root}/appointments/${appointmentId}`,
      headers,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(appointmentResponse);

    const updated = await app.inject({
      method: 'PATCH',
      url: `${root}/appointments/${appointmentId}`,
      headers,
      payload: { reason: 'Follow-up' },
    });
    expect(updated.statusCode).toBe(200);

    const rescheduled = await app.inject({
      method: 'POST',
      url: `${root}/appointments/${appointmentId}/reschedule`,
      headers,
      payload: {
        startsAt: '2026-10-15T10:00:00.000Z',
        endsAt: '2026-10-15T10:30:00.000Z',
      },
    });
    expect(rescheduled.statusCode).toBe(200);

    const cancelled = await app.inject({
      method: 'POST',
      url: `${root}/appointments/${appointmentId}/cancel`,
      headers,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('CANCELLED');
  });

  it('does not route a tenant path that does not match the validated membership', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${otherTenantId}/appointments`,
      headers,
    });

    expect(response.statusCode).toBe(403);
    expect(appointments.list).not.toHaveBeenCalled();
  });

  it('returns a safe not-found response without exposing cross-scope appointment details', async () => {
    appointments.findById.mockRejectedValueOnce(new AppointmentNotFoundError());
    const response = await app.inject({
      method: 'GET',
      url: `${root}/appointments/${appointmentId}`,
      headers,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
      message: 'Appointment not found',
    });
    expect(response.json()).not.toHaveProperty('patient');
  });

  it('documents the complete appointment API and tenant bearer security in OpenAPI', async () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test').setVersion('1').addBearerAuth().build(),
    );
    const paths = document.paths;
    const appointmentsPath = '/api/v1/tenants/{tenantId}/appointments';
    expect(paths[appointmentsPath]).toHaveProperty('post');
    expect(paths[appointmentsPath]).toHaveProperty('get');
    expect(paths[`${appointmentsPath}/{appointmentId}`]).toHaveProperty('get');
    expect(paths[`${appointmentsPath}/{appointmentId}`]).toHaveProperty('patch');
    expect(paths[`${appointmentsPath}/{appointmentId}/reschedule`]).toHaveProperty('post');
    expect(paths[`${appointmentsPath}/{appointmentId}/cancel`]).toHaveProperty('post');
    expect(paths[appointmentsPath]?.post?.security).toEqual([{ bearer: [] }]);
    expect(document.components?.schemas?.AppointmentResponseDto).toBeDefined();
  });
});
