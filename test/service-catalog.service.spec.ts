import { PlatformAuditEventType, TenantCatalogStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import {
  ServiceCodeConflictError,
  ServiceIdInvalidError,
  ServiceInputValidationError,
  ServiceLifecycleConflictError,
  ServiceNameConflictError,
  ServiceNotFoundError,
} from '../src/tenant/service-catalog.errors';
import type {
  ServiceCatalogMutationResult,
  ServiceCatalogRecord,
} from '../src/tenant/service-catalog.repository';
import { ServiceCatalogService } from '../src/tenant/service-catalog.service';
import { TenantContextInvalidError } from '../src/tenant/tenant-context.contract';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const membershipId = '22222222-2222-4222-8222-222222222222';
const platformUserId = '33333333-3333-4333-8333-333333333333';
const serviceId = '44444444-4444-4444-8444-444444444444';
const timestamp = new Date('2026-10-07T10:00:00.000Z');
const context = { tenantId, membershipId, platformUserId } as TrustedTenantContext;
const actor = {
  userId: platformUserId,
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: ['PLATFORM_ADMIN'],
} as AuthenticatedPlatformUser;
const requestContext = {
  requestId: 'request-25',
  ipAddress: '127.0.0.1',
  userAgent: 'service-catalog-test',
};

function record(status = TenantCatalogStatus.ACTIVE): ServiceCatalogRecord {
  return {
    id: serviceId,
    name: 'Consultation',
    code: 'CONS-01',
    description: 'General consultation',
    status,
    statusChangedAt: timestamp,
    suspendedAt: status === TenantCatalogStatus.SUSPENDED ? timestamp : null,
    deactivatedAt: status === TenantCatalogStatus.DEACTIVATED ? timestamp : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('ServiceCatalogService', () => {
  const services = {
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    changeStatusIfCurrent: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  let service: ServiceCatalogService;

  beforeEach(() => {
    vi.resetAllMocks();
    audit.recordAudit.mockResolvedValue(undefined);
    service = new ServiceCatalogService(
      services as unknown as ConstructorParameters<typeof ServiceCatalogService>[0],
      audit as unknown as PlatformAuditService,
    );
  });

  it('creates normalized tenant-owned services and records the create audit', async () => {
    const created = record();
    services.create.mockResolvedValue({ kind: 'changed', record: created });

    await expect(
      service.create(
        context,
        {
          name: '  Consultation   Service ',
          code: ' cons-01  ',
          description: '  General\r\n consultation  ',
        },
        actor,
        requestContext,
      ),
    ).resolves.toEqual(created);

    expect(services.create).toHaveBeenCalledWith(tenantId, {
      name: 'Consultation Service',
      code: 'cons-01',
      description: 'General\n consultation',
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.SERVICE_CREATED,
        actorUserId: platformUserId,
        sessionId: actor.sessionId,
        subjectTenantId: tenantId,
        requestId: requestContext.requestId,
        metadata: {
          targetType: 'SERVICE',
          targetId: serviceId,
          action: 'created',
          status: TenantCatalogStatus.ACTIVE,
        },
      }),
    );
  });

  it('lists with tenant scope, lifecycle filters, and pagination without auditing reads', async () => {
    const item = record(TenantCatalogStatus.SUSPENDED);
    services.list.mockResolvedValue({ items: [item], total: 26 });

    await expect(
      service.list(context, {
        status: TenantCatalogStatus.SUSPENDED,
        limit: 20,
        offset: 5,
      }),
    ).resolves.toEqual({ items: [item], limit: 20, offset: 5, total: 26, hasNext: true });
    expect(services.list).toHaveBeenCalledWith(tenantId, {
      status: TenantCatalogStatus.SUSPENDED,
      limit: 20,
      offset: 5,
    });
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('reports no next slice for an empty or final result slice', async () => {
    services.list
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [record()], total: 1 })
      .mockResolvedValueOnce({ items: [record()], total: 100_021 });

    await expect(service.list(context, { limit: 20, offset: 0 })).resolves.toEqual({
      items: [],
      limit: 20,
      offset: 0,
      total: 0,
      hasNext: false,
    });
    await expect(service.list(context, { limit: 20, offset: 0 })).resolves.toMatchObject({
      total: 1,
      hasNext: false,
    });
    await expect(service.list(context, { limit: 20, offset: 100_000 })).resolves.toMatchObject({
      total: 100_021,
      hasNext: false,
    });
  });

  it('rejects invalid list filters and unsafe pagination values', async () => {
    for (const query of [
      { status: 'UNKNOWN', limit: 20, offset: 0 },
      { limit: 0, offset: 0 },
      { limit: 101, offset: 0 },
      { limit: 'not-a-number', offset: 0 },
      { limit: 20, offset: -1 },
      { limit: 20, offset: '' },
      { limit: 20, offset: 100_001 },
      { limit: 20, offset: 0, tenantId: otherTenantId },
    ]) {
      await expect(service.list(context, query as never)).rejects.toBeInstanceOf(
        ServiceInputValidationError,
      );
    }
    expect(services.list).not.toHaveBeenCalled();
  });

  it('reads only a service returned for the trusted tenant', async () => {
    services.findById.mockResolvedValueOnce(record()).mockResolvedValueOnce(null);

    await expect(service.findById(context, serviceId)).resolves.toEqual(record());
    await expect(service.findById(context, serviceId)).rejects.toBeInstanceOf(ServiceNotFoundError);
    expect(services.findById).toHaveBeenNthCalledWith(1, tenantId, serviceId);
    expect(services.findById).toHaveBeenNthCalledWith(2, tenantId, serviceId);
  });

  it('updates mutable fields, supports explicit clearing, and audits only supplied fields', async () => {
    const updated = { ...record(), code: null, description: null };
    services.update.mockResolvedValue({ kind: 'changed', record: updated });

    await expect(
      service.update(context, serviceId, { code: null, description: null }, actor, requestContext),
    ).resolves.toEqual(updated);
    expect(services.update).toHaveBeenCalledWith(tenantId, serviceId, {
      code: null,
      description: null,
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.SERVICE_UPDATED,
        subjectTenantId: tenantId,
        metadata: expect.objectContaining({
          targetType: 'SERVICE',
          targetId: serviceId,
          action: 'updated',
          changedFields: 'code,description',
        }),
      }),
    );
  });

  it('maps duplicate name/code and inactive-tenant writes without auditing failures', async () => {
    services.create
      .mockResolvedValueOnce({ kind: 'name-conflict' })
      .mockResolvedValueOnce({ kind: 'code-conflict' })
      .mockResolvedValueOnce({ kind: 'tenant-inactive' });

    await expect(service.create(context, { name: 'Consultation' }, actor)).rejects.toBeInstanceOf(
      ServiceNameConflictError,
    );
    await expect(
      service.create(context, { name: 'Follow up', code: 'CONS-01' }, actor),
    ).rejects.toBeInstanceOf(ServiceCodeConflictError);
    await expect(service.create(context, { name: 'New service' }, actor)).rejects.toBeInstanceOf(
      TenantContextInvalidError,
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    [TenantCatalogStatus.ACTIVE, TenantCatalogStatus.SUSPENDED, 'suspend'],
    [TenantCatalogStatus.ACTIVE, TenantCatalogStatus.DEACTIVATED, 'deactivate'],
    [TenantCatalogStatus.SUSPENDED, TenantCatalogStatus.ACTIVE, 'activate'],
    [TenantCatalogStatus.SUSPENDED, TenantCatalogStatus.DEACTIVATED, 'deactivate'],
  ] as const)(
    'allows lifecycle transition %s -> %s and records the service status event',
    async (currentStatus, nextStatus, operation) => {
      services.findById.mockResolvedValueOnce(record(currentStatus));
      services.changeStatusIfCurrent.mockResolvedValue({
        kind: 'changed',
        record: record(nextStatus),
      } satisfies ServiceCatalogMutationResult);

      await expect(service[operation](context, serviceId, actor, requestContext)).resolves.toEqual(
        record(nextStatus),
      );
      expect(services.changeStatusIfCurrent).toHaveBeenCalledWith(
        tenantId,
        serviceId,
        currentStatus,
        nextStatus,
        expect.any(Date),
      );
      expect(audit.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: PlatformAuditEventType.SERVICE_STATUS_CHANGED,
          subjectTenantId: tenantId,
          metadata: expect.objectContaining({
            targetType: 'SERVICE',
            targetId: serviceId,
            fromStatus: currentStatus,
            toStatus: nextStatus,
          }),
        }),
      );
    },
  );

  it('keeps same-state transitions idempotent and rejects terminal reactivation', async () => {
    services.findById
      .mockResolvedValueOnce(record(TenantCatalogStatus.ACTIVE))
      .mockResolvedValueOnce(record(TenantCatalogStatus.DEACTIVATED));

    await expect(service.activate(context, serviceId, actor)).resolves.toEqual(record());
    await expect(service.activate(context, serviceId, actor)).rejects.toBeInstanceOf(
      ServiceLifecycleConflictError,
    );
    expect(services.changeStatusIfCurrent).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('treats a concurrent transition to the requested state as idempotent', async () => {
    services.findById
      .mockResolvedValueOnce(record(TenantCatalogStatus.ACTIVE))
      .mockResolvedValueOnce(record(TenantCatalogStatus.SUSPENDED));
    services.changeStatusIfCurrent.mockResolvedValue({ kind: 'not-changed' });

    await expect(service.suspend(context, serviceId, actor)).resolves.toEqual(
      record(TenantCatalogStatus.SUSPENDED),
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs, invalid text, protected fields, empty patches, and mismatched actors', async () => {
    await expect(service.findById(context, 'not-a-uuid')).rejects.toBeInstanceOf(
      ServiceIdInvalidError,
    );
    await expect(service.create(context, { name: '   ' } as never, actor)).rejects.toBeInstanceOf(
      ServiceInputValidationError,
    );
    await expect(
      service.create(context, { name: 'Consultation', code: '  ' }, actor),
    ).rejects.toBeInstanceOf(ServiceInputValidationError);
    await expect(
      service.create(context, { name: 'Consultation', description: '<script>bad</script>' }, actor),
    ).rejects.toBeInstanceOf(ServiceInputValidationError);
    await expect(
      service.create(context, { name: 'Consultation', description: 'd'.repeat(2001) }, actor),
    ).rejects.toBeInstanceOf(ServiceInputValidationError);
    await expect(service.update(context, serviceId, {}, actor)).rejects.toBeInstanceOf(
      ServiceInputValidationError,
    );
    await expect(
      service.update(
        context,
        serviceId,
        { name: 'Updated', tenantId: otherTenantId } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(ServiceInputValidationError);
    await expect(
      service.update(
        context,
        serviceId,
        { name: 'Updated', status: TenantCatalogStatus.DEACTIVATED } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(ServiceInputValidationError);
    await expect(
      service.create(
        { ...context, platformUserId: otherTenantId } as TrustedTenantContext,
        { name: 'Valid' },
        actor,
      ),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);

    expect(services.create).not.toHaveBeenCalled();
    expect(services.update).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('does not audit cross-tenant updates or lifecycle changes', async () => {
    services.findById.mockResolvedValue(null);
    services.update.mockResolvedValue({ kind: 'not-found' });

    await expect(
      service.update(context, serviceId, { name: 'Changed' }, actor),
    ).rejects.toBeInstanceOf(ServiceNotFoundError);
    await expect(service.deactivate(context, serviceId, actor)).rejects.toBeInstanceOf(
      ServiceNotFoundError,
    );
    expect(services.update).toHaveBeenCalledWith(tenantId, serviceId, { name: 'Changed' });
    expect(services.changeStatusIfCurrent).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});
