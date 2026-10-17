import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EncounterService } from '../src/tenant/encounter.service';
import {
  EncounterAppointmentConflictError,
  EncounterInputValidationError,
  EncounterNotFoundError,
  EncounterReferenceInvalidError,
  EncounterStateConflictError,
  EncounterVersionConflictError,
} from '../src/tenant/encounter.errors';
import { EncounterStatus } from '../src/tenant/encounter.model';
import type { EncounterHistoryEvent, EncounterRecord } from '../src/tenant/encounter.model';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';

const tenantId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const patientId = '44444444-4444-4444-8444-444444444444';
const doctorId = '55555555-5555-4555-8555-555555555555';
const facilityId = '66666666-6666-4666-8666-666666666666';
const appointmentId = '77777777-7777-4777-8777-777777777777';
const encounterId = '88888888-8888-4888-8888-888888888888';

const context = {
  tenantId,
  membershipId,
  platformUserId: actorId,
} as TrustedTenantContext;
const actor = { userId: actorId } as AuthenticatedPlatformUser;

function record(overrides: Partial<EncounterRecord> = {}): EncounterRecord {
  const now = new Date('2026-10-17T09:00:00.000Z');
  const createdEvent: EncounterHistoryEvent = {
    id: '99999999-9999-4999-8999-999999999999',
    action: 'CREATED',
    actorUserId: actorId,
    occurredAt: now,
    fromVersion: 0,
    toVersion: 1,
    changedFields: ['appointmentId', 'patientId', 'doctorId', 'facilityId', 'branchId'],
  };
  return {
    id: encounterId,
    appointmentId,
    patientId,
    doctorId,
    facilityId,
    branchId: null,
    encounterAt: now,
    status: EncounterStatus.DRAFT,
    clinical: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    history: [createdEvent],
    ...overrides,
  };
}

// Keep Vitest's per-method mock inference for precise overrides in each test.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const makeHarness = (() => {
  const repository = {
    create: vi.fn(async (_context: TrustedTenantContext, value: EncounterRecord) => value),
    list: vi.fn(async () => ({
      items: [] as EncounterRecord[],
      total: 0,
      limit: 50,
      offset: 0,
      hasNext: false,
    })),
    findById: vi.fn(async () => record()),
    findActiveByAppointment: vi.fn(async () => null),
    update: vi.fn(
      async (
        _context: TrustedTenantContext,
        _id: string,
        version: number,
        _status: EncounterRecord['status'],
        patch: Partial<EncounterRecord>,
        event: EncounterHistoryEvent,
      ) => ({
        ...record(),
        ...patch,
        version: version + 1,
        history: [...record().history, event],
      }),
    ),
    history: vi.fn(async () => record().history),
  };
  const appointment = {
    findById: vi.fn(async () => ({
      id: appointmentId,
      patientId,
      doctorId,
      facilityId,
      branchId: null,
      startsAt: new Date('2026-10-17T09:00:00.000Z'),
      status: 'SCHEDULED',
    })),
  };
  const patients = { findById: vi.fn(async () => ({ status: 'ACTIVE' })) };
  const doctors = {
    findById: vi.fn(async () => ({ operationallyActive: true, staffId: actorId })),
  };
  const facilities = { findById: vi.fn(async () => ({ status: 'ACTIVE' })) };
  const branches = { findById: vi.fn(async () => ({ facilityId, status: 'ACTIVE' })) };
  const staffScopes = {
    resolveMembershipScope: vi.fn(async () => null),
    listFacilities: vi.fn(async () => ({
      items: [{ facilityId, facilityStatus: 'ACTIVE' }],
    })),
    listBranches: vi.fn(async () => ({ items: [] })),
  };
  const schedulingPolicies = {
    effectiveTimeZone: vi.fn(async () => 'Asia/Riyadh'),
    effectiveTimeZones: vi.fn(
      async (ids: string[]) => new Map(ids.map((id) => [id, 'Asia/Riyadh'])),
    ),
  };
  const authorization = { authorize: vi.fn(async () => undefined) };
  const audit = { recordAudit: vi.fn(async () => undefined) };
  const service = new EncounterService(
    repository as never,
    appointment as never,
    patients as never,
    doctors as never,
    facilities as never,
    branches as never,
    staffScopes as never,
    schedulingPolicies as never,
    authorization as never,
    audit as never,
  );
  return {
    service,
    repository,
    appointment,
    patients,
    doctors,
    facilities,
    branches,
    staffScopes,
    schedulingPolicies,
    authorization,
    audit,
  };
}) satisfies () => unknown;

describe('EncounterService', () => {
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    harness = makeHarness();
  });

  it('creates a draft from an eligible appointment after checking tenant references and scope', async () => {
    const created = await harness.service.createFromAppointment(context, { appointmentId }, actor);

    expect(created.status).toBe('DRAFT');
    expect(created.appointmentId).toBe(appointmentId);
    expect(created.clinical).toEqual({});
    expect(created).not.toHaveProperty('history');
    expect(harness.authorization.authorize).toHaveBeenCalledWith(
      context,
      'tenant.appointments.read',
    );
    expect(harness.patients.findById).toHaveBeenCalledWith(context, patientId);
    expect(harness.doctors.findById).toHaveBeenCalledWith(context, doctorId);
    expect(harness.repository.create).toHaveBeenCalledOnce();
    expect(harness.audit.recordAudit).toHaveBeenCalledOnce();
    const auditInput = harness.audit.recordAudit.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    };
    expect(JSON.stringify(auditInput)).not.toContain('chiefComplaint');
    expect(JSON.stringify(auditInput)).not.toContain('medicalHistory');
  });

  it('rejects unauthorized direct creation before reading or writing clinical references', async () => {
    harness.authorization.authorize.mockImplementation(async (_context, permission) => {
      if (permission === 'tenant.encounters.create.direct') throw new ForbiddenException();
    });

    await expect(
      harness.service.createDirect(context, { patientId, doctorId, facilityId }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.patients.findById).not.toHaveBeenCalled();
    expect(harness.repository.create).not.toHaveBeenCalled();
  });

  it('rejects inactive patient and branch references and providers outside assigned facilities', async () => {
    harness.patients.findById.mockResolvedValueOnce({ status: 'INACTIVE' });
    await expect(
      harness.service.createDirect(context, { patientId, doctorId, facilityId }, actor),
    ).rejects.toBeInstanceOf(EncounterReferenceInvalidError);
    expect(harness.repository.create).not.toHaveBeenCalled();

    harness.branches.findById.mockResolvedValueOnce({
      facilityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'ACTIVE',
    });
    await expect(
      harness.service.createDirect(
        context,
        {
          patientId,
          doctorId,
          facilityId,
          branchId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(EncounterReferenceInvalidError);

    harness.staffScopes.listFacilities.mockResolvedValueOnce({ items: [] });
    await expect(
      harness.service.createDirect(context, { patientId, doctorId, facilityId }, actor),
    ).rejects.toBeInstanceOf(EncounterReferenceInvalidError);
    expect(harness.repository.create).not.toHaveBeenCalled();
  });

  it('requires encounter-read in addition to clinical-write before reading a clinical record', async () => {
    harness.authorization.authorize.mockImplementation(async (_context, permission) => {
      if (permission === 'tenant.encounters.read') throw new ForbiddenException();
    });
    await expect(
      harness.service.updateClinical(
        context,
        encounterId,
        { expectedVersion: 1, clinical: { chiefComplaint: 'خاص' } },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.repository.findById).not.toHaveBeenCalled();
  });

  it('rejects ineligible appointments and duplicate active appointment links', async () => {
    harness.appointment.findById.mockResolvedValueOnce({
      id: appointmentId,
      patientId,
      doctorId,
      facilityId,
      branchId: null,
      startsAt: new Date(),
      status: 'CANCELLED',
    });
    await expect(
      harness.service.createFromAppointment(context, { appointmentId }, actor),
    ).rejects.toBeInstanceOf(EncounterReferenceInvalidError);
    expect(harness.repository.create).not.toHaveBeenCalled();

    harness.repository.findActiveByAppointment.mockResolvedValueOnce(record());
    await expect(
      harness.service.createFromAppointment(context, { appointmentId }, actor),
    ).rejects.toBeInstanceOf(EncounterAppointmentConflictError);
    expect(harness.repository.create).not.toHaveBeenCalled();
  });

  it('enforces optimistic concurrency and immutable finalized encounters', async () => {
    harness.repository.findById.mockResolvedValueOnce(record({ version: 4 }));
    await expect(
      harness.service.updateClinical(
        context,
        encounterId,
        { expectedVersion: 3, clinical: { chiefComplaint: 'صداع' } },
        actor,
      ),
    ).rejects.toBeInstanceOf(EncounterVersionConflictError);
    expect(harness.repository.update).not.toHaveBeenCalled();

    harness.repository.findById.mockResolvedValueOnce(
      record({ status: EncounterStatus.COMPLETED }),
    );
    await expect(
      harness.service.updateClinical(
        context,
        encounterId,
        { expectedVersion: 1, clinical: { chiefComplaint: 'صداع' } },
        actor,
      ),
    ).rejects.toBeInstanceOf(EncounterStateConflictError);
    expect(harness.repository.update).not.toHaveBeenCalled();
  });

  it('validates vital units, supports explicit information states, and records metadata only', async () => {
    const current = record();
    harness.repository.findById.mockResolvedValueOnce(current);
    const updated = await harness.service.updateClinical(
      context,
      encounterId,
      {
        expectedVersion: 1,
        clinical: {
          chiefComplaint: 'ألم في الرأس',
          medicalHistory: { status: 'UNKNOWN' },
          vitalSigns: { temperature: { value: 37, unit: '°C' } },
        },
      },
      actor,
    );
    expect(updated.clinical.chiefComplaint).toBe('ألم في الرأس');
    expect(updated.clinical.medicalHistory).toEqual({ status: 'UNKNOWN' });
    const event = harness.repository.update.mock.calls[0]?.[5];
    expect(event?.changedFields).toEqual([
      'chiefComplaint',
      'medicalHistory',
      'vitalSigns.temperature',
    ]);
    expect(JSON.stringify(event)).not.toContain('ألم في الرأس');
    const auditInput = harness.audit.recordAudit.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    };
    expect(JSON.stringify(auditInput)).not.toContain('ألم في الرأس');

    harness.repository.findById.mockResolvedValueOnce(current);
    await expect(
      harness.service.updateClinical(
        context,
        encounterId,
        {
          expectedVersion: 1,
          clinical: { vitalSigns: { temperature: { value: 40, unit: 'K' } } },
        } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(EncounterInputValidationError);
  });

  it('finalizes and cancels drafts through separate explicit transitions', async () => {
    harness.repository.findById.mockResolvedValueOnce(record());
    const completed = await harness.service.complete(
      context,
      encounterId,
      { expectedVersion: 1 },
      actor,
    );
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedBy).toBe(actorId);

    harness.repository.findById.mockResolvedValueOnce(record());
    const cancelled = await harness.service.cancel(
      context,
      encounterId,
      { expectedVersion: 1, reason: 'المراجع لم يحضر' },
      actor,
    );
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancellationReason).toBe('المراجع لم يحضر');
    const event = harness.repository.update.mock.calls.at(-1)?.[5];
    expect(JSON.stringify(event)).not.toContain('المراجع لم يحضر');
  });

  it('hides records outside staff scope and reports missing records without cross-tenant details', async () => {
    harness.staffScopes.resolveMembershipScope.mockResolvedValue({
      facilities: [],
      branches: [],
    } as never);
    await expect(harness.service.findById(context, encounterId)).rejects.toBeInstanceOf(
      EncounterNotFoundError,
    );

    harness.repository.findById.mockResolvedValueOnce(null);
    await expect(harness.service.findById(context, encounterId)).rejects.toBeInstanceOf(
      EncounterNotFoundError,
    );
    expect(harness.repository.findById).toHaveBeenCalledWith(context, encounterId);
  });

  it('uses the active facility policy timezone for local-date listing', async () => {
    await harness.service.list(context, {
      facilityId,
      search: appointmentId,
      fromDate: '2026-10-17',
      toDate: '2026-10-18',
      limit: 50,
      offset: 0,
    });
    const filter = harness.repository.list.mock.calls[0]?.[1];
    expect(filter?.search).toBe(appointmentId);
    expect(filter?.from?.toISOString()).toBe('2026-10-16T21:00:00.000Z');
    expect(filter?.to?.toISOString()).toBe('2026-10-18T21:00:00.000Z');
  });

  it('returns clinical patient history only under its dedicated permission', async () => {
    harness.repository.list.mockResolvedValueOnce({
      items: [record({ clinical: { chiefComplaint: 'خاص' } })],
      total: 1,
      limit: 50,
      offset: 0,
      hasNext: false,
    });
    const result = await harness.service.patientHistory(context, patientId, {
      limit: 50,
      offset: 0,
    });
    expect(result.items[0]?.clinical.chiefComplaint).toBe('خاص');
    expect(harness.authorization.authorize).toHaveBeenCalledWith(
      context,
      'tenant.encounters.patient-history.read',
    );
  });
});
