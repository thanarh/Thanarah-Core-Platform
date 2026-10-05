import { FacilityStatus, PlatformAuditEventType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import {
  FacilityIdInvalidError,
  FacilityInputValidationError,
  FacilityLifecycleConflictError,
  FacilityNotFoundError,
} from '../src/tenant/facility.errors';
import type { FacilityRecord, FacilityRepository } from '../src/tenant/facility.repository';
import { FacilityService } from '../src/tenant/facility.service';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  type TrustedTenantContext,
} from '../src/tenant/tenant-context.contract';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const facilityId = '33333333-3333-4333-8333-333333333333';
const platformUserId = '44444444-4444-4444-8444-444444444444';
const actor: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: [],
};
const context = {
  tenantId,
  membershipId,
  platformUserId,
} as TrustedTenantContext;
const timestamp = new Date('2026-10-06T10:00:00.000Z');

function facility(overrides: Partial<FacilityRecord> = {}): FacilityRecord {
  return {
    id: facilityId,
    tenantId,
    name: 'North Clinic',
    status: FacilityStatus.ACTIVE,
    statusChangedAt: timestamp,
    suspendedAt: null,
    deactivatedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  } as FacilityRecord;
}

describe('FacilityService', () => {
  const repository = {
    create: vi.fn(),
    findById: vi.fn(),
    listForTenant: vi.fn(),
    updateName: vi.fn(),
    changeStatusIfCurrent: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  let service: FacilityService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.create.mockResolvedValue(facility());
    repository.findById.mockResolvedValue(facility());
    repository.listForTenant.mockResolvedValue([facility()]);
    repository.updateName.mockResolvedValue(facility());
    repository.changeStatusIfCurrent.mockResolvedValue(facility());
    audit.recordAudit.mockResolvedValue(undefined);
    service = new FacilityService(
      repository as unknown as FacilityRepository,
      audit as unknown as PlatformAuditService,
    );
  });

  it('creates only under the trusted tenant and audits the authenticated actor', async () => {
    await service.create(context, { name: '  North   Clinic  ' }, actor, {
      requestId: 'req-facility',
    });

    expect(repository.create).toHaveBeenCalledWith(tenantId, { name: 'North Clinic' });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.FACILITY_CREATED,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        subjectTenantId: tenantId,
        requestId: 'req-facility',
        metadata: { facilityId, status: FacilityStatus.ACTIVE },
      }),
    );
    expect(JSON.stringify(audit.recordAudit.mock.calls[0][0])).not.toMatch(
      /password|token|secret|cookie|authorization|database[_-]?url/i,
    );
  });

  it('rejects client-provided ownership and invalid names before persistence', async () => {
    await expect(
      service.create(context, { name: 'Other facility', tenantId: otherTenantId } as never, actor),
    ).rejects.toBeInstanceOf(FacilityInputValidationError);
    await expect(service.create(context, { name: '    ' }, actor)).rejects.toBeInstanceOf(
      FacilityInputValidationError,
    );

    expect(repository.create).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('lists only the trusted tenant with bounded query filters', async () => {
    await expect(
      service.list(context, { status: FacilityStatus.SUSPENDED, limit: 20, offset: 10 }),
    ).resolves.toEqual({ items: [facility()], limit: 20, offset: 10 });

    expect(repository.listForTenant).toHaveBeenCalledWith(tenantId, {
      status: FacilityStatus.SUSPENDED,
      limit: 20,
      offset: 10,
    });
  });

  it('looks up by tenant and facility together and hides cross-tenant facilities as not found', async () => {
    await service.findById(context, facilityId);
    expect(repository.findById).toHaveBeenCalledWith(tenantId, facilityId);

    repository.findById.mockResolvedValueOnce(null);
    await expect(service.findById(context, facilityId)).rejects.toBeInstanceOf(
      FacilityNotFoundError,
    );
    await expect(service.findById(context, 'not-a-facility-id')).rejects.toBeInstanceOf(
      FacilityIdInvalidError,
    );
  });

  it('updates the name only and records a minimal audit event', async () => {
    repository.updateName.mockResolvedValueOnce(facility({ name: 'South Clinic' }));

    await service.update(context, facilityId, { name: '  South   Clinic ' }, actor);

    expect(repository.updateName).toHaveBeenCalledWith(tenantId, facilityId, 'South Clinic');
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.FACILITY_UPDATED,
        actorUserId: actor.userId,
        subjectTenantId: tenantId,
        metadata: { facilityId, changedFields: 'name' },
      }),
    );
  });

  it('rejects tenantId or status updates instead of allowing ownership/lifecycle changes', async () => {
    await expect(
      service.update(
        context,
        facilityId,
        { name: 'Updated', tenantId: otherTenantId } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(FacilityInputValidationError);
    await expect(
      service.update(context, facilityId, { status: FacilityStatus.ACTIVE } as never, actor),
    ).rejects.toBeInstanceOf(FacilityInputValidationError);

    expect(repository.updateName).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    {
      current: FacilityStatus.ACTIVE,
      next: FacilityStatus.SUSPENDED,
      method: 'suspend',
      event: PlatformAuditEventType.FACILITY_SUSPENDED,
    },
    {
      current: FacilityStatus.SUSPENDED,
      next: FacilityStatus.ACTIVE,
      method: 'activate',
      event: PlatformAuditEventType.FACILITY_ACTIVATED,
    },
    {
      current: FacilityStatus.ACTIVE,
      next: FacilityStatus.DEACTIVATED,
      method: 'deactivate',
      event: PlatformAuditEventType.FACILITY_DEACTIVATED,
    },
    {
      current: FacilityStatus.SUSPENDED,
      next: FacilityStatus.DEACTIVATED,
      method: 'deactivate',
      event: PlatformAuditEventType.FACILITY_DEACTIVATED,
    },
  ])('$current → $next is conditional and audited', async ({ current, next, method, event }) => {
    repository.findById.mockResolvedValueOnce(facility({ status: current }));
    repository.changeStatusIfCurrent.mockResolvedValueOnce(facility({ status: next }));

    if (method === 'suspend') await service.suspend(context, facilityId, actor);
    if (method === 'activate') await service.activate(context, facilityId, actor);
    if (method === 'deactivate') await service.deactivate(context, facilityId, actor);

    expect(repository.changeStatusIfCurrent).toHaveBeenCalledWith(
      tenantId,
      facilityId,
      current,
      next,
      expect.any(Date),
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: event,
        actorUserId: actor.userId,
        subjectTenantId: tenantId,
        metadata: { facilityId, fromStatus: current, toStatus: next },
      }),
    );
  });

  it('makes deactivation terminal and treats same-state requests as no-ops', async () => {
    repository.findById.mockResolvedValueOnce(facility({ status: FacilityStatus.DEACTIVATED }));
    await expect(service.activate(context, facilityId, actor)).rejects.toBeInstanceOf(
      FacilityLifecycleConflictError,
    );

    repository.findById.mockResolvedValueOnce(facility({ status: FacilityStatus.ACTIVE }));
    await service.activate(context, facilityId, actor);

    expect(repository.changeStatusIfCurrent).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('fails closed for missing or mismatched trusted context and actor', async () => {
    await expect(service.list(undefined as never, {} as never)).rejects.toBeInstanceOf(
      TenantContextRequiredError,
    );
    await expect(
      service.create(context, { name: 'North Clinic' }, { ...actor, userId: otherTenantId }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.listForTenant).not.toHaveBeenCalled();
  });

  it('rejects a stale concurrent status change without recording a duplicate audit', async () => {
    repository.findById
      .mockResolvedValueOnce(facility({ status: FacilityStatus.ACTIVE }))
      .mockResolvedValueOnce(facility({ status: FacilityStatus.DEACTIVATED }));
    repository.changeStatusIfCurrent.mockResolvedValueOnce(null);

    await expect(service.suspend(context, facilityId, actor)).rejects.toBeInstanceOf(
      FacilityLifecycleConflictError,
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});
