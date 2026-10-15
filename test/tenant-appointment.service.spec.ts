import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import {
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
    'create' | 'list' | 'findById' | 'hasProviderOverlap' | 'update',
    MockFunction
  >;
  patients: { findById: MockFunction };
  doctors: { findById: MockFunction };
  facilities: { findById: MockFunction };
  branches: { findById: MockFunction };
  services: { findById: MockFunction };
  staffScopes: {
    resolveMembershipScope: MockFunction;
    listFacilities: MockFunction;
    listBranches: MockFunction;
  };
  audit: { recordAudit: MockFunction };
};

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
  const appointments = {
    create: vi.fn().mockImplementation(async (_context, newRecord) => newRecord),
    list: vi.fn().mockResolvedValue({
      items: [record],
      limit: 50,
      offset: 0,
      total: 1,
      hasNext: false,
    }),
    findById: vi.fn().mockResolvedValue(record),
    hasProviderOverlap: vi.fn().mockResolvedValue(false),
    update: vi
      .fn()
      .mockImplementation(async (_context, id, version, patch) =>
        id === record.id && version === record.version
          ? { ...record, ...patch, version: record.version + 1 }
          : null,
      ),
  };
  const patients = {
    findById: vi.fn().mockResolvedValue({ id: patientId, status: 'ACTIVE' }),
  };
  const doctors = {
    findById: vi.fn().mockResolvedValue({
      id: doctorId,
      staffId,
      operationallyActive: true,
    }),
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
  const audit = { recordAudit: vi.fn().mockResolvedValue(undefined) };
  const service = new AppointmentService(
    appointments as never,
    patients as never,
    doctors as never,
    facilities as never,
    branches as never,
    services as never,
    staffScopes as never,
    audit as never,
  );
  return {
    service,
    record,
    appointments,
    patients,
    doctors,
    facilities,
    branches,
    services,
    staffScopes,
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
    expect(harness.appointments.create).toHaveBeenCalledWith(
      context,
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
    expect(harness.appointments.create).not.toHaveBeenCalled();
  });

  it('rejects inactive or cross-tenant patient references without exposing their existence', async () => {
    const harness = makeService();
    harness.patients.findById.mockResolvedValueOnce({ id: patientId, status: 'INACTIVE' });

    await expect(
      harness.service.create(context, createInput() as never, actor),
    ).rejects.toBeInstanceOf(AppointmentReferenceInvalidError);
    expect(harness.appointments.create).not.toHaveBeenCalled();
  });

  it('rejects observed provider overlap and does not insert', async () => {
    const harness = makeService();
    harness.appointments.hasProviderOverlap.mockResolvedValueOnce(true);

    await expect(
      harness.service.create(context, createInput() as never, actor),
    ).rejects.toBeInstanceOf(AppointmentScheduleConflictError);
    expect(harness.appointments.hasProviderOverlap).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ doctorId, startsAt: start, endsAt: end }),
    );
    expect(harness.appointments.create).not.toHaveBeenCalled();
  });

  it('reschedules without conflicting with the appointment itself', async () => {
    const harness = makeService();
    const nextStart = new Date('2026-10-15T10:00:00.000Z');
    const nextEnd = new Date('2026-10-15T10:45:00.000Z');
    const input = {
      startsAt: nextStart.toISOString(),
      endsAt: nextEnd.toISOString(),
    };

    const result = await harness.service.reschedule(context, appointmentId, input as never, actor);

    expect(harness.appointments.hasProviderOverlap).toHaveBeenCalledWith(context, {
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
    expect(harness.audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'APPOINTMENT_RESCHEDULED' }),
    );
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

  it('does not claim atomic overlap protection when two preflight reads race', async () => {
    const harness = makeService();
    let seen = 0;
    let release!: () => void;
    const bothChecked = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.appointments.hasProviderOverlap.mockImplementation(async () => {
      seen += 1;
      if (seen === 2) release();
      await bothChecked;
      return false;
    });
    harness.appointments.create.mockImplementation(async (_context, input) => input);

    await Promise.all([
      harness.service.create(context, createInput() as never, actor),
      harness.service.create(context, createInput() as never, actor),
    ]);

    expect(harness.appointments.hasProviderOverlap).toHaveBeenCalledTimes(2);
    expect(harness.appointments.create).toHaveBeenCalledTimes(2);
  });
});
