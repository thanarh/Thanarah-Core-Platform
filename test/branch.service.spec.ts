import { BranchStatus, FacilityStatus, PlatformAuditEventType, TenantStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import {
  BranchFacilityNotFoundError,
  BranchInputValidationError,
  BranchLifecycleConflictError,
  BranchNotFoundError,
  BranchParentUnavailableError,
} from '../src/tenant/branch.errors';
import type { BranchRecord, BranchRepository } from '../src/tenant/branch.repository';
import { BranchService } from '../src/tenant/branch.service';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  type TrustedTenantContext,
} from '../src/tenant/tenant-context.contract';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const facilityId = '33333333-3333-4333-8333-333333333333';
const branchId = '44444444-4444-4444-8444-444444444444';
const platformUserId = '55555555-5555-4555-8555-555555555555';
const actor: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '66666666-6666-4666-8666-666666666666',
  tokenVersion: 1,
  platformRoleIds: [],
};
const context = { tenantId, membershipId, platformUserId } as TrustedTenantContext;
const timestamp = new Date('2026-10-06T10:00:00.000Z');

function facilityScope(
  status: FacilityStatus = FacilityStatus.ACTIVE,
  tenantStatus: TenantStatus = TenantStatus.ACTIVE,
): { id: string; status: FacilityStatus; tenant: { status: TenantStatus } } {
  return { id: facilityId, status, tenant: { status: tenantStatus } };
}

function branch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    id: branchId,
    facilityId,
    name: 'East Wing',
    status: BranchStatus.ACTIVE,
    statusChangedAt: timestamp,
    suspendedAt: null,
    deactivatedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  } as BranchRecord;
}

describe('BranchService', () => {
  const repository = {
    findFacilityScope: vi.fn(),
    createUnderActiveFacility: vi.fn(),
    listForFacility: vi.fn(),
    findByIdWithinFacility: vi.fn(),
    updateNameWithinFacility: vi.fn(),
    changeStatusIfCurrentWithinFacility: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  let service: BranchService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.findFacilityScope.mockResolvedValue(facilityScope());
    repository.createUnderActiveFacility.mockResolvedValue(branch());
    repository.listForFacility.mockResolvedValue([branch()]);
    repository.findByIdWithinFacility.mockResolvedValue(branch());
    repository.updateNameWithinFacility.mockResolvedValue(branch());
    repository.changeStatusIfCurrentWithinFacility.mockResolvedValue(branch());
    audit.recordAudit.mockResolvedValue(undefined);
    service = new BranchService(
      repository as unknown as BranchRepository,
      audit as unknown as PlatformAuditService,
    );
  });

  it('creates through the trusted Tenant → Facility chain and audits safe identifiers', async () => {
    await service.create(context, facilityId, { name: '  East   Wing ' }, actor, {
      requestId: 'req-branch',
    });

    expect(repository.findFacilityScope).toHaveBeenCalledWith(tenantId, facilityId);
    expect(repository.createUnderActiveFacility).toHaveBeenCalledWith(tenantId, facilityId, {
      name: 'East Wing',
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.BRANCH_CREATED,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        subjectTenantId: tenantId,
        requestId: 'req-branch',
        metadata: { facilityId, branchId, status: BranchStatus.ACTIVE },
      }),
    );
    expect(JSON.stringify(audit.recordAudit.mock.calls[0][0])).not.toMatch(
      /password|token|secret|cookie|authorization|database[_-]?url/i,
    );
  });

  it('rejects client-supplied tenant, facility, or lifecycle values', async () => {
    await expect(
      service.create(
        context,
        facilityId,
        { name: 'Branch', tenantId: otherTenantId, facilityId } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(BranchInputValidationError);
    await expect(
      service.update(context, facilityId, branchId, { name: 'New', facilityId } as never, actor),
    ).rejects.toBeInstanceOf(BranchInputValidationError);
    await expect(
      service.update(
        context,
        facilityId,
        branchId,
        { status: BranchStatus.DEACTIVATED } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(BranchInputValidationError);

    expect(repository.createUnderActiveFacility).not.toHaveBeenCalled();
    expect(repository.updateNameWithinFacility).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('lists only the requested Facility through the trusted Tenant scope', async () => {
    await expect(
      service.list(context, facilityId, {
        status: BranchStatus.SUSPENDED,
        limit: 20,
        offset: 10,
      }),
    ).resolves.toEqual({ items: [branch()], limit: 20, offset: 10 });

    expect(repository.listForFacility).toHaveBeenCalledWith(tenantId, facilityId, {
      status: BranchStatus.SUSPENDED,
      limit: 20,
      offset: 10,
    });
  });

  it('uses Tenant, Facility, and Branch together and hides cross-facility Branches', async () => {
    await service.findById(context, facilityId, branchId);
    expect(repository.findByIdWithinFacility).toHaveBeenCalledWith(tenantId, facilityId, branchId);

    repository.findByIdWithinFacility.mockResolvedValueOnce(null);
    await expect(service.findById(context, facilityId, branchId)).rejects.toBeInstanceOf(
      BranchNotFoundError,
    );
    repository.findFacilityScope.mockResolvedValueOnce(null);
    await expect(
      service.list(context, otherTenantId, { limit: 10, offset: 0 }),
    ).rejects.toBeInstanceOf(BranchFacilityNotFoundError);
  });

  it('updates only the Branch name and records the trusted parent and Branch IDs', async () => {
    repository.updateNameWithinFacility.mockResolvedValueOnce(branch({ name: 'North Annex' }));

    await service.update(context, facilityId, branchId, { name: ' North   Annex ' }, actor);

    expect(repository.updateNameWithinFacility).toHaveBeenCalledWith(
      tenantId,
      facilityId,
      branchId,
      'North Annex',
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.BRANCH_UPDATED,
        actorUserId: actor.userId,
        subjectTenantId: tenantId,
        metadata: { facilityId, branchId, changedFields: 'name' },
      }),
    );
  });

  it.each([
    {
      from: BranchStatus.ACTIVE,
      to: BranchStatus.SUSPENDED,
      action: 'suspend',
      event: PlatformAuditEventType.BRANCH_SUSPENDED,
    },
    {
      from: BranchStatus.SUSPENDED,
      to: BranchStatus.ACTIVE,
      action: 'activate',
      event: PlatformAuditEventType.BRANCH_ACTIVATED,
    },
    {
      from: BranchStatus.ACTIVE,
      to: BranchStatus.DEACTIVATED,
      action: 'deactivate',
      event: PlatformAuditEventType.BRANCH_DEACTIVATED,
    },
    {
      from: BranchStatus.SUSPENDED,
      to: BranchStatus.DEACTIVATED,
      action: 'deactivate',
      event: PlatformAuditEventType.BRANCH_DEACTIVATED,
    },
  ])('$from → $to is an audited conditional transition', async ({ from, to, action, event }) => {
    repository.findByIdWithinFacility.mockResolvedValueOnce(branch({ status: from }));
    repository.changeStatusIfCurrentWithinFacility.mockResolvedValueOnce(branch({ status: to }));

    if (action === 'suspend') await service.suspend(context, facilityId, branchId, actor);
    if (action === 'activate') await service.activate(context, facilityId, branchId, actor);
    if (action === 'deactivate') await service.deactivate(context, facilityId, branchId, actor);

    expect(repository.changeStatusIfCurrentWithinFacility).toHaveBeenCalledWith(
      tenantId,
      facilityId,
      branchId,
      from,
      to,
      expect.any(Date),
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: event,
        actorUserId: actor.userId,
        subjectTenantId: tenantId,
        metadata: { facilityId, branchId, fromStatus: from, toStatus: to },
      }),
    );
  });

  it('keeps deactivation terminal and same-state transitions idempotent', async () => {
    repository.findByIdWithinFacility.mockResolvedValueOnce(
      branch({ status: BranchStatus.DEACTIVATED }),
    );
    await expect(service.activate(context, facilityId, branchId, actor)).rejects.toBeInstanceOf(
      BranchLifecycleConflictError,
    );

    repository.findByIdWithinFacility.mockResolvedValueOnce(
      branch({ status: BranchStatus.ACTIVE }),
    );
    await service.activate(context, facilityId, branchId, actor);

    expect(repository.changeStatusIfCurrentWithinFacility).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it.each([FacilityStatus.SUSPENDED, FacilityStatus.DEACTIVATED])(
    'blocks all Branch operations while the parent Facility is %s',
    async (status) => {
      repository.findFacilityScope.mockResolvedValue(facilityScope(status));

      await expect(
        service.create(context, facilityId, { name: 'New branch' }, actor),
      ).rejects.toBeInstanceOf(BranchParentUnavailableError);
      await expect(
        service.list(context, facilityId, { limit: 20, offset: 0 }),
      ).rejects.toBeInstanceOf(BranchParentUnavailableError);
      await expect(service.findById(context, facilityId, branchId)).rejects.toBeInstanceOf(
        BranchParentUnavailableError,
      );
      await expect(
        service.update(context, facilityId, branchId, { name: 'New name' }, actor),
      ).rejects.toBeInstanceOf(BranchParentUnavailableError);
      await expect(service.suspend(context, facilityId, branchId, actor)).rejects.toBeInstanceOf(
        BranchParentUnavailableError,
      );

      expect(repository.createUnderActiveFacility).not.toHaveBeenCalled();
      expect(repository.listForFacility).not.toHaveBeenCalled();
      expect(repository.findByIdWithinFacility).not.toHaveBeenCalled();
      expect(repository.updateNameWithinFacility).not.toHaveBeenCalled();
      expect(repository.changeStatusIfCurrentWithinFacility).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the trusted Tenant is unavailable', async () => {
    repository.findFacilityScope.mockResolvedValueOnce(
      facilityScope(FacilityStatus.ACTIVE, TenantStatus.SUSPENDED),
    );

    await expect(
      service.list(context, facilityId, { limit: 20, offset: 0 }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
    expect(repository.listForFacility).not.toHaveBeenCalled();
  });

  it('fails closed for missing or mismatched tenant context and actor', async () => {
    await expect(service.list(undefined as never, facilityId, {} as never)).rejects.toBeInstanceOf(
      TenantContextRequiredError,
    );
    await expect(
      service.create(context, facilityId, { name: 'Branch' }, { ...actor, userId: otherTenantId }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);

    expect(repository.findFacilityScope).not.toHaveBeenCalled();
    expect(repository.createUnderActiveFacility).not.toHaveBeenCalled();
  });

  it('does not disclose cross-tenant Facilities and blocks a stale parent-scope write', async () => {
    repository.findFacilityScope.mockResolvedValueOnce(null);
    await expect(
      service.create(context, otherTenantId, { name: 'Branch' }, actor),
    ).rejects.toBeInstanceOf(BranchFacilityNotFoundError);

    repository.findFacilityScope
      .mockResolvedValueOnce(facilityScope())
      .mockResolvedValueOnce(facilityScope(FacilityStatus.SUSPENDED));
    repository.createUnderActiveFacility.mockResolvedValueOnce(null);
    await expect(
      service.create(context, facilityId, { name: 'Branch' }, actor),
    ).rejects.toBeInstanceOf(BranchParentUnavailableError);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects stale status writes without duplicating audit events', async () => {
    repository.findByIdWithinFacility
      .mockResolvedValueOnce(branch({ status: BranchStatus.ACTIVE }))
      .mockResolvedValueOnce(branch({ status: BranchStatus.DEACTIVATED }));
    repository.changeStatusIfCurrentWithinFacility.mockResolvedValueOnce(null);

    await expect(service.suspend(context, facilityId, branchId, actor)).rejects.toBeInstanceOf(
      BranchLifecycleConflictError,
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});
