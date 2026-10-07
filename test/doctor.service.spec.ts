import {
  PlatformAuditEventType,
  StaffStatus,
  TenantCatalogStatus,
  TenantStatus,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import {
  DoctorAlreadyExistsError,
  DoctorAssignmentConflictError,
  DoctorInputValidationError,
  DoctorLifecycleConflictError,
  DoctorProfessionalCodeConflictError,
  DoctorStaffIneligibleError,
  DoctorStaffNotFoundError,
} from '../src/tenant/doctor.errors';
import { DoctorService } from '../src/tenant/doctor.service';
import type { DoctorRecord } from '../src/tenant/doctor.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorUserId = '22222222-2222-4222-8222-222222222222';
const actorMembershipId = '33333333-3333-4333-8333-333333333333';
const staffId = '44444444-4444-4444-8444-444444444444';
const doctorId = '55555555-5555-4555-8555-555555555555';
const departmentId = '66666666-6666-4666-8666-666666666666';
const specialtyId = '77777777-7777-4777-8777-777777777777';
const fixedTime = new Date('2026-10-07T10:00:00.000Z');

const context = {
  tenantId,
  membershipId: actorMembershipId,
  platformUserId: actorUserId,
} as TrustedTenantContext;

const actor: AuthenticatedPlatformUser = {
  userId: actorUserId,
  sessionId: '88888888-8888-4888-8888-888888888888',
  tokenVersion: 1,
  platformRoleIds: ['PLATFORM_ADMIN'],
};

function doctorRecord(
  patch: Partial<DoctorRecord> & {
    tenant?: Partial<DoctorRecord['tenant']>;
    staff?: Partial<DoctorRecord['staff']>;
  } = {},
): DoctorRecord {
  const base = {
    id: doctorId,
    tenantId,
    staffId,
    professionalDisplayName: 'Dr Taylor Member',
    status: StaffStatus.ACTIVE,
    statusChangedAt: fixedTime,
    suspendedAt: null,
    deactivatedAt: null,
    professionalTitle: null,
    professionalCode: null,
    bio: null,
    createdAt: fixedTime,
    updatedAt: fixedTime,
    tenant: { status: TenantStatus.ACTIVE },
    staff: {
      id: staffId,
      userId: '99999999-9999-4999-8999-999999999999',
      displayName: 'Taylor Member',
      status: StaffStatus.ACTIVE,
    },
    departmentAssignments: [
      {
        createdAt: fixedTime,
        department: { id: departmentId, name: 'Cardiology', status: TenantCatalogStatus.ACTIVE },
      },
    ],
    specialtyAssignments: [
      {
        createdAt: fixedTime,
        specialty: {
          id: specialtyId,
          name: 'Interventional Cardiology',
          status: TenantCatalogStatus.ACTIVE,
        },
      },
    ],
  };
  return {
    ...base,
    ...patch,
    tenant: { ...base.tenant, ...patch.tenant },
    staff: { ...base.staff, ...patch.staff },
  } as DoctorRecord;
}

describe('DoctorService', () => {
  const repository = {
    create: vi.fn(),
    listForTenant: vi.fn(),
    findByIdForTenant: vi.fn(),
    updateForTenant: vi.fn(),
    changeStatusIfCurrent: vi.fn(),
    assignDepartment: vi.fn(),
    unassignDepartment: vi.fn(),
    assignSpecialty: vi.fn(),
    unassignSpecialty: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  let service: DoctorService;

  beforeEach(() => {
    vi.clearAllMocks();
    audit.recordAudit.mockResolvedValue(undefined);
    repository.create.mockResolvedValue({ kind: 'created', doctor: doctorRecord() });
    repository.listForTenant.mockResolvedValue([doctorRecord()]);
    repository.findByIdForTenant.mockResolvedValue(doctorRecord());
    repository.updateForTenant.mockResolvedValue({ kind: 'changed', doctor: doctorRecord() });
    repository.changeStatusIfCurrent.mockResolvedValue({
      kind: 'changed',
      doctor: doctorRecord({ status: StaffStatus.SUSPENDED }),
    });
    repository.assignDepartment.mockResolvedValue({ kind: 'changed', doctor: doctorRecord() });
    repository.unassignDepartment.mockResolvedValue({ kind: 'changed', doctor: doctorRecord() });
    repository.assignSpecialty.mockResolvedValue({ kind: 'changed', doctor: doctorRecord() });
    repository.unassignSpecialty.mockResolvedValue({ kind: 'changed', doctor: doctorRecord() });
    service = new DoctorService(repository as never, audit as never);
  });

  it('creates a Doctor on existing Staff with normalized profile and explicit assignments', async () => {
    repository.create.mockResolvedValueOnce({
      kind: 'created',
      doctor: doctorRecord({
        professionalDisplayName: 'Dr Taylor Member',
        professionalTitle: 'Consultant',
        professionalCode: 'MD 100',
        bio: 'Professional biography',
      }),
    });
    const response = await service.create(
      context,
      {
        staffId: staffId.toUpperCase(),
        professionalDisplayName: '  Dr   Taylor Member ',
        professionalTitle: ' Consultant ',
        professionalCode: ' MD   100 ',
        bio: '  Professional biography\r\n',
        departmentIds: [departmentId.toUpperCase()],
        specialtyIds: [specialtyId],
      },
      actor,
    );

    expect(repository.create).toHaveBeenCalledWith(tenantId, {
      staffId,
      professionalDisplayName: 'Dr Taylor Member',
      professionalTitle: 'Consultant',
      professionalCode: 'MD 100',
      bio: 'Professional biography',
      departmentIds: [departmentId],
      specialtyIds: [specialtyId],
    });
    expect(response).toMatchObject({
      id: doctorId,
      staffId,
      staff: { id: staffId, displayName: 'Taylor Member' },
      professionalDisplayName: 'Dr Taylor Member',
      professionalTitle: 'Consultant',
      professionalCode: 'MD 100',
      bio: 'Professional biography',
      operationallyActive: true,
      departments: [{ id: departmentId, name: 'Cardiology' }],
      specialties: [{ id: specialtyId, name: 'Interventional Cardiology' }],
    });
    expect(response.staff).not.toHaveProperty('userId');
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.DOCTOR_CREATED,
        actorUserId,
        subjectUserId: doctorRecord().staff.userId,
        subjectTenantId: tenantId,
        metadata: expect.objectContaining({
          doctorId,
          staffId,
          professionalFields: [
            'professionalDisplayName',
            'professionalTitle',
            'professionalCode',
            'bio',
          ],
        }),
      }),
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.DOCTOR_DEPARTMENT_ASSIGNED,
        metadata: expect.objectContaining({ departmentId }),
      }),
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.DOCTOR_SPECIALTY_ASSIGNED,
        metadata: expect.objectContaining({ specialtyId }),
      }),
    );
  });

  it('rejects client-supplied tenant, user, membership, role, and scope identity fields', async () => {
    await expect(
      service.create(
        context,
        {
          staffId,
          tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          userId: actorUserId,
          membershipId: actorMembershipId,
          roleIds: ['OWNER'],
          facilityIds: [],
          branchIds: [],
        } as never,
        actor,
      ),
    ).rejects.toThrow();
    expect(repository.create).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('requires the authenticated actor to match the trusted tenant context', async () => {
    await expect(
      service.create(context, { staffId }, { ...actor, userId: staffId }),
    ).rejects.toThrow();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('maps missing, inactive, duplicate, and cross-tenant Staff outcomes safely', async () => {
    repository.create.mockResolvedValueOnce({ kind: 'staff-not-found' });
    await expect(service.create(context, { staffId }, actor)).rejects.toBeInstanceOf(
      DoctorStaffNotFoundError,
    );
    repository.create.mockResolvedValueOnce({ kind: 'staff-ineligible' });
    await expect(service.create(context, { staffId }, actor)).rejects.toBeInstanceOf(
      DoctorStaffIneligibleError,
    );
    repository.create.mockResolvedValueOnce({ kind: 'already-exists' });
    await expect(service.create(context, { staffId }, actor)).rejects.toBeInstanceOf(
      DoctorAlreadyExistsError,
    );
    repository.create.mockResolvedValueOnce({ kind: 'professional-code-conflict' });
    await expect(
      service.create(context, { staffId, professionalCode: 'MD-100' }, actor),
    ).rejects.toBeInstanceOf(DoctorProfessionalCodeConflictError);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('lists Doctors only with the trusted tenant and validated pagination', async () => {
    const response = await service.list(context, {
      status: StaffStatus.ACTIVE,
      limit: 10,
      offset: 5,
    });

    expect(repository.listForTenant).toHaveBeenCalledWith(tenantId, {
      status: StaffStatus.ACTIVE,
      limit: 10,
      offset: 5,
    });
    expect(response.items).toHaveLength(1);
    expect(response.items[0].operationallyActive).toBe(true);
    expect(response.limit).toBe(10);
    expect(response.offset).toBe(5);
  });

  it('computes operational state from Tenant, Staff, and Doctor status only', async () => {
    repository.listForTenant.mockResolvedValueOnce([
      doctorRecord({ tenant: { status: TenantStatus.SUSPENDED } }),
      doctorRecord({ staff: { status: StaffStatus.SUSPENDED } }),
      doctorRecord({ staff: { status: StaffStatus.DEACTIVATED } }),
      doctorRecord({ status: StaffStatus.SUSPENDED }),
      doctorRecord({ status: StaffStatus.DEACTIVATED }),
      doctorRecord(),
    ]);

    const response = await service.list(context, { limit: 50, offset: 0 });

    expect(response.items.map(({ operationallyActive }) => operationallyActive)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('updates only the professional display-name override and audits actual changes', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(doctorRecord());
    repository.updateForTenant.mockResolvedValueOnce({
      kind: 'changed',
      doctor: doctorRecord({ professionalDisplayName: 'Dr Taylor Updated' }),
    });

    const response = await service.update(
      context,
      doctorId,
      { professionalDisplayName: 'Dr Taylor Updated' },
      actor,
    );

    expect(repository.updateForTenant).toHaveBeenCalledWith(tenantId, doctorId, {
      professionalDisplayName: 'Dr Taylor Updated',
    });
    expect(response.professionalDisplayName).toBe('Dr Taylor Updated');
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.DOCTOR_UPDATED,
        metadata: expect.objectContaining({ changedFields: 'professionalDisplayName' }),
      }),
    );
  });

  it('supports partial profile updates without changing Doctor or Staff lifecycle', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(
      doctorRecord({
        professionalCode: 'MD 100',
        status: StaffStatus.SUSPENDED,
        staff: { status: StaffStatus.SUSPENDED },
      }),
    );
    repository.updateForTenant.mockResolvedValueOnce({
      kind: 'changed',
      doctor: doctorRecord({
        professionalCode: 'MD-200',
        professionalTitle: 'Consultant',
        bio: 'Updated biography',
        status: StaffStatus.SUSPENDED,
        staff: { status: StaffStatus.SUSPENDED },
      }),
    });

    const response = await service.update(
      context,
      doctorId,
      {
        professionalTitle: ' Consultant ',
        professionalCode: ' MD-200 ',
        bio: ' Updated biography ',
      },
      actor,
    );

    expect(repository.updateForTenant).toHaveBeenCalledWith(tenantId, doctorId, {
      professionalTitle: 'Consultant',
      professionalCode: 'MD-200',
      bio: 'Updated biography',
    });
    expect(response).toMatchObject({
      professionalCode: 'MD-200',
      professionalTitle: 'Consultant',
      bio: 'Updated biography',
      status: StaffStatus.SUSPENDED,
      staff: { status: StaffStatus.SUSPENDED },
      operationallyActive: false,
    });
    expect(audit.recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.DOCTOR_UPDATED,
        metadata: expect.objectContaining({
          changedFields: 'professionalTitle,professionalCode,bio',
        }),
      }),
    );
  });

  it('keeps deactivated Staff non-operational when Doctor profile data changes', async () => {
    const deactivatedStaff = {
      ...doctorRecord().staff,
      status: StaffStatus.DEACTIVATED,
    };
    repository.findByIdForTenant.mockResolvedValueOnce(doctorRecord({ staff: deactivatedStaff }));
    repository.updateForTenant.mockResolvedValueOnce({
      kind: 'changed',
      doctor: doctorRecord({
        professionalTitle: 'Consultant',
        staff: deactivatedStaff,
      }),
    });

    const response = await service.update(
      context,
      doctorId,
      { professionalTitle: 'Consultant' },
      actor,
    );

    expect(response.status).toBe(StaffStatus.ACTIVE);
    expect(response.staff.status).toBe(StaffStatus.DEACTIVATED);
    expect(response.operationallyActive).toBe(false);
    expect(repository.updateForTenant).toHaveBeenCalledWith(tenantId, doctorId, {
      professionalTitle: 'Consultant',
    });
  });

  it('rejects empty, invalid, overlong, HTML, and protected-field profile updates', async () => {
    const invalidInputs = [
      {},
      { professionalDisplayName: '  ' },
      { professionalDisplayName: 'n'.repeat(192) },
      { professionalTitle: 't'.repeat(192) },
      { professionalCode: '   ' },
      { professionalCode: 'c'.repeat(65) },
      { bio: 'b'.repeat(2001) },
      { bio: '<script>alert(1)</script>' },
      { tenantId },
      { staffId },
      { membershipId: actorMembershipId },
      { roleIds: ['OWNER'] },
      { permissionIds: ['tenant.doctors.manage'] },
      { facilityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { branchId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { subscriptionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      { entitlementId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      { quota: 1 },
      { status: StaffStatus.ACTIVE },
      { yearsOfExperience: 10 },
      { departmentIds: [departmentId] },
      { specialtyIds: [specialtyId] },
    ];

    for (const input of invalidInputs) {
      await expect(service.update(context, doctorId, input as never, actor)).rejects.toBeInstanceOf(
        DoctorInputValidationError,
      );
    }
    expect(repository.findByIdForTenant).not.toHaveBeenCalled();
    expect(repository.updateForTenant).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('maps a duplicate professional code to a conflict without auditing failure', async () => {
    repository.updateForTenant.mockResolvedValueOnce({ kind: 'professional-code-conflict' });

    await expect(
      service.update(context, doctorId, { professionalCode: 'MD-100' }, actor),
    ).rejects.toBeInstanceOf(DoctorProfessionalCodeConflictError);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('allows clearing optional profile fields with null', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(
      doctorRecord({
        professionalDisplayName: 'Dr Taylor Member',
        professionalTitle: 'Consultant',
        professionalCode: 'MD-100',
        bio: 'Professional biography',
      }),
    );
    repository.updateForTenant.mockResolvedValueOnce({
      kind: 'changed',
      doctor: doctorRecord({
        professionalDisplayName: null,
        professionalTitle: null,
        professionalCode: null,
        bio: null,
      }),
    });

    const response = await service.update(
      context,
      doctorId,
      {
        professionalDisplayName: null,
        professionalTitle: null,
        professionalCode: null,
        bio: null,
      },
      actor,
    );

    expect(repository.updateForTenant).toHaveBeenCalledWith(tenantId, doctorId, {
      professionalDisplayName: null,
      professionalTitle: null,
      professionalCode: null,
      bio: null,
    });
    expect(response).toMatchObject({
      professionalDisplayName: null,
      professionalTitle: null,
      professionalCode: null,
      bio: null,
    });
  });

  it('does not reactivate deactivated Doctors when updating administrative profile data', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(
      doctorRecord({ status: StaffStatus.DEACTIVATED }),
    );
    repository.updateForTenant.mockResolvedValueOnce({
      kind: 'changed',
      doctor: doctorRecord({
        professionalTitle: 'Consultant',
        status: StaffStatus.DEACTIVATED,
      }),
    });

    const response = await service.update(
      context,
      doctorId,
      { professionalTitle: 'Consultant' },
      actor,
    );

    expect(response.status).toBe(StaffStatus.DEACTIVATED);
    expect(response.operationallyActive).toBe(false);
    expect(repository.updateForTenant).toHaveBeenCalledWith(tenantId, doctorId, {
      professionalTitle: 'Consultant',
    });
  });

  it('does not update a Doctor outside the trusted tenant', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(null);

    await expect(
      service.update(context, doctorId, { professionalTitle: 'Consultant' }, actor),
    ).rejects.toThrow();
    expect(repository.findByIdForTenant).toHaveBeenCalledWith(tenantId, doctorId);
    expect(repository.updateForTenant).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('does not audit a no-op profile update', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(doctorRecord());

    await service.update(context, doctorId, { professionalDisplayName: 'Dr Taylor Member' }, actor);

    expect(repository.updateForTenant).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('suspends and reactivates a Doctor with lifecycle audit events', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(doctorRecord());
    repository.changeStatusIfCurrent.mockResolvedValueOnce({
      kind: 'changed',
      doctor: doctorRecord({ status: StaffStatus.SUSPENDED }),
    });
    const suspended = await service.suspend(context, doctorId, actor);
    expect(suspended.status).toBe(StaffStatus.SUSPENDED);
    expect(repository.changeStatusIfCurrent).toHaveBeenCalledWith(
      tenantId,
      doctorId,
      StaffStatus.ACTIVE,
      StaffStatus.SUSPENDED,
      expect.any(Date),
    );
    expect(audit.recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: PlatformAuditEventType.DOCTOR_SUSPENDED }),
    );

    repository.findByIdForTenant.mockResolvedValueOnce(
      doctorRecord({ status: StaffStatus.SUSPENDED }),
    );
    repository.changeStatusIfCurrent.mockResolvedValueOnce({
      kind: 'changed',
      doctor: doctorRecord(),
    });
    const activated = await service.activate(context, doctorId, actor);
    expect(activated.status).toBe(StaffStatus.ACTIVE);
    expect(audit.recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: PlatformAuditEventType.DOCTOR_ACTIVATED }),
    );
  });

  it('allows a suspended Doctor to be deactivated and audits the terminal transition', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(
      doctorRecord({ status: StaffStatus.SUSPENDED }),
    );
    repository.changeStatusIfCurrent.mockResolvedValueOnce({
      kind: 'changed',
      doctor: doctorRecord({ status: StaffStatus.DEACTIVATED }),
    });

    const response = await service.deactivate(context, doctorId, actor);

    expect(response.status).toBe(StaffStatus.DEACTIVATED);
    expect(repository.changeStatusIfCurrent).toHaveBeenCalledWith(
      tenantId,
      doctorId,
      StaffStatus.SUSPENDED,
      StaffStatus.DEACTIVATED,
      expect.any(Date),
    );
    expect(audit.recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: PlatformAuditEventType.DOCTOR_DEACTIVATED }),
    );
  });

  it('keeps deactivation terminal and repeated same-state requests idempotent', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(doctorRecord());
    repository.changeStatusIfCurrent.mockResolvedValueOnce({
      kind: 'changed',
      doctor: doctorRecord({ status: StaffStatus.DEACTIVATED }),
    });
    await service.deactivate(context, doctorId, actor);

    repository.findByIdForTenant.mockResolvedValueOnce(
      doctorRecord({ status: StaffStatus.DEACTIVATED }),
    );
    await expect(service.activate(context, doctorId, actor)).rejects.toBeInstanceOf(
      DoctorLifecycleConflictError,
    );

    repository.findByIdForTenant.mockResolvedValueOnce(
      doctorRecord({ status: StaffStatus.DEACTIVATED }),
    );
    await service.deactivate(context, doctorId, actor);
    expect(repository.changeStatusIfCurrent).toHaveBeenCalledTimes(1);
  });

  it('audits explicit Department and Specialty assignments and removals', async () => {
    await service.assignDepartment(context, doctorId, { departmentId }, actor);
    expect(repository.assignDepartment).toHaveBeenCalledWith(tenantId, doctorId, departmentId);
    expect(audit.recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.DOCTOR_DEPARTMENT_ASSIGNED,
        metadata: expect.objectContaining({ doctorId, staffId, departmentId }),
      }),
    );

    await service.unassignDepartment(context, doctorId, departmentId, actor);
    expect(audit.recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.DOCTOR_DEPARTMENT_UNASSIGNED,
      }),
    );
    await service.assignSpecialty(context, doctorId, { specialtyId }, actor);
    expect(audit.recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.DOCTOR_SPECIALTY_ASSIGNED,
      }),
    );
    await service.unassignSpecialty(context, doctorId, specialtyId, actor);
    expect(audit.recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.DOCTOR_SPECIALTY_UNASSIGNED,
      }),
    );
  });

  it('does not infer one catalog relationship from the other', async () => {
    const response = await service.findById(context, doctorId);

    expect(response.departments).toEqual([
      expect.objectContaining({ id: departmentId, name: 'Cardiology' }),
    ]);
    expect(response.specialties).toEqual([
      expect.objectContaining({ id: specialtyId, name: 'Interventional Cardiology' }),
    ]);
    expect(repository.assignDepartment).not.toHaveBeenCalled();
    expect(repository.assignSpecialty).not.toHaveBeenCalled();
  });

  it('keeps suspended and deactivated catalog assignments visible until explicitly removed', async () => {
    const inactiveAssignmentRecord = doctorRecord({
      departmentAssignments: [
        {
          createdAt: fixedTime,
          department: {
            id: departmentId,
            name: 'Cardiology',
            status: TenantCatalogStatus.SUSPENDED,
          },
        },
      ],
      specialtyAssignments: [
        {
          createdAt: fixedTime,
          specialty: {
            id: specialtyId,
            name: 'Interventional Cardiology',
            status: TenantCatalogStatus.DEACTIVATED,
          },
        },
      ],
    });
    repository.findByIdForTenant
      .mockResolvedValueOnce(inactiveAssignmentRecord)
      .mockResolvedValueOnce(inactiveAssignmentRecord);

    const departments = await service.listDepartments(context, doctorId);
    const specialties = await service.listSpecialties(context, doctorId);

    expect(departments.items).toEqual([
      expect.objectContaining({ id: departmentId, status: TenantCatalogStatus.SUSPENDED }),
    ]);
    expect(specialties.items).toEqual([
      expect.objectContaining({ id: specialtyId, status: TenantCatalogStatus.DEACTIVATED }),
    ]);
  });

  it('rejects duplicate assignments and does not audit failed mutations', async () => {
    repository.assignDepartment.mockResolvedValueOnce({ kind: 'assignment-conflict' });

    await expect(
      service.assignDepartment(context, doctorId, { departmentId }, actor),
    ).rejects.toBeInstanceOf(DoctorAssignmentConflictError);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});
