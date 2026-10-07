import { Prisma, StaffStatus, TenantCatalogStatus, TenantStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DoctorRepository, type DoctorRecord } from '../src/tenant/doctor.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const staffId = '22222222-2222-4222-8222-222222222222';
const doctorId = '33333333-3333-4333-8333-333333333333';
const departmentId = '44444444-4444-4444-8444-444444444444';
const specialtyId = '55555555-5555-4555-8555-555555555555';
const changedAt = new Date('2026-10-07T11:00:00.000Z');

const doctorRecord = {
  id: doctorId,
  tenantId,
  staffId,
  professionalDisplayName: null,
  professionalTitle: null,
  professionalCode: null,
  bio: null,
  status: StaffStatus.ACTIVE,
  statusChangedAt: changedAt,
  suspendedAt: null,
  deactivatedAt: null,
  createdAt: changedAt,
  updatedAt: changedAt,
  tenant: { status: TenantStatus.ACTIVE },
  staff: {
    id: staffId,
    userId: '66666666-6666-4666-8666-666666666666',
    displayName: 'Taylor Member',
    status: StaffStatus.ACTIVE,
  },
  departmentAssignments: [],
  specialtyAssignments: [],
} as DoctorRecord;

function duplicateKeyError(target?: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
    ...(target ? { meta: { target } } : {}),
  });
}

describe('DoctorRepository', () => {
  const transaction = {
    $queryRaw: vi.fn(),
    doctor: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    doctorDepartmentAssignment: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    doctorSpecialtyAssignment: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    doctor: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  let repository: DoctorRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    transaction.$queryRaw.mockResolvedValue([{ id: tenantId }]);
    transaction.doctor.create.mockResolvedValue(doctorRecord);
    transaction.doctor.findFirst.mockResolvedValue(doctorRecord);
    transaction.doctor.updateMany.mockResolvedValue({ count: 1 });
    transaction.doctorDepartmentAssignment.create.mockResolvedValue({});
    transaction.doctorDepartmentAssignment.deleteMany.mockResolvedValue({ count: 1 });
    transaction.doctorSpecialtyAssignment.create.mockResolvedValue({});
    transaction.doctorSpecialtyAssignment.deleteMany.mockResolvedValue({ count: 1 });
    prisma.doctor.findMany.mockResolvedValue([doctorRecord]);
    prisma.doctor.findFirst.mockResolvedValue(doctorRecord);
    repository = new DoctorRepository(prisma as never);
  });

  it('locks the active tenant and verifies same-tenant active Staff and membership before creation', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]).mockResolvedValueOnce([
      {
        id: staffId,
        userId: doctorRecord.staff.userId,
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        userStatus: 'ACTIVE',
      },
    ]);

    const result = await repository.create(tenantId, { staffId });

    expect(result).toEqual({ kind: 'created', doctor: doctorRecord });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.doctor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          staffId,
          professionalDisplayName: null,
          professionalTitle: null,
          professionalCode: null,
          bio: null,
        }),
      }),
    );
    expect(transaction.doctor.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user: expect.anything(), membership: expect.anything() }),
      }),
    );
  });

  it('persists professional fields and reports tenant-unique code conflicts on create', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]).mockResolvedValueOnce([
      {
        id: staffId,
        userId: doctorRecord.staff.userId,
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        userStatus: 'ACTIVE',
      },
    ]);
    await repository.create(tenantId, {
      staffId,
      professionalDisplayName: 'Dr Taylor',
      professionalTitle: 'Consultant',
      professionalCode: 'MD-100',
      bio: 'Professional biography',
    });
    expect(transaction.doctor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          staffId,
          professionalDisplayName: 'Dr Taylor',
          professionalTitle: 'Consultant',
          professionalCode: 'MD-100',
          bio: 'Professional biography',
        }),
      }),
    );

    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]).mockResolvedValueOnce([
      {
        id: staffId,
        userId: doctorRecord.staff.userId,
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        userStatus: 'ACTIVE',
      },
    ]);
    transaction.doctor.create.mockRejectedValueOnce(
      duplicateKeyError(['tenantId', 'professionalCode']),
    );
    await expect(
      repository.create(tenantId, { staffId, professionalCode: 'MD-100' }),
    ).resolves.toEqual({ kind: 'professional-code-conflict' });
  });

  it('does not create a Doctor when the tenant is inactive', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([]);

    await expect(repository.create(tenantId, { staffId })).resolves.toEqual({
      kind: 'tenant-inactive',
    });
    expect(transaction.doctor.create).not.toHaveBeenCalled();
  });

  it('rejects missing, cross-tenant, suspended, deactivated, or membership-invalid Staff profiles', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]).mockResolvedValueOnce([]);
    await expect(repository.create(tenantId, { staffId })).resolves.toEqual({
      kind: 'staff-not-found',
    });
    const scopedStaffQuery = transaction.$queryRaw.mock.calls[1][0] as Prisma.Sql;
    expect(scopedStaffQuery.sql).toContain('`staff`.`tenantId`');
    expect(scopedStaffQuery.sql).toContain('LEFT JOIN `TenantMembership`');
    expect(scopedStaffQuery.sql).toContain('LEFT JOIN `User`');
    expect(scopedStaffQuery.values).toContain(tenantId);

    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]).mockResolvedValueOnce([
      {
        id: staffId,
        userId: doctorRecord.staff.userId,
        status: 'SUSPENDED',
        membershipStatus: 'ACTIVE',
        userStatus: 'ACTIVE',
      },
    ]);
    await expect(repository.create(tenantId, { staffId })).resolves.toEqual({
      kind: 'staff-ineligible',
    });

    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]).mockResolvedValueOnce([
      {
        id: staffId,
        userId: doctorRecord.staff.userId,
        status: 'DEACTIVATED',
        membershipStatus: 'ACTIVE',
        userStatus: 'ACTIVE',
      },
    ]);
    await expect(repository.create(tenantId, { staffId })).resolves.toEqual({
      kind: 'staff-ineligible',
    });

    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]).mockResolvedValueOnce([
      {
        id: staffId,
        userId: doctorRecord.staff.userId,
        status: 'ACTIVE',
        membershipStatus: 'REMOVED',
        userStatus: 'ACTIVE',
      },
    ]);
    await expect(repository.create(tenantId, { staffId })).resolves.toEqual({
      kind: 'staff-ineligible',
    });

    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]).mockResolvedValueOnce([
      {
        id: staffId,
        userId: doctorRecord.staff.userId,
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        userStatus: 'SUSPENDED',
      },
    ]);
    await expect(repository.create(tenantId, { staffId })).resolves.toEqual({
      kind: 'staff-ineligible',
    });
    expect(transaction.doctor.create).not.toHaveBeenCalled();
  });

  it('maps a unique Staff/tenant Doctor constraint to an already-exists result', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]).mockResolvedValueOnce([
      {
        id: staffId,
        userId: doctorRecord.staff.userId,
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        userStatus: 'ACTIVE',
      },
    ]);
    transaction.doctor.create.mockRejectedValueOnce(duplicateKeyError());

    await expect(repository.create(tenantId, { staffId })).resolves.toEqual({
      kind: 'already-exists',
    });
  });

  it('requires all supplied Department and Specialty IDs to be active and tenant-owned', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([
        {
          id: staffId,
          userId: doctorRecord.staff.userId,
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          userStatus: 'ACTIVE',
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(
      repository.create(tenantId, { staffId, departmentIds: [departmentId] }),
    ).resolves.toEqual({ kind: 'assignment-target-not-found' });
    expect(transaction.doctor.create).not.toHaveBeenCalled();
    const catalogQuery = transaction.$queryRaw.mock.calls[2][0] as Prisma.Sql;
    expect(catalogQuery.sql).toContain('FROM `Department`');
    expect(catalogQuery.sql).toContain('`tenantId`');
    expect(catalogQuery.sql).toContain('`status`');
    expect(catalogQuery.values).toContain(TenantCatalogStatus.ACTIVE);

    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([
        {
          id: staffId,
          userId: doctorRecord.staff.userId,
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          userStatus: 'ACTIVE',
        },
      ])
      .mockResolvedValueOnce([{ id: departmentId }])
      .mockResolvedValueOnce([{ id: specialtyId }]);
    await repository.create(tenantId, {
      staffId,
      departmentIds: [departmentId],
      specialtyIds: [specialtyId],
    });
    expect(transaction.doctor.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          departmentAssignments: {
            create: [
              {
                department: {
                  connect: { id_tenantId: { id: departmentId, tenantId } },
                },
              },
            ],
          },
          specialtyAssignments: {
            create: [
              {
                specialty: {
                  connect: { id_tenantId: { id: specialtyId, tenantId } },
                },
              },
            ],
          },
        }),
      }),
    );

    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([
        {
          id: staffId,
          userId: doctorRecord.staff.userId,
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          userStatus: 'ACTIVE',
        },
      ])
      .mockResolvedValueOnce([{ id: departmentId }])
      .mockResolvedValueOnce([]);
    await expect(
      repository.create(tenantId, {
        staffId,
        departmentIds: [departmentId],
        specialtyIds: [specialtyId],
      }),
    ).resolves.toEqual({ kind: 'assignment-target-not-found' });
    const specialtyQuery = transaction.$queryRaw.mock.calls[
      transaction.$queryRaw.mock.calls.length - 1
    ][0] as Prisma.Sql;
    expect(specialtyQuery.sql).toContain('FROM `Specialty`');
    expect(specialtyQuery.sql).toContain('`tenantId`');
    expect(specialtyQuery.sql).toContain('`status`');
    expect(specialtyQuery.values).toContain(TenantCatalogStatus.ACTIVE);
  });

  it('scopes Doctor listing and lookups to the trusted tenant', async () => {
    await repository.listForTenant(tenantId, {
      status: StaffStatus.ACTIVE,
      limit: 10,
      offset: 20,
    });
    expect(prisma.doctor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          status: StaffStatus.ACTIVE,
          tenant: { is: { status: TenantStatus.ACTIVE } },
        }),
        skip: 20,
        take: 10,
      }),
    );

    await repository.findByIdForTenant(tenantId, doctorId);
    expect(prisma.doctor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: doctorId } }),
    );
  });

  it('uses compare-and-set lifecycle updates and retains assignment history', async () => {
    const result = await repository.changeStatusIfCurrent(
      tenantId,
      doctorId,
      StaffStatus.ACTIVE,
      StaffStatus.SUSPENDED,
      changedAt,
    );

    expect(result).toEqual({ kind: 'changed', doctor: doctorRecord });
    expect(transaction.doctor.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, id: doctorId, status: StaffStatus.ACTIVE },
        data: expect.objectContaining({
          status: StaffStatus.SUSPENDED,
          suspendedAt: changedAt,
          statusChangedAt: changedAt,
        }),
      }),
    );
  });

  it('updates only supplied professional fields within the trusted tenant', async () => {
    const result = await repository.updateForTenant(tenantId, doctorId, {
      professionalTitle: 'Consultant',
    });

    expect(result).toEqual({ kind: 'changed', doctor: doctorRecord });
    expect(transaction.doctor.updateMany).toHaveBeenCalledWith({
      where: { tenantId, id: doctorId },
      data: { professionalTitle: 'Consultant' },
    });
  });

  it('maps a duplicate tenant-scoped professional code during profile update', async () => {
    transaction.doctor.updateMany.mockRejectedValueOnce(
      duplicateKeyError(['tenantId', 'professionalCode']),
    );

    await expect(
      repository.updateForTenant(tenantId, doctorId, { professionalCode: 'MD-100' }),
    ).resolves.toEqual({ kind: 'professional-code-conflict' });
    expect(transaction.doctor.updateMany).toHaveBeenCalledWith({
      where: { tenantId, id: doctorId },
      data: { professionalCode: 'MD-100' },
    });
  });

  it('rejects duplicate Department assignments and hides cross-tenant/inactive targets', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([{ id: doctorId, status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ id: departmentId }]);
    transaction.doctorDepartmentAssignment.create.mockRejectedValueOnce(duplicateKeyError());

    await expect(repository.assignDepartment(tenantId, doctorId, departmentId)).resolves.toEqual({
      kind: 'assignment-conflict',
    });

    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([{ id: doctorId, status: 'ACTIVE' }])
      .mockResolvedValueOnce([]);
    await expect(repository.assignDepartment(tenantId, doctorId, departmentId)).resolves.toEqual({
      kind: 'assignment-target-not-found',
    });
    const departmentQuery = transaction.$queryRaw.mock.calls[
      transaction.$queryRaw.mock.calls.length - 1
    ][0] as Prisma.Sql;
    expect(departmentQuery.sql).toContain('FROM `Department`');
    expect(departmentQuery.sql).toContain('`tenantId`');
    expect(departmentQuery.sql).toContain('`status`');
    expect(departmentQuery.values).toContain(TenantCatalogStatus.ACTIVE);
  });

  it('creates valid active same-tenant Department and Specialty assignments', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([{ id: doctorId, status: StaffStatus.ACTIVE }])
      .mockResolvedValueOnce([{ id: departmentId }]);
    const department = await repository.assignDepartment(tenantId, doctorId, departmentId);
    expect(department).toEqual({ kind: 'changed', doctor: doctorRecord });
    expect(transaction.doctorDepartmentAssignment.create).toHaveBeenCalledWith({
      data: { tenantId, doctorId, departmentId },
    });

    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([{ id: doctorId, status: StaffStatus.ACTIVE }])
      .mockResolvedValueOnce([{ id: specialtyId }]);
    const specialty = await repository.assignSpecialty(tenantId, doctorId, specialtyId);
    expect(specialty).toEqual({ kind: 'changed', doctor: doctorRecord });
    expect(transaction.doctorSpecialtyAssignment.create).toHaveBeenCalledWith({
      data: { tenantId, doctorId, specialtyId },
    });
  });

  it('rejects duplicate or inactive/cross-tenant Specialty assignments', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([{ id: doctorId, status: StaffStatus.ACTIVE }])
      .mockResolvedValueOnce([{ id: specialtyId }]);
    transaction.doctorSpecialtyAssignment.create.mockRejectedValueOnce(duplicateKeyError());
    await expect(repository.assignSpecialty(tenantId, doctorId, specialtyId)).resolves.toEqual({
      kind: 'assignment-conflict',
    });

    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([{ id: doctorId, status: StaffStatus.ACTIVE }])
      .mockResolvedValueOnce([]);
    await expect(repository.assignSpecialty(tenantId, doctorId, specialtyId)).resolves.toEqual({
      kind: 'assignment-target-not-found',
    });
    const specialtyQuery = transaction.$queryRaw.mock.calls[
      transaction.$queryRaw.mock.calls.length - 1
    ][0] as Prisma.Sql;
    expect(specialtyQuery.sql).toContain('FROM `Specialty`');
    expect(specialtyQuery.values).toContain(tenantId);
    expect(specialtyQuery.values).toContain(TenantCatalogStatus.ACTIVE);
  });

  it('prevents new assignments to a deactivated Doctor but allows removing an inactive Specialty link', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([{ id: doctorId, status: StaffStatus.DEACTIVATED }]);
    await expect(repository.assignSpecialty(tenantId, doctorId, specialtyId)).resolves.toEqual({
      kind: 'doctor-deactivated',
    });
    expect(transaction.doctorSpecialtyAssignment.create).not.toHaveBeenCalled();

    transaction.doctor.findFirst.mockResolvedValueOnce({
      ...doctorRecord,
      specialtyAssignments: [
        {
          createdAt: changedAt,
          specialty: {
            id: specialtyId,
            name: 'Interventional Cardiology',
            status: TenantCatalogStatus.DEACTIVATED,
          },
        },
      ],
    } as DoctorRecord);
    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]);
    const removal = await repository.unassignSpecialty(tenantId, doctorId, specialtyId);
    expect(removal).toMatchObject({
      kind: 'changed',
      doctor: {
        specialtyAssignments: [
          { specialty: { id: specialtyId, status: TenantCatalogStatus.DEACTIVATED } },
        ],
      },
    });
    expect(transaction.doctorSpecialtyAssignment.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, doctorId, specialtyId },
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('keeps inactive Department assignments visible and removable', async () => {
    transaction.doctor.findFirst.mockResolvedValueOnce({
      ...doctorRecord,
      departmentAssignments: [
        {
          createdAt: changedAt,
          department: {
            id: departmentId,
            name: 'Cardiology',
            status: TenantCatalogStatus.SUSPENDED,
          },
        },
      ],
    } as DoctorRecord);

    const removal = await repository.unassignDepartment(tenantId, doctorId, departmentId);

    expect(removal).toMatchObject({
      kind: 'changed',
      doctor: {
        departmentAssignments: [
          { department: { id: departmentId, status: TenantCatalogStatus.SUSPENDED } },
        ],
      },
    });
    expect(transaction.doctorDepartmentAssignment.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, doctorId, departmentId },
    });
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
  });

  it('returns not found when an assignment removal does not match this tenant', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ id: tenantId }]);
    transaction.doctorDepartmentAssignment.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(repository.unassignDepartment(tenantId, doctorId, departmentId)).resolves.toEqual({
      kind: 'assignment-not-found',
    });
  });
});
