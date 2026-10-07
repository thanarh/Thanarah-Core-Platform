import { BranchStatus, FacilityStatus, PlatformAuditEventType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import {
  TenantStaffScopeConflictError,
  TenantStaffScopeInputValidationError,
  TenantStaffScopeNotFoundError,
} from '../src/tenant/tenant-staff-scope.errors';
import type {
  TenantStaffBranchAssignmentRecord,
  TenantStaffEffectiveScope,
  TenantStaffFacilityAssignmentRecord,
  TenantStaffScopeRepository,
} from '../src/tenant/tenant-staff-scope.repository';
import { TenantStaffScopeService } from '../src/tenant/tenant-staff-scope.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorMembershipId = '22222222-2222-4222-8222-222222222222';
const staffId = '33333333-3333-4333-8333-333333333333';
const facilityId = '44444444-4444-4444-8444-444444444444';
const branchId = '55555555-5555-4555-8555-555555555555';
const actorUserId = '66666666-6666-4666-8666-666666666666';
const staffUserId = '77777777-7777-4777-8777-777777777777';
const assignedAt = new Date('2026-10-07T10:00:00.000Z');

const context = {
  tenantId,
  membershipId: actorMembershipId,
  platformUserId: actorUserId,
} as unknown as TrustedTenantContext;

const actor: AuthenticatedPlatformUser = {
  userId: actorUserId,
  sessionId: '88888888-8888-4888-8888-888888888888',
  tokenVersion: 1,
  platformRoleIds: [],
};

const facilityRecord: TenantStaffFacilityAssignmentRecord = {
  staffId,
  facilityId,
  assignedAt,
  staff: { userId: staffUserId },
  facility: {
    id: facilityId,
    name: 'North Facility',
    status: FacilityStatus.ACTIVE,
  },
};

const branchRecord: TenantStaffBranchAssignmentRecord = {
  staffId,
  facilityId,
  branchId,
  assignedAt,
  staff: { userId: staffUserId },
  branch: { id: branchId, name: 'Central Branch', status: BranchStatus.ACTIVE },
  facility: { id: facilityId, name: 'North Facility', status: FacilityStatus.ACTIVE },
};

describe('TenantStaffScopeService', () => {
  const assignments = {
    listFacilitiesForStaff: vi.fn(),
    listBranchesForStaff: vi.fn(),
    assignFacility: vi.fn(),
    removeFacility: vi.fn(),
    assignBranch: vi.fn(),
    removeBranch: vi.fn(),
    resolveEffectiveScope: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  let service: TenantStaffScopeService;

  beforeEach(() => {
    vi.clearAllMocks();
    assignments.listFacilitiesForStaff.mockResolvedValue([facilityRecord]);
    assignments.listBranchesForStaff.mockResolvedValue([branchRecord]);
    assignments.assignFacility.mockResolvedValue({ kind: 'changed', assignment: facilityRecord });
    assignments.removeFacility.mockResolvedValue({ kind: 'changed', userId: staffUserId });
    assignments.assignBranch.mockResolvedValue({ kind: 'changed', assignment: branchRecord });
    assignments.removeBranch.mockResolvedValue({ kind: 'changed', userId: staffUserId });
    assignments.resolveEffectiveScope.mockResolvedValue({
      facilities: [{ id: facilityId, name: 'North Facility' }],
      branches: [
        {
          id: branchId,
          name: 'Central Branch',
          facilityId,
          facilityName: 'North Facility',
        },
      ],
    } satisfies TenantStaffEffectiveScope);
    audit.recordAudit.mockResolvedValue(undefined);
    service = new TenantStaffScopeService(
      assignments as unknown as TenantStaffScopeRepository,
      audit as unknown as PlatformAuditService,
    );
  });

  it('lists facility and branch assignments as safe, tenant-scoped response models', async () => {
    await expect(service.listFacilities(context, staffId)).resolves.toEqual({
      items: [
        {
          staffId,
          facilityId,
          facilityName: 'North Facility',
          facilityStatus: FacilityStatus.ACTIVE,
          assignedAt,
        },
      ],
    });
    await expect(service.listBranches(context, staffId)).resolves.toEqual({
      items: [
        {
          staffId,
          branchId,
          branchName: 'Central Branch',
          branchStatus: BranchStatus.ACTIVE,
          facility: {
            id: facilityId,
            name: 'North Facility',
            status: FacilityStatus.ACTIVE,
          },
          assignedAt,
        },
      ],
    });
    expect(assignments.listFacilitiesForStaff).toHaveBeenCalledWith(tenantId, staffId);
    expect(assignments.listBranchesForStaff).toHaveBeenCalledWith(tenantId, staffId);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('audits a facility assignment with the trusted tenant, staff, unit, and actor', async () => {
    await expect(
      service.assignFacility(context, staffId, { facilityId }, actor),
    ).resolves.toMatchObject({ staffId, facilityId });
    expect(assignments.assignFacility).toHaveBeenCalledWith({
      tenantId,
      actorMembershipId,
      actorPlatformUserId: actorUserId,
      staffId,
      facilityId,
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.STAFF_FACILITY_ASSIGNED,
        actorUserId,
        subjectUserId: staffUserId,
        subjectTenantId: tenantId,
        metadata: { staffId, facilityId, result: 'assigned' },
      }),
    );
  });

  it('treats a repeated facility assignment as idempotent without a second audit', async () => {
    assignments.assignFacility.mockResolvedValueOnce({
      kind: 'already-assigned',
      assignment: facilityRecord,
    });
    await expect(
      service.assignFacility(context, staffId, { facilityId }, actor),
    ).resolves.toMatchObject({ facilityId });
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('derives and audits the branch parent without creating a separate facility assignment', async () => {
    await expect(
      service.assignBranch(context, staffId, { branchId }, actor),
    ).resolves.toMatchObject({
      branchId,
      facility: { id: facilityId, name: 'North Facility' },
    });
    expect(assignments.assignBranch).toHaveBeenCalledWith({
      tenantId,
      actorMembershipId,
      actorPlatformUserId: actorUserId,
      staffId,
      branchId,
    });
    expect(assignments.assignFacility).not.toHaveBeenCalled();
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.STAFF_BRANCH_ASSIGNED,
        actorUserId,
        subjectUserId: staffUserId,
        subjectTenantId: tenantId,
        metadata: { staffId, branchId, facilityId, result: 'assigned' },
      }),
    );
  });

  it('audits removals only after the repository confirms the selected assignment was removed', async () => {
    await expect(
      service.removeFacility(context, staffId, facilityId, actor),
    ).resolves.toBeUndefined();
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.STAFF_FACILITY_UNASSIGNED,
        subjectUserId: staffUserId,
        subjectTenantId: tenantId,
        metadata: { staffId, facilityId, result: 'removed' },
      }),
    );

    audit.recordAudit.mockClear();
    await expect(service.removeBranch(context, staffId, branchId, actor)).resolves.toBeUndefined();
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.STAFF_BRANCH_UNASSIGNED,
        subjectUserId: staffUserId,
        subjectTenantId: tenantId,
        metadata: { staffId, branchId, result: 'removed' },
      }),
    );
  });

  it.each([
    ['not-found', TenantStaffScopeNotFoundError],
    ['staff-ineligible', TenantStaffScopeConflictError],
    ['unit-ineligible', TenantStaffScopeConflictError],
  ] as const)(
    'maps facility assignment result %s without a false audit',
    async (kind, ErrorType) => {
      assignments.assignFacility.mockResolvedValueOnce({ kind });
      await expect(
        service.assignFacility(context, staffId, { facilityId }, actor),
      ).rejects.toBeInstanceOf(ErrorType);
      expect(audit.recordAudit).not.toHaveBeenCalled();
    },
  );

  it('rejects client-supplied tenant or authority fields in assignment payloads', async () => {
    await expect(
      service.assignFacility(
        context,
        staffId,
        { facilityId, tenantId, permissionCodes: ['tenant.staff.scope.manage'] } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(TenantStaffScopeInputValidationError);
    await expect(
      service.assignBranch(context, staffId, { branchId, tenantId } as never, actor),
    ).rejects.toBeInstanceOf(TenantStaffScopeInputValidationError);
    expect(assignments.assignFacility).not.toHaveBeenCalled();
    expect(assignments.assignBranch).not.toHaveBeenCalled();
  });

  it('maps a missing or cross-tenant removal to not found and does not audit it', async () => {
    assignments.removeFacility.mockResolvedValueOnce({ kind: 'not-assigned' });
    await expect(
      service.removeFacility(context, staffId, facilityId, actor),
    ).rejects.toBeInstanceOf(TenantStaffScopeNotFoundError);
    assignments.removeBranch.mockResolvedValueOnce({ kind: 'not-found' });
    await expect(service.removeBranch(context, staffId, branchId, actor)).rejects.toBeInstanceOf(
      TenantStaffScopeNotFoundError,
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs and actors that do not match the trusted tenant context', async () => {
    await expect(service.listFacilities(context, 'not-a-uuid')).rejects.toBeInstanceOf(
      TenantStaffScopeInputValidationError,
    );
    await expect(
      service.assignFacility(context, staffId, { facilityId }, { ...actor, userId: staffUserId }),
    ).rejects.toMatchObject({ status: 403 });
    expect(assignments.listFacilitiesForStaff).not.toHaveBeenCalled();
    expect(assignments.assignFacility).not.toHaveBeenCalled();
  });

  it('exposes lifecycle-filtered effective scope only through the internal resolver', async () => {
    const expected: TenantStaffEffectiveScope = {
      facilities: [{ id: facilityId, name: 'North Facility' }],
      branches: [
        {
          id: branchId,
          name: 'Central Branch',
          facilityId,
          facilityName: 'North Facility',
        },
      ],
    };
    await expect(service.resolveEffectiveScope(context, staffId)).resolves.toEqual(expected);
    expect(assignments.resolveEffectiveScope).toHaveBeenCalledWith(tenantId, staffId);
  });
});
