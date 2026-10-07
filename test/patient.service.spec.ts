import { PatientStatus, PlatformAuditEventType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import {
  PatientIdInvalidError,
  PatientInputValidationError,
  PatientLifecycleConflictError,
  PatientNotFoundError,
  PatientNumberConflictError,
} from '../src/tenant/patient.errors';
import type { PatientRecord } from '../src/tenant/patient.repository';
import { PatientService } from '../src/tenant/patient.service';
import { TenantContextInvalidError } from '../src/tenant/tenant-context.contract';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const platformUserId = '33333333-3333-4333-8333-333333333333';
const patientId = '44444444-4444-4444-8444-444444444444';
const timestamp = new Date('2026-10-07T10:00:00.000Z');
const context = { tenantId, membershipId, platformUserId } as TrustedTenantContext;
const actor = {
  userId: platformUserId,
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: ['PLATFORM_ADMIN'],
} as AuthenticatedPlatformUser;
const requestContext = {
  requestId: 'patient-request-27',
  ipAddress: '127.0.0.1',
  userAgent: 'patient-service-test',
};

function record(status = PatientStatus.ACTIVE): PatientRecord {
  return {
    id: patientId,
    patientNumber: 'PAT-000001',
    firstName: 'Amina',
    middleName: null,
    lastName: 'Hassan',
    preferredName: null,
    dateOfBirth: new Date('1990-06-15T00:00:00.000Z'),
    gender: null,
    phone: null,
    email: null,
    nationalId: null,
    address: null,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('PatientService', () => {
  const patients = {
    create: vi.fn(),
    list: vi.fn(),
    findByIdForTenant: vi.fn(),
    update: vi.fn(),
    changeStatusIfCurrent: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  let service: PatientService;

  beforeEach(() => {
    vi.resetAllMocks();
    audit.recordAudit.mockResolvedValue(undefined);
    service = new PatientService(
      patients as unknown as ConstructorParameters<typeof PatientService>[0],
      audit as unknown as PlatformAuditService,
    );
  });

  it('creates normalized tenant patients and audits only safe identifiers', async () => {
    patients.create.mockResolvedValue({ kind: 'changed', record: record() });
    const payload = {
      patientNumber: ' PAT-000001 ',
      firstName: '  Amina   Noor ',
      lastName: ' Hassan ',
      email: ' PERSON@EXAMPLE.COM ',
      phone: '+1 (555) 123-4567',
      dateOfBirth: '1990-06-15',
      nationalId: ' ID-9988 ',
      address: ' 12 Main Street ',
    };

    await expect(
      service.create(context, payload as never, actor, requestContext),
    ).resolves.toMatchObject({
      dateOfBirth: '1990-06-15',
      patientNumber: 'PAT-000001',
    });
    expect(patients.create).toHaveBeenCalledWith(tenantId, {
      patientNumber: 'PAT-000001',
      firstName: 'Amina Noor',
      lastName: 'Hassan',
      email: 'person@example.com',
      phone: '+1 (555) 123-4567',
      dateOfBirth: new Date('1990-06-15T00:00:00.000Z'),
      nationalId: 'ID-9988',
      address: '12 Main Street',
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.PATIENT_CREATED,
        actorUserId: platformUserId,
        sessionId: actor.sessionId,
        subjectTenantId: tenantId,
        requestId: requestContext.requestId,
        metadata: {
          targetType: 'PATIENT',
          targetId: patientId,
          action: 'created',
          status: PatientStatus.ACTIVE,
        },
      }),
    );
    const metadata = audit.recordAudit.mock.calls[0][0].metadata;
    expect(metadata).not.toHaveProperty('nationalId');
    expect(metadata).not.toHaveProperty('address');
    expect(metadata).not.toHaveProperty('email');
    expect(metadata).not.toHaveProperty('phone');
    expect(metadata).not.toHaveProperty('dateOfBirth');
    expect(metadata).not.toHaveProperty('patientNumber');
  });

  it('lists with the trusted tenant, exact-number and status filters, bounded paging, and no read audit', async () => {
    patients.list.mockResolvedValue({ items: [record(PatientStatus.INACTIVE)], total: 26 });

    await expect(
      service.list(context, {
        status: PatientStatus.INACTIVE,
        patientNumber: 'PAT-000001',
        limit: 20,
        offset: 5,
      }),
    ).resolves.toMatchObject({
      items: [{ status: PatientStatus.INACTIVE }],
      limit: 20,
      offset: 5,
      total: 26,
      hasNext: true,
    });
    expect(patients.list).toHaveBeenCalledWith(tenantId, {
      status: PatientStatus.INACTIVE,
      patientNumber: 'PAT-000001',
      limit: 20,
      offset: 5,
    });
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects invalid filters, status values, and unsafe pagination', async () => {
    for (const query of [
      { status: 'UNKNOWN', limit: 20, offset: 0 },
      { patientNumber: ' ', limit: 20, offset: 0 },
      { limit: 0, offset: 0 },
      { limit: 101, offset: 0 },
      { limit: 'not-a-number', offset: 0 },
      { limit: 20, offset: -1 },
      { limit: 20, offset: '' },
      { limit: 20, offset: 100_001 },
      { limit: 20, offset: 0, tenantId: otherTenantId },
    ]) {
      await expect(service.list(context, query as never)).rejects.toBeInstanceOf(
        PatientInputValidationError,
      );
    }
    expect(patients.list).not.toHaveBeenCalled();
  });

  it('reads only a patient returned for the trusted tenant', async () => {
    patients.findByIdForTenant.mockResolvedValueOnce(record()).mockResolvedValueOnce(null);

    await expect(service.findById(context, patientId)).resolves.toMatchObject({
      id: patientId,
      dateOfBirth: '1990-06-15',
    });
    await expect(service.findById(context, patientId)).rejects.toBeInstanceOf(PatientNotFoundError);
    expect(patients.findByIdForTenant).toHaveBeenNthCalledWith(1, tenantId, patientId);
    expect(patients.findByIdForTenant).toHaveBeenNthCalledWith(2, tenantId, patientId);
  });

  it('updates partial values and clears nullable fields while auditing field names only', async () => {
    patients.update.mockResolvedValue({ kind: 'changed', record: { ...record(), phone: null } });

    await expect(
      service.update(
        context,
        patientId,
        { phone: null, nationalId: null } as never,
        actor,
        requestContext,
      ),
    ).resolves.toMatchObject({ phone: null });
    expect(patients.update).toHaveBeenCalledWith(tenantId, patientId, {
      phone: null,
      nationalId: null,
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.PATIENT_UPDATED,
        subjectTenantId: tenantId,
        metadata: {
          targetType: 'PATIENT',
          targetId: patientId,
          action: 'updated',
          changedFields: 'phone,nationalId',
        },
      }),
    );
  });

  it('rejects required-field, email, phone, date, HTML address, and protected-field errors', async () => {
    const invalidPayloads = [
      {},
      { patientNumber: 'PAT-1', firstName: '', lastName: 'Valid' },
      { patientNumber: 'PAT-1', firstName: 'Valid', lastName: 'Valid', email: 'not-an-email' },
      { patientNumber: 'PAT-1', firstName: 'Valid', lastName: 'Valid', phone: 'call me' },
      { patientNumber: 'PAT-1', firstName: 'Valid', lastName: 'Valid', dateOfBirth: '2026-99-99' },
      {
        patientNumber: 'PAT-1',
        firstName: 'Valid',
        lastName: 'Valid',
        address: '<script>bad</script>',
      },
      { patientNumber: 'PAT-1', firstName: 'x'.repeat(192), lastName: 'Valid' },
      { patientNumber: 'PAT-1', firstName: 'Valid', lastName: 'Valid', status: 'INACTIVE' },
      {
        patientNumber: 'PAT-1',
        firstName: 'Valid',
        lastName: 'Valid',
        tenantId: otherTenantId,
      },
    ];
    for (const payload of invalidPayloads) {
      await expect(service.create(context, payload as never, actor)).rejects.toBeInstanceOf(
        PatientInputValidationError,
      );
    }

    await expect(service.update(context, patientId, {} as never, actor)).rejects.toBeInstanceOf(
      PatientInputValidationError,
    );
    await expect(
      service.update(context, patientId, { status: PatientStatus.INACTIVE } as never, actor),
    ).rejects.toBeInstanceOf(PatientInputValidationError);
    expect(patients.create).not.toHaveBeenCalled();
    expect(patients.update).not.toHaveBeenCalled();
  });

  it('rejects future birth dates and maps tenant-scoped patient-number conflicts', async () => {
    const futureDate = new Date();
    futureDate.setUTCDate(futureDate.getUTCDate() + 2);
    const futureDateOnly = futureDate.toISOString().slice(0, 10);
    await expect(
      service.create(
        context,
        {
          patientNumber: 'PAT-1',
          firstName: 'Valid',
          lastName: 'Valid',
          dateOfBirth: futureDateOnly,
        } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(PatientInputValidationError);

    patients.create.mockResolvedValue({ kind: 'patient-number-conflict' });
    await expect(
      service.create(
        context,
        { patientNumber: 'PAT-1', firstName: 'Valid', lastName: 'Valid' },
        actor,
      ),
    ).rejects.toBeInstanceOf(PatientNumberConflictError);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('audits explicit reversible ACTIVE/INACTIVE transitions', async () => {
    patients.findByIdForTenant.mockResolvedValueOnce(record(PatientStatus.ACTIVE));
    patients.changeStatusIfCurrent.mockResolvedValue({
      kind: 'changed',
      record: record(PatientStatus.INACTIVE),
    });

    await expect(
      service.deactivate(context, patientId, actor, requestContext),
    ).resolves.toMatchObject({
      status: PatientStatus.INACTIVE,
    });
    expect(patients.changeStatusIfCurrent).toHaveBeenCalledWith(
      tenantId,
      patientId,
      PatientStatus.ACTIVE,
      PatientStatus.INACTIVE,
      expect.any(Date),
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.PATIENT_STATUS_CHANGED,
        subjectTenantId: tenantId,
        metadata: {
          targetType: 'PATIENT',
          targetId: patientId,
          action: 'deactivated',
          fromStatus: PatientStatus.ACTIVE,
          toStatus: PatientStatus.INACTIVE,
        },
      }),
    );
  });

  it('does not audit no-op lifecycle changes and reports concurrent status conflicts', async () => {
    patients.findByIdForTenant
      .mockResolvedValueOnce(record(PatientStatus.ACTIVE))
      .mockResolvedValueOnce(record(PatientStatus.ACTIVE))
      .mockResolvedValueOnce(record(PatientStatus.ACTIVE));
    patients.changeStatusIfCurrent.mockResolvedValue({ kind: 'not-changed' });

    await expect(service.activate(context, patientId, actor)).resolves.toMatchObject({
      status: PatientStatus.ACTIVE,
    });
    await expect(service.deactivate(context, patientId, actor)).rejects.toBeInstanceOf(
      PatientLifecycleConflictError,
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects malformed identifiers and mismatched actors before repository access', async () => {
    await expect(service.findById(context, 'not-a-uuid')).rejects.toBeInstanceOf(
      PatientIdInvalidError,
    );
    await expect(
      service.create(
        context,
        { patientNumber: 'PAT-1', firstName: 'A', lastName: 'B' },
        {
          ...actor,
          userId: otherTenantId,
        },
      ),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
    expect(patients.findByIdForTenant).not.toHaveBeenCalled();
    expect(patients.create).not.toHaveBeenCalled();
  });
});
