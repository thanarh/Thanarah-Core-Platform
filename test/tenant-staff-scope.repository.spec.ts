import {
  BranchStatus,
  FacilityStatus,
  StaffStatus,
  TenantMembershipStatus,
  TenantStatus,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import type {
  TenantStaffBranchAssignmentRecord,
  TenantStaffFacilityAssignmentRecord,
} from '../src/tenant/tenant-staff-scope.repository';
import { TenantStaffScopeRepository } from '../src/tenant/tenant-staff-scope.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorMembershipId = '22222222-2222-4222-8222-222222222222';
const staffId = '33333333-3333-4333-8333-333333333333';
const facilityId = '44444444-4444-4444-8444-444444444444';
const branchId = '55555555-5555-4555-8555-555555555555';
const actorUserId = '66666666-6666-4666-8666-666666666666';
const staffUserId = '77777777-7777-4777-8777-777777777777';
const assignedAt = new Date('2026-10-07T10:00:00.000Z');

const activeStaffRow = {
  id: staffId,
  userId: staffUserId,
  staffStatus: StaffStatus.ACTIVE,
  membershipStatus: TenantMembershipStatus.ACTIVE,
  userStatus: 'ACTIVE',
};

const facilityAssignment: TenantStaffFacilityAssignmentRecord = {
  staffId,
  facilityId,
  assignedAt,
  staff: { userId: staffUserId },
  facility: { id: facilityId, name: 'North Facility', status: FacilityStatus.ACTIVE },
};

const branchAssignment: TenantStaffBranchAssignmentRecord = {
  staffId,
  facilityId,
  branchId,
  assignedAt,
  staff: { userId: staffUserId },
  branch: { id: branchId, name: 'Central Branch', status: BranchStatus.ACTIVE },
  facility: { id: facilityId, name: 'North Facility', status: FacilityStatus.ACTIVE },
};

describe('TenantStaffScopeRepository', () => {
  const transaction = {
    $queryRaw: vi.fn(),
    tenantMembership: { findFirst: vi.fn() },
    staff: { findFirst: vi.fn() },
    facility: { findFirst: vi.fn() },
    branch: { findFirst: vi.fn() },
    staffFacilityAssignment: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    staffBranchAssignment: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(),
    staff: { findFirst: vi.fn() },
    staffFacilityAssignment: { findMany: vi.fn(), findFirst: vi.fn() },
    staffBranchAssignment: { findMany: vi.fn(), findFirst: vi.fn() },
  };
  let repository: TenantStaffScopeRepository;

  const assignmentInput = {
    tenantId,
    actorMembershipId,
    actorPlatformUserId: actorUserId,
    staffId,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([activeStaffRow])
      .mockResolvedValueOnce([{ id: facilityId, status: FacilityStatus.ACTIVE }]);
    transaction.tenantMembership.findFirst.mockResolvedValue({ id: actorMembershipId });
    transaction.staff.findFirst.mockResolvedValue({ userId: staffUserId });
    transaction.facility.findFirst.mockResolvedValue({ id: facilityId });
    transaction.branch.findFirst.mockResolvedValue({ id: branchId, facilityId });
    transaction.staffFacilityAssignment.findUnique.mockResolvedValue(null);
    transaction.staffFacilityAssignment.create.mockResolvedValue(facilityAssignment);
    transaction.staffFacilityAssignment.findMany.mockResolvedValue([facilityAssignment]);
    transaction.staffFacilityAssignment.deleteMany.mockResolvedValue({ count: 1 });
    transaction.staffBranchAssignment.findUnique.mockResolvedValue(null);
    transaction.staffBranchAssignment.create.mockResolvedValue(branchAssignment);
    transaction.staffBranchAssignment.findMany.mockResolvedValue([branchAssignment]);
    transaction.staffBranchAssignment.deleteMany.mockResolvedValue({ count: 1 });
    prisma.staff.findFirst.mockResolvedValue({ id: staffId });
    prisma.staffFacilityAssignment.findMany.mockResolvedValue([facilityAssignment]);
    prisma.staffBranchAssignment.findMany.mockResolvedValue([branchAssignment]);
    repository = new TenantStaffScopeRepository(prisma as unknown as PrismaService);
  });

  it('lists only the requested tenant/staff assignments while preserving lifecycle statuses', async () => {
    await expect(repository.listFacilitiesForStaff(tenantId, staffId)).resolves.toEqual([
      facilityAssignment,
    ]);
    await expect(repository.listBranchesForStaff(tenantId, staffId)).resolves.toEqual([
      branchAssignment,
    ]);
    expect(prisma.staff.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: staffId, tenantId, tenant: { is: { status: TenantStatus.ACTIVE } } },
      select: { id: true },
    });
    expect(prisma.staffFacilityAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, staffId } }),
    );
    expect(prisma.staffBranchAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, staffId } }),
    );
  });

  it('hides another tenant staff ID before reading assignments', async () => {
    prisma.staff.findFirst.mockResolvedValueOnce(null);

    await expect(repository.listBranchesForStaff(tenantId, staffId)).resolves.toBeNull();
    expect(prisma.staffBranchAssignment.findMany).not.toHaveBeenCalled();
  });

  it('returns multiple facility and branch assignments for one staff profile', async () => {
    const secondFacilityId = '88888888-8888-4888-8888-888888888888';
    const secondBranchId = '99999999-9999-4999-8999-999999999999';
    prisma.staffFacilityAssignment.findMany.mockResolvedValueOnce([
      facilityAssignment,
      {
        ...facilityAssignment,
        facilityId: secondFacilityId,
        facility: {
          id: secondFacilityId,
          name: 'South Facility',
          status: FacilityStatus.ACTIVE,
        },
      },
    ]);
    prisma.staffBranchAssignment.findMany.mockResolvedValueOnce([
      branchAssignment,
      {
        ...branchAssignment,
        branchId: secondBranchId,
        branch: {
          id: secondBranchId,
          name: 'South Branch',
          status: BranchStatus.ACTIVE,
        },
      },
    ]);

    await expect(repository.listFacilitiesForStaff(tenantId, staffId)).resolves.toHaveLength(2);
    await expect(repository.listBranchesForStaff(tenantId, staffId)).resolves.toHaveLength(2);
  });

  it('creates a facility assignment only after locking active tenant, actor, staff, and facility', async () => {
    await expect(repository.assignFacility({ ...assignmentInput, facilityId })).resolves.toEqual({
      kind: 'changed',
      assignment: facilityAssignment,
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(3);
    expect(transaction.tenantMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: actorMembershipId,
          tenantId,
          platformUserId: actorUserId,
          status: TenantMembershipStatus.ACTIVE,
          tenant: { is: { status: TenantStatus.ACTIVE } },
        },
      }),
    );
    expect(transaction.staffFacilityAssignment.create).toHaveBeenCalledWith({
      data: { tenantId, staffId, facilityId },
      select: expect.any(Object),
    });
  });

  it('returns an existing facility assignment idempotently without creating another row', async () => {
    transaction.staffFacilityAssignment.findUnique.mockResolvedValueOnce(facilityAssignment);

    await expect(repository.assignFacility({ ...assignmentInput, facilityId })).resolves.toEqual({
      kind: 'already-assigned',
      assignment: facilityAssignment,
    });
    expect(transaction.staffFacilityAssignment.create).not.toHaveBeenCalled();
  });

  it('does not resolve a foreign-tenant facility or permit an inactive facility', async () => {
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([activeStaffRow])
      .mockResolvedValueOnce([]);
    await expect(repository.assignFacility({ ...assignmentInput, facilityId })).resolves.toEqual({
      kind: 'not-found',
    });

    for (const status of [FacilityStatus.SUSPENDED, FacilityStatus.DEACTIVATED]) {
      transaction.$queryRaw
        .mockReset()
        .mockResolvedValueOnce([{ id: tenantId }])
        .mockResolvedValueOnce([activeStaffRow])
        .mockResolvedValueOnce([{ id: facilityId, status }]);
      await expect(repository.assignFacility({ ...assignmentInput, facilityId })).resolves.toEqual({
        kind: 'unit-ineligible',
      });
    }
    expect(transaction.staffFacilityAssignment.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      staffStatus: StaffStatus.SUSPENDED,
      membershipStatus: TenantMembershipStatus.ACTIVE,
      userStatus: 'ACTIVE',
    },
    {
      staffStatus: StaffStatus.DEACTIVATED,
      membershipStatus: TenantMembershipStatus.ACTIVE,
      userStatus: 'ACTIVE',
    },
    {
      staffStatus: StaffStatus.ACTIVE,
      membershipStatus: TenantMembershipStatus.SUSPENDED,
      userStatus: 'ACTIVE',
    },
    {
      staffStatus: StaffStatus.ACTIVE,
      membershipStatus: TenantMembershipStatus.ACTIVE,
      userStatus: 'INACTIVE',
    },
  ])('rejects inactive staff, linked membership, or user', async (staffRow) => {
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([{ ...activeStaffRow, ...staffRow }]);

    await expect(repository.assignFacility({ ...assignmentInput, facilityId })).resolves.toEqual({
      kind: 'staff-ineligible',
    });
    expect(transaction.staffFacilityAssignment.create).not.toHaveBeenCalled();
  });

  it('rejects a staff ID that does not exist in the trusted tenant for either assignment type', async () => {
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([]);
    await expect(repository.assignFacility({ ...assignmentInput, facilityId })).resolves.toEqual({
      kind: 'not-found',
    });

    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([]);
    await expect(repository.assignBranch({ ...assignmentInput, branchId })).resolves.toEqual({
      kind: 'not-found',
    });
    expect(transaction.staffFacilityAssignment.create).not.toHaveBeenCalled();
    expect(transaction.staffBranchAssignment.create).not.toHaveBeenCalled();
  });

  it.each([StaffStatus.SUSPENDED, StaffStatus.DEACTIVATED])(
    'rejects %s staff when assigning a branch',
    async (staffStatus) => {
      transaction.$queryRaw
        .mockReset()
        .mockResolvedValueOnce([{ id: tenantId }])
        .mockResolvedValueOnce([{ ...activeStaffRow, staffStatus }]);

      await expect(repository.assignBranch({ ...assignmentInput, branchId })).resolves.toEqual({
        kind: 'staff-ineligible',
      });
      expect(transaction.staffBranchAssignment.create).not.toHaveBeenCalled();
    },
  );

  it('derives a branch assignment parent facility from the branch row', async () => {
    const actualFacilityId = '88888888-8888-4888-8888-888888888888';
    const expectedAssignment = {
      ...branchAssignment,
      facilityId: actualFacilityId,
      facility: { ...branchAssignment.facility, id: actualFacilityId },
    };
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([activeStaffRow])
      .mockResolvedValueOnce([
        {
          id: branchId,
          facilityId: actualFacilityId,
          branchStatus: BranchStatus.ACTIVE,
          facilityStatus: FacilityStatus.ACTIVE,
        },
      ]);
    transaction.staffBranchAssignment.create.mockResolvedValueOnce(expectedAssignment);

    await expect(repository.assignBranch({ ...assignmentInput, branchId })).resolves.toEqual({
      kind: 'changed',
      assignment: expectedAssignment,
    });
    expect(transaction.staffBranchAssignment.create).toHaveBeenCalledWith({
      data: { tenantId, staffId, facilityId: actualFacilityId, branchId },
      select: expect.any(Object),
    });
  });

  it('rejects a foreign-tenant branch, inactive branch, or inactive parent facility', async () => {
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([activeStaffRow])
      .mockResolvedValueOnce([]);
    await expect(repository.assignBranch({ ...assignmentInput, branchId })).resolves.toEqual({
      kind: 'not-found',
    });

    const ineligibleUnits = [
      { branchStatus: BranchStatus.SUSPENDED, facilityStatus: FacilityStatus.ACTIVE },
      { branchStatus: BranchStatus.DEACTIVATED, facilityStatus: FacilityStatus.ACTIVE },
      { branchStatus: BranchStatus.ACTIVE, facilityStatus: FacilityStatus.SUSPENDED },
      { branchStatus: BranchStatus.ACTIVE, facilityStatus: FacilityStatus.DEACTIVATED },
    ];
    for (const { branchStatus, facilityStatus } of ineligibleUnits) {
      transaction.$queryRaw
        .mockReset()
        .mockResolvedValueOnce([{ id: tenantId }])
        .mockResolvedValueOnce([activeStaffRow])
        .mockResolvedValueOnce([
          {
            id: branchId,
            facilityId,
            branchStatus,
            facilityStatus,
          },
        ]);
      await expect(repository.assignBranch({ ...assignmentInput, branchId })).resolves.toEqual({
        kind: 'unit-ineligible',
      });
    }
    expect(transaction.staffBranchAssignment.create).not.toHaveBeenCalled();
  });

  it('returns a repeated branch assignment idempotently', async () => {
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: tenantId }])
      .mockResolvedValueOnce([activeStaffRow])
      .mockResolvedValueOnce([
        {
          id: branchId,
          facilityId,
          branchStatus: BranchStatus.ACTIVE,
          facilityStatus: FacilityStatus.ACTIVE,
        },
      ]);
    transaction.staffBranchAssignment.findUnique.mockResolvedValueOnce(branchAssignment);

    await expect(repository.assignBranch({ ...assignmentInput, branchId })).resolves.toEqual({
      kind: 'already-assigned',
      assignment: branchAssignment,
    });
    expect(transaction.staffBranchAssignment.create).not.toHaveBeenCalled();
  });

  it('removes only the selected facility assignment and returns the staff user for auditing', async () => {
    await expect(repository.removeFacility({ ...assignmentInput, facilityId })).resolves.toEqual({
      kind: 'changed',
      userId: staffUserId,
    });
    expect(transaction.staffFacilityAssignment.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, staffId, facilityId },
    });
  });

  it('removes the branch assignment using its actual facility parent', async () => {
    await expect(repository.removeBranch({ ...assignmentInput, branchId })).resolves.toEqual({
      kind: 'changed',
      userId: staffUserId,
    });
    expect(transaction.branch.findFirst).toHaveBeenCalledWith({
      where: { id: branchId, facility: { is: { tenantId } } },
      select: { id: true, facilityId: true },
    });
    expect(transaction.staffBranchAssignment.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, staffId, branchId, facilityId },
    });
  });

  it('does not remove a cross-tenant or missing assignment', async () => {
    transaction.$queryRaw.mockReset().mockResolvedValue([{ id: tenantId }]);

    transaction.staff.findFirst.mockResolvedValueOnce(null);
    await expect(repository.removeFacility({ ...assignmentInput, facilityId })).resolves.toEqual({
      kind: 'not-found',
    });

    transaction.facility.findFirst.mockResolvedValueOnce(null);
    await expect(repository.removeFacility({ ...assignmentInput, facilityId })).resolves.toEqual({
      kind: 'not-found',
    });
    expect(transaction.staffFacilityAssignment.deleteMany).not.toHaveBeenCalled();

    transaction.staffFacilityAssignment.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(repository.removeFacility({ ...assignmentInput, facilityId })).resolves.toEqual({
      kind: 'not-assigned',
    });

    transaction.branch.findFirst.mockResolvedValueOnce(null);
    await expect(repository.removeBranch({ ...assignmentInput, branchId })).resolves.toEqual({
      kind: 'not-found',
    });
    expect(transaction.staffBranchAssignment.deleteMany).not.toHaveBeenCalled();
  });

  it('resolves only active facility and branch scope and clears scope for inactive staff', async () => {
    prisma.staff.findFirst.mockResolvedValueOnce({
      status: StaffStatus.ACTIVE,
      membership: {
        status: TenantMembershipStatus.ACTIVE,
        platformUser: { status: 'ACTIVE' },
      },
      facilityAssignments: [
        {
          facility: {
            id: facilityId,
            name: 'Active Facility',
            status: FacilityStatus.ACTIVE,
            tenant: { status: TenantStatus.ACTIVE },
          },
        },
        {
          facility: {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            name: 'Suspended Facility',
            status: FacilityStatus.SUSPENDED,
            tenant: { status: TenantStatus.ACTIVE },
          },
        },
        {
          facility: {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            name: 'Deactivated Facility',
            status: FacilityStatus.DEACTIVATED,
            tenant: { status: TenantStatus.ACTIVE },
          },
        },
      ],
      branchAssignments: [
        {
          branch: { id: branchId, name: 'Active Branch', status: BranchStatus.ACTIVE },
          facility: {
            id: facilityId,
            name: 'Active Facility',
            status: FacilityStatus.ACTIVE,
            tenant: { status: TenantStatus.ACTIVE },
          },
        },
        {
          branch: {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            name: 'Deactivated Branch',
            status: BranchStatus.DEACTIVATED,
          },
          facility: {
            id: facilityId,
            name: 'Active Facility',
            status: FacilityStatus.ACTIVE,
            tenant: { status: TenantStatus.ACTIVE },
          },
        },
        {
          branch: {
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            name: 'Suspended Branch',
            status: BranchStatus.SUSPENDED,
          },
          facility: {
            id: facilityId,
            name: 'Active Facility',
            status: FacilityStatus.ACTIVE,
            tenant: { status: TenantStatus.ACTIVE },
          },
        },
        {
          branch: {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            name: 'Branch Under Suspended Facility',
            status: BranchStatus.ACTIVE,
          },
          facility: {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            name: 'Suspended Facility',
            status: FacilityStatus.SUSPENDED,
            tenant: { status: TenantStatus.ACTIVE },
          },
        },
        {
          branch: {
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            name: 'Branch Under Deactivated Facility',
            status: BranchStatus.ACTIVE,
          },
          facility: {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            name: 'Deactivated Facility',
            status: FacilityStatus.DEACTIVATED,
            tenant: { status: TenantStatus.ACTIVE },
          },
        },
      ],
    });

    await expect(repository.resolveEffectiveScope(tenantId, staffId)).resolves.toEqual({
      facilities: [{ id: facilityId, name: 'Active Facility' }],
      branches: [
        {
          id: branchId,
          name: 'Active Branch',
          facilityId,
          facilityName: 'Active Facility',
        },
      ],
    });

    for (const inactiveStaffStatus of [StaffStatus.SUSPENDED, StaffStatus.DEACTIVATED]) {
      prisma.staff.findFirst.mockResolvedValueOnce({
        status: inactiveStaffStatus,
        membership: {
          status: TenantMembershipStatus.ACTIVE,
          platformUser: { status: 'ACTIVE' },
        },
        facilityAssignments: [{ facility: facilityAssignment.facility }],
        branchAssignments: [
          { branch: branchAssignment.branch, facility: branchAssignment.facility },
        ],
      });
      await expect(repository.resolveEffectiveScope(tenantId, staffId)).resolves.toEqual({
        facilities: [],
        branches: [],
      });
    }
  });
});
