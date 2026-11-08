import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import {
  AppointmentIdempotencyConflictError,
  AppointmentNotFoundError,
  AppointmentReferenceInvalidError,
  AppointmentScheduleConflictError,
  AppointmentScopeForbiddenError,
  AppointmentStateConflictError,
  AppointmentInputValidationError,
} from '../src/tenant/appointment.errors';
import type { AppointmentRecord } from '../src/tenant/appointment.model';
import { AppointmentService } from '../src/tenant/appointment.service';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';

const tenantId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const patientId = '33333333-3333-4333-8333-333333333333';
const doctorId = '44444444-4444-4444-8444-444444444444';
const facilityId = '55555555-5555-4555-8555-555555555555';
const branchId = '66666666-6666-4666-8666-666666666666';
const serviceId = '77777777-7777-4777-8777-777777777777';
const platformUserId = '88888888-8888-4888-8888-888888888888';
const appointmentId = '99999999-9999-4999-8999-999999999999';
const staffId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const context = {
  tenantId,
  membershipId,
  platformUserId,
} as TrustedTenantContext;

const actor: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tokenVersion: 1,
  platformRoleIds: [],
};

type MockFunction = ReturnType<typeof vi.fn>;
type AppointmentServiceHarness = {
  service: AppointmentService;
  record: AppointmentRecord;
  appointments: Record<
    'create' | 'list' | 'findById' | 'hasProviderOverlap' | 'update' | 'withSchedulingLocks',
    MockFunction
  >;
  lockedStorage: {
    create: MockFunction;
    findById: MockFunction;
    hasProviderOverlap: MockFunction;
    update: MockFunction;
  };
  patients: { findById: MockFunction };
  doctors: { findById: MockFunction; hasServiceAssignment: MockFunction };
  facilities: { findById: MockFunction };
  branches: { findById: MockFunction };
  services: { findById: MockFunction };
  staffScopes: {
    resolveMembershipScope: MockFunction;
    listFacilities: MockFunction;
    listBranches: MockFunction;
  };
  schedulingPolicies: {
    effectiveTimeZone: MockFunction;
    effectiveTimeZones: MockFunction;
    assertBookingAllowed: MockFunction;
    assertCancellationAllowed: MockFunction;
    assertReschedulingAllowed: MockFunction;
  };
  tenantAuthorization: {
    getEffectivePermissionCodes: MockFunction;
    authorize: MockFunction;
  };
  audit: { recordAudit: MockFunction };
};

function invokeMock<T>(mock: MockFunction, ...args: unknown[]): T {
  return (mock as unknown as (...args: unknown[]) => T)(...args);
}

const start = new Date('2026-10-15T09:00:00.000Z');
const end = new Date('2026-10-15T09:30:00.000Z');

function appointment(overrides: Partial<AppointmentRecord> = {}): AppointmentRecord {
  return {
    id: appointmentId,
    patientId,
    doctorId,
    facilityId,
    branchId,
    serviceId,
    startsAt: start,
    endsAt: end,
    status: 'SCHEDULED',
    reason: null,
    createdAt: new Date('2026-10-14T10:00:00.000Z'),
    updatedAt: new Date('2026-10-14T10:00:00.000Z'),
    createdBy: platformUserId,
    updatedBy: platformUserId,
    cancelledAt: null,
    cancelledBy: null,
    version: 1,
    ...overrides,
  };
}

function createInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    patientId,
    doctorId,
    facilityId,
    branchId,
    serviceId,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    reason: 'Annual check',
    ...overrides,
  };
}

function makeService(): AppointmentServiceHarness {
  const record = appointment();
  let currentRecord = record;
  const appointments: AppointmentServiceHarness['appointments'] = {
    create: vi.fn().mockImplementation(async (_context, newRecord) => {
      currentRecord = newRecord;
      return newRecord;
    }),
    list: vi.fn().mockResolvedValue({
      items: [record],
      limit: 50,
      offset: 0,
      total: 1,
      hasNext: false,
    }),
    findById: vi.fn().mockImplementation(async () => currentRecord),
    hasProviderOverlap: vi.fn().mockResolvedValue(false),
    update: vi.fn().mockImplementation(async (_context, id, version, patch) => {
      if (id !== currentRecord.id || version !== currentRecord.version) return null;
      currentRecord = { ...currentRecord, ...patch, version: currentRecord.version + 1 };
      return currentRecord;
    }),
    withSchedulingLocks: vi.fn(),
  };
  const lockedStorage = {
    create: vi
      .fn()
      .mockImplementation((newRecord) =>
        invokeMock<Promise<AppointmentRecord>>(appointments.create, context, newRecord),
      ),
    findById: vi
      .fn()
      .mockImplementation(async (id) => (id === currentRecord.id ? currentRecord : null)),
    hasProviderOverlap: vi
      .fn()
      .mockImplementation((input) =>
        invokeMock<Promise<boolean>>(appointments.hasProviderOverlap, context, input),
      ),
    update: vi
      .fn()
      .mockImplementation((id, version, patch) =>
        invokeMock<Promise<AppointmentRecord | null>>(
          appointments.update,
          context,
          id,
          version,
          patch,
        ),
      ),
  };
  appointments.withSchedulingLocks.mockImplementation((_context, _locks, operation) =>
    operation(lockedStorage),
  );
  const patients = {
    findById: vi.fn().mockResolvedValue({ id: patientId, status: 'ACTIVE' }),
  };
  const doctors = {
    findById: vi.fn().mockResolvedValue({
      id: doctorId,
      staffId,
      operationallyActive: true,
    }),
    hasServiceAssignment: vi.fn().mockResolvedValue(true),
  };
  const facilities = {
    findById: vi.fn().mockResolvedValue({ id: facilityId, status: 'ACTIVE' }),
  };
  const branches = {
    findById: vi.fn().mockResolvedValue({ id: branchId, facilityId, status: 'ACTIVE' }),
  };
  const services = {
    findById: vi.fn().mockResolvedValue({ id: serviceId, status: 'ACTIVE' }),
  };
  const staffScopes = {
    resolveMembershipScope: vi.fn().mockResolvedValue(null),
    listFacilities: vi.fn().mockResolvedValue({
      items: [{ facilityId, facilityStatus: 'ACTIVE' }],
    }),
    listBranches: vi.fn().mockResolvedValue({
      items: [
        {
          branchId,
          branchStatus: 'ACTIVE',
          facility: { id: facilityId, status: 'ACTIVE' },
        },
      ],
    }),
  };
  const schedulingPolicies = {
    effectiveTimeZone: vi.fn().mockResolvedValue('America/New_York'),
    effectiveTimeZones: vi.fn().mockImplementation(async (_context, ids) => {
      return new Map(ids.map((id: string) => [id, 'America/New_York']));
    }),
    assertBookingAllowed: vi.fn().mockResolvedValue(undefined),
    assertCancellationAllowed: vi.fn().mockResolvedValue(undefined),
    assertReschedulingAllowed: vi.fn().mockResolvedValue(undefined),
  };
  const tenantAuthorization = {
    getEffectivePermissionCodes: vi.fn().mockResolvedValue([]),
    authorize: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { recordAudit: vi.fn().mockResolvedValue(undefined) };
  const service = new AppointmentService(
    appointments as never,
    patients as never,
    doctors as never,
    facilities as never,
    branches as never,
    services as never,
    staffScopes as never,
    schedulingPolicies as never,
    tenantAuthorization as never,
    audit as never,
  );
  return {
    service,
    record,
    appointments,
    lockedStorage,
    patients,
    doctors,
    facilities,
    branches,
    services,
    staffScopes,
    schedulingPolicies,
    tenantAuthorization,
    audit,
  };
}

describe('AppointmentService', () => {
  it('creates an appointment from active tenant references and audits without notes or demographics', async () => {
    const harness = makeService();

    const response = await harness.service.create(context, createInput() as never, actor);

    expect(response).toMatchObject({
      patientId,
      doctorId,
      facilityId,
      branchId,
      serviceId,
      status: 'SCHEDULED',
    });
    expect(response).not.toHaveProperty('createdBy');
    expect(response).not.toHaveProperty('version');
    expect(harness.lockedStorage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId,
        doctorId,
        facilityId,
        branchId,
        serviceId,
        createdBy: platformUserId,
      }),
    );
    expect(harness.staffScopes.listFacilities).toHaveBeenCalledWith(context, staffId);
    expect(harness.staffScopes.listBranches).toHaveBeenCalledWith(context, staffId);
    expect(harness.appointments.withSchedulingLocks).toHaveBeenCalledWith(
      context,
      expect.arrayContaining([
        { resourceType: 'FACILITY', resourceId: facilityId },
        { resourceType: 'DOCTOR', resourceId: doctorId },
      ]),
      expect.any(Function),
    );
    expect(harness.audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'APPOINTMENT_CREATED',
        metadata: expect.objectContaining({ appointmentId: response.id, action: 'created' }),
      }),
    );
    expect(JSON.stringify(harness.audit.recordAudit.mock.calls)).not.toContain('Annual check');
  });

  it('rejects invalid and non-positive time intervals before touching storage', async () => {
    const harness = makeService();

    await expect(
      harness.service.create(
        context,
        createInput({ endsAt: '2026-10-15T09:00:00.000Z' }) as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(AppointmentInputValidationError);
    await expect(
      harness.service.create(
        context,
        createInput({ startsAt: '2026-10-15T09:00:00' }) as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(AppointmentInputValidationError);
    expect(harness.lockedStorage.create).not.toHaveBeenCalled();
  });

  it('rejects inactive or cross-tenant patient references without exposing their existence', async () => {
    const harness = makeService();
    harness.patients.findById.mockResolvedValueOnce({ id: patientId, status: 'INACTIVE' });

    await expect(
      harness.service.create(context, createInput() as never, actor),
    ).rejects.toBeInstanceOf(AppointmentReferenceInvalidError);
    expect(harness.lockedStorage.create).not.toHaveBeenCalled();
  });

  it('rejects a new appointment when the service is not assigned to that doctor and location', async () => {
    const harness = makeService();
    harness.doctors.hasServiceAssignment.mockResolvedValueOnce(false);

    await expect(
      harness.service.create(context, createInput() as never, actor),
    ).rejects.toBeInstanceOf(AppointmentReferenceInvalidError);
    expect(harness.doctors.hasServiceAssignment).toHaveBeenCalledWith(
      context,
      doctorId,
      serviceId,
      facilityId,
      branchId,
    );
    expect(harness.lockedStorage.create).not.toHaveBeenCalled();
  });

  it('checks a changed service but preserves unchanged legacy service references', async () => {
    const harness = makeService();
    harness.doctors.hasServiceAssignment.mockResolvedValueOnce(false);

    await expect(
      harness.service.update(
        context,
        appointmentId,
        { serviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(AppointmentReferenceInvalidError);
    expect(harness.appointments.update).not.toHaveBeenCalled();

    harness.doctors.hasServiceAssignment.mockClear();
    const updated = await harness.service.update(
      context,
      appointmentId,
      { reason: 'Legacy appointment remains editable' } as never,
      actor,
    );
    expect(updated.reason).toBe('Legacy appointment remains editable');
    expect(harness.doctors.hasServiceAssignment).not.toHaveBeenCalled();
  });

  it('rejects observed provider overlap and does not insert', async () => {
    const harness = makeService();
    harness.appointments.hasProviderOverlap.mockResolvedValueOnce(true);

    await expect(
      harness.service.create(context, createInput() as never, actor),
    ).rejects.toBeInstanceOf(AppointmentScheduleConflictError);
    expect(harness.lockedStorage.hasProviderOverlap).toHaveBeenCalledWith(
      expect.objectContaining({ doctorId, startsAt: start, endsAt: end }),
    );
    expect(harness.lockedStorage.create).not.toHaveBeenCalled();
  });

  it('reschedules without conflicting with the appointment itself', async () => {
    const harness = makeService();
    harness.doctors.hasServiceAssignment.mockResolvedValue(false);
    const nextStart = new Date('2026-10-15T10:00:00.000Z');
    const nextEnd = new Date('2026-10-15T10:45:00.000Z');
    const input = {
      startsAt: nextStart.toISOString(),
      endsAt: nextEnd.toISOString(),
    };

    const result = await harness.service.reschedule(context, appointmentId, input as never, actor);

    expect(harness.lockedStorage.hasProviderOverlap).toHaveBeenCalledWith({
      doctorId,
      startsAt: nextStart,
      endsAt: nextEnd,
      excludeId: appointmentId,
    });
    expect(harness.appointments.update).toHaveBeenCalledWith(
      context,
      appointmentId,
      1,
      expect.objectContaining({ startsAt: nextStart, endsAt: nextEnd }),
    );
    expect(result.startsAt).toEqual(nextStart);
    expect(harness.doctors.hasServiceAssignment).not.toHaveBeenCalled();
    expect(harness.audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'APPOINTMENT_RESCHEDULED' }),
    );
  });

  it('requires a service assignment when rescheduling changes the doctor', async () => {
    const harness = makeService();
    const nextDoctorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    harness.doctors.hasServiceAssignment.mockResolvedValue(false);

    await expect(
      harness.service.reschedule(
        context,
        appointmentId,
        {
          doctorId: nextDoctorId,
          startsAt: '2026-10-15T10:00:00.000Z',
          endsAt: '2026-10-15T10:30:00.000Z',
        } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(AppointmentReferenceInvalidError);
    expect(harness.doctors.hasServiceAssignment).toHaveBeenCalledWith(
      context,
      nextDoctorId,
      serviceId,
      facilityId,
      branchId,
    );
    expect(harness.appointments.update).not.toHaveBeenCalled();
  });

  it('cancels once, treats repeated cancellation idempotently, and blocks reactivation by update', async () => {
    const harness = makeService();
    const cancelled = appointment({
      status: 'CANCELLED',
      cancelledAt: new Date('2026-10-14T11:00:00.000Z'),
      cancelledBy: platformUserId,
    });
    harness.appointments.update.mockResolvedValueOnce(cancelled);

    const first = await harness.service.cancel(context, appointmentId, actor);
    expect(first.status).toBe('CANCELLED');
    expect(harness.appointments.update).toHaveBeenCalledWith(
      context,
      appointmentId,
      1,
      expect.objectContaining({ status: 'CANCELLED', cancelledBy: platformUserId }),
    );

    harness.appointments.findById.mockResolvedValueOnce(cancelled);
    const second = await harness.service.cancel(context, appointmentId, actor);
    expect(second.status).toBe('CANCELLED');
    expect(harness.appointments.update).toHaveBeenCalledTimes(1);

    harness.appointments.findById.mockResolvedValueOnce(cancelled);
    await expect(
      harness.service.update(context, appointmentId, { reason: 'Changed' }, actor),
    ).rejects.toBeInstanceOf(AppointmentStateConflictError);
  });

  it('applies caller facility and branch scope to explicit reads and location writes', async () => {
    const harness = makeService();
    const otherFacility = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    harness.staffScopes.resolveMembershipScope.mockResolvedValue({
      facilities: [{ id: facilityId, name: 'Assigned facility' }],
      branches: [],
    });

    await expect(
      harness.service.create(context, createInput({ facilityId: otherFacility }) as never, actor),
    ).rejects.toBeInstanceOf(AppointmentScopeForbiddenError);
    expect(harness.appointments.create).not.toHaveBeenCalled();

    harness.appointments.findById.mockResolvedValueOnce(
      appointment({ facilityId: otherFacility, branchId: null }),
    );
    await expect(harness.service.findById(context, appointmentId)).rejects.toBeInstanceOf(
      AppointmentNotFoundError,
    );
  });

  it('limits appointment list results to the caller branch scope', async () => {
    const harness = makeService();
    harness.staffScopes.resolveMembershipScope.mockResolvedValue({
      facilities: [],
      branches: [{ id: branchId, name: 'Assigned branch', facilityId, facilityName: 'Facility' }],
    });

    await harness.service.list(context, { branchId, limit: 20, offset: 0 } as never);

    expect(harness.appointments.list).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        branchId,
        accessScope: { unrestricted: false, facilityIds: [], branchIds: [branchId] },
      }),
    );
  });

  it('searches patient directory fields only when the caller has patient-read permission', async () => {
    const harness = makeService();

    await harness.service.list(context, {
      search: '  Aisha   Noor ',
      limit: 20,
      offset: 0,
    } as never);

    expect(harness.tenantAuthorization.authorize).toHaveBeenCalledWith(
      context,
      'tenant.patients.read',
    );
    expect(harness.appointments.list).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        search: 'Aisha Noor',
        searchPatientRecords: true,
      }),
    );
  });

  it('requires patient-read permission for an exact patient-ID list filter', async () => {
    const harness = makeService();

    await harness.service.list(context, { patientId, limit: 20, offset: 0 } as never);

    expect(harness.tenantAuthorization.authorize).toHaveBeenCalledWith(
      context,
      'tenant.patients.read',
    );
  });

  it('allows exact UUID search without patient access but excludes patient-ID matching', async () => {
    const harness = makeService();

    await harness.service.list(context, { search: appointmentId, limit: 20, offset: 0 } as never);

    expect(harness.tenantAuthorization.authorize).not.toHaveBeenCalled();
    expect(harness.appointments.list).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ search: appointmentId, searchPatientRecords: false }),
    );
  });

  it('converts facility-local inclusive dates using the active policy timezone', async () => {
    const harness = makeService();

    await harness.service.list(context, {
      facilityId,
      fromDate: '2026-11-01',
      toDate: '2026-11-01',
      limit: 20,
      offset: 0,
    } as never);

    expect(harness.schedulingPolicies.effectiveTimeZone).toHaveBeenCalledWith(context, facilityId);
    expect(harness.appointments.list).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        from: new Date('2026-11-01T04:00:00.000Z'),
        to: new Date('2026-11-02T05:00:00.000Z'),
      }),
    );
    expect(harness.appointments.list.mock.calls[0][1]).not.toHaveProperty('fromDate');
  });

  it('refuses local-date filtering when the facility has no active timezone policy', async () => {
    const harness = makeService();
    harness.schedulingPolicies.effectiveTimeZone.mockResolvedValue(null);

    await expect(
      harness.service.list(context, {
        facilityId,
        fromDate: '2026-10-15',
        limit: 20,
        offset: 0,
      } as never),
    ).rejects.toMatchObject({ response: { code: 'APPOINTMENT_TIME_ZONE_UNAVAILABLE' } });
    expect(harness.appointments.list).not.toHaveBeenCalled();
  });

  it('returns timezone-only metadata to facility and branch-scoped staff', async () => {
    const harness = makeService();
    harness.staffScopes.resolveMembershipScope.mockResolvedValue({
      facilities: [],
      branches: [{ id: branchId, name: 'Assigned branch', facilityId, facilityName: 'Facility' }],
    });

    await expect(harness.service.effectiveTimeZones(context, [facilityId])).resolves.toEqual({
      items: [{ facilityId, timeZone: 'America/New_York', status: 'ACTIVE_POLICY' }],
    });
    expect(harness.schedulingPolicies.effectiveTimeZones).toHaveBeenCalledWith(context, [
      facilityId,
    ]);
  });

  it('does not read timezone metadata outside the staff location scope', async () => {
    const harness = makeService();
    harness.staffScopes.resolveMembershipScope.mockResolvedValue({
      facilities: [{ id: facilityId, name: 'Assigned facility' }],
      branches: [],
    });
    const otherFacilityId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    await expect(
      harness.service.effectiveTimeZones(context, [otherFacilityId]),
    ).rejects.toBeInstanceOf(AppointmentScopeForbiddenError);
    expect(harness.schedulingPolicies.effectiveTimeZones).not.toHaveBeenCalled();
  });

  it('uses the optional idempotency key to return the same appointment on safe retries', async () => {
    const harness = makeService();
    const input = createInput();
    const first = await harness.service.create(context, input as never, actor, {}, 'retry-key-1');
    const retry = await harness.service.create(context, input as never, actor, {}, 'retry-key-1');
    expect(retry.id).toBe(first.id);
    expect(harness.lockedStorage.create).toHaveBeenCalledTimes(1);
    expect(harness.appointments.withSchedulingLocks).toHaveBeenCalledWith(
      context,
      expect.arrayContaining([{ resourceType: 'IDEMPOTENCY', resourceId: first.id }]),
      expect.any(Function),
    );
  });

  it('rejects reusing an idempotency key for a different request', async () => {
    const harness = makeService();
    await harness.service.create(context, createInput() as never, actor, {}, 'retry-key-2');
    await expect(
      harness.service.create(
        context,
        createInput({ reason: 'Different reason' }) as never,
        actor,
        {},
        'retry-key-2',
      ),
    ).rejects.toBeInstanceOf(AppointmentIdempotencyConflictError);
    expect(harness.lockedStorage.create).toHaveBeenCalledTimes(1);
  });
});
