import { PlatformAuditEventType, StaffStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import {
  TenantStaffLifecycleConflictError,
  TenantStaffMembershipNotEligibleError,
  TenantStaffNotFoundError,
} from '../src/tenant/tenant-staff.errors';
import { TenantStaffService } from '../src/tenant/tenant-staff.service';
import type { TenantStaffRecord } from '../src/tenant/tenant-staff.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorUserId = '22222222-2222-4222-8222-222222222222';
const actorMembershipId = '33333333-3333-4333-8333-333333333333';
const targetMembershipId = '44444444-4444-4444-8444-444444444444';
const targetUserId = '55555555-5555-4555-8555-555555555555';
const staffId = '66666666-6666-4666-8666-666666666666';
const fixedTime = new Date('2026-10-06T10:00:00.000Z');

const context = {
  tenantId,
  membershipId: actorMembershipId,
  platformUserId: actorUserId,
} as TrustedTenantContext;

const actor: AuthenticatedPlatformUser = {
  userId: actorUserId,
  sessionId: '77777777-7777-4777-8777-777777777777',
  tokenVersion: 1,
  platformRoleIds: [],
};

const record = (status = StaffStatus.ACTIVE): TenantStaffRecord => ({
  id: staffId,
  tenantId,
  userId: targetUserId,
  membershipId: targetMembershipId,
  displayName: 'Taylor Member',
  jobTitle: null,
  status,
  statusChangedAt: fixedTime,
  suspendedAt: status === StaffStatus.SUSPENDED ? fixedTime : null,
  deactivatedAt: status === StaffStatus.DEACTIVATED ? fixedTime : null,
  createdAt: fixedTime,
  updatedAt: fixedTime,
});

describe('TenantStaffService', () => {
  const repository = {
    createForActiveMembership: vi.fn(),
    listForTenant: vi.fn(),
    findByIdForTenant: vi.fn(),
    updateForTenant: vi.fn(),
    changeStatusIfCurrentForTenant: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  let service: TenantStaffService;

  beforeEach(() => {
    vi.clearAllMocks();
    audit.recordAudit.mockResolvedValue(undefined);
    repository.createForActiveMembership.mockResolvedValue({
      kind: 'created',
      staff: record(),
    });
    repository.listForTenant.mockResolvedValue([record()]);
    repository.findByIdForTenant.mockResolvedValue(record());
    repository.updateForTenant.mockResolvedValue(record());
    repository.changeStatusIfCurrentForTenant.mockResolvedValue(record(StaffStatus.SUSPENDED));
    service = new TenantStaffService(repository as never, audit as never);
  });

  it('creates a profile using the trusted tenant and only the selected membership', async () => {
    const response = await service.create(context, { membershipId: targetMembershipId }, actor);

    expect(repository.createForActiveMembership).toHaveBeenCalledWith(
      tenantId,
      targetMembershipId,
      {},
    );
    expect(response).toMatchObject({
      id: staffId,
      membershipId: targetMembershipId,
      displayName: 'Taylor Member',
    });
    expect(response).not.toHaveProperty('tenantId');
    expect(response).not.toHaveProperty('userId');
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.STAFF_CREATED,
        actorUserId,
        subjectUserId: targetUserId,
        subjectTenantId: tenantId,
      }),
    );
  });

  it('rejects a client-supplied tenant or user identity field', async () => {
    await expect(
      service.create(
        context,
        {
          membershipId: targetMembershipId,
          tenantId: '99999999-9999-4999-8999-999999999999',
          userId: targetUserId,
        } as never,
        actor,
      ),
    ).rejects.toThrow();
    expect(repository.createForActiveMembership).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('does not audit a membership that is missing, inactive, or belongs to another tenant', async () => {
    repository.createForActiveMembership.mockResolvedValueOnce({
      kind: 'membership-ineligible',
    });

    await expect(
      service.create(context, { membershipId: targetMembershipId }, actor),
    ).rejects.toBeInstanceOf(TenantStaffMembershipNotEligibleError);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('scopes staff list requests to the trusted tenant and applies validated filters', async () => {
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
    expect(response.limit).toBe(10);
    expect(response.offset).toBe(5);
  });

  it('updates only descriptive fields and records the change', async () => {
    repository.updateForTenant.mockResolvedValueOnce({
      ...record(),
      displayName: 'Taylor Updated',
      jobTitle: 'Coordinator',
    });

    const response = await service.update(
      context,
      staffId,
      { displayName: 'Taylor Updated', jobTitle: 'Coordinator' },
      actor,
    );

    expect(repository.updateForTenant).toHaveBeenCalledWith(tenantId, staffId, {
      displayName: 'Taylor Updated',
      jobTitle: 'Coordinator',
    });
    expect(response.displayName).toBe('Taylor Updated');
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.STAFF_UPDATED,
        subjectUserId: targetUserId,
        metadata: expect.objectContaining({ changedFields: 'displayName,jobTitle' }),
      }),
    );
  });

  it('hides staff profiles outside the trusted tenant', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(null);

    await expect(service.findById(context, staffId)).rejects.toBeInstanceOf(
      TenantStaffNotFoundError,
    );
    expect(repository.findByIdForTenant).toHaveBeenCalledWith(tenantId, staffId);
  });

  it('allows ACTIVE to SUSPENDED and audits the transition', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(record(StaffStatus.ACTIVE));
    repository.changeStatusIfCurrentForTenant.mockResolvedValueOnce(record(StaffStatus.SUSPENDED));

    await service.suspend(context, staffId, actor);

    expect(repository.changeStatusIfCurrentForTenant).toHaveBeenCalledWith(
      tenantId,
      staffId,
      StaffStatus.ACTIVE,
      StaffStatus.SUSPENDED,
      expect.any(Date),
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.STAFF_SUSPENDED,
        metadata: expect.objectContaining({
          fromStatus: StaffStatus.ACTIVE,
          toStatus: StaffStatus.SUSPENDED,
        }),
      }),
    );
  });

  it('treats a repeated same-state request as idempotent without another audit', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(record(StaffStatus.SUSPENDED));

    const response = await service.suspend(context, staffId, actor);

    expect(response.status).toBe(StaffStatus.SUSPENDED);
    expect(repository.changeStatusIfCurrentForTenant).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('keeps DEACTIVATED terminal', async () => {
    repository.findByIdForTenant.mockResolvedValueOnce(record(StaffStatus.DEACTIVATED));

    await expect(service.activate(context, staffId, actor)).rejects.toBeInstanceOf(
      TenantStaffLifecycleConflictError,
    );
    expect(repository.changeStatusIfCurrentForTenant).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});
