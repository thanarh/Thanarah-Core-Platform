import { PlatformAuditEventType, TenantCatalogStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import {
  HealthcareCatalogInputValidationError,
  HealthcareCatalogLifecycleConflictError,
  HealthcareCatalogNameConflictError,
  HealthcareCatalogNotFoundError,
} from '../src/tenant/healthcare-catalog.errors';
import type {
  HealthcareCatalogMutationResult,
  HealthcareCatalogRecord,
} from '../src/tenant/healthcare-catalog.repository';
import { HealthcareCatalogService } from '../src/tenant/healthcare-catalog.service';
import type { HealthcareCatalogKind } from '../src/tenant/healthcare-catalog.dto';
import { TenantContextInvalidError } from '../src/tenant/tenant-context.contract';

const tenantId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const platformUserId = '33333333-3333-4333-8333-333333333333';
const departmentId = '44444444-4444-4444-8444-444444444444';
const specialtyId = '55555555-5555-4555-8555-555555555555';
const timestamp = new Date('2026-10-07T10:00:00.000Z');
const context = { tenantId, membershipId, platformUserId } as TrustedTenantContext;
const actor = {
  userId: platformUserId,
  sessionId: '66666666-6666-4666-8666-666666666666',
  tokenVersion: 1,
  platformRoleIds: ['PLATFORM_ADMIN'],
} as AuthenticatedPlatformUser;
const requestContext = {
  requestId: 'request-22',
  ipAddress: '127.0.0.1',
  userAgent: 'catalog-test',
};

function record(
  kind: HealthcareCatalogKind,
  status = TenantCatalogStatus.ACTIVE,
): HealthcareCatalogRecord {
  return {
    id: kind === 'department' ? departmentId : specialtyId,
    tenantId,
    name: kind === 'department' ? 'Cardiology' : 'Cardiology',
    description: null,
    status,
    statusChangedAt: timestamp,
    suspendedAt: status === TenantCatalogStatus.SUSPENDED ? timestamp : null,
    deactivatedAt: status === TenantCatalogStatus.DEACTIVATED ? timestamp : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const eventForCreate = (kind: HealthcareCatalogKind): PlatformAuditEventType =>
  kind === 'department'
    ? PlatformAuditEventType.DEPARTMENT_CREATED
    : PlatformAuditEventType.SPECIALTY_CREATED;

const eventForUpdate = (kind: HealthcareCatalogKind): PlatformAuditEventType =>
  kind === 'department'
    ? PlatformAuditEventType.DEPARTMENT_UPDATED
    : PlatformAuditEventType.SPECIALTY_UPDATED;

const eventForStatus = (
  kind: HealthcareCatalogKind,
  status: TenantCatalogStatus,
): PlatformAuditEventType => {
  if (kind === 'department') {
    if (status === TenantCatalogStatus.ACTIVE) return PlatformAuditEventType.DEPARTMENT_ACTIVATED;
    if (status === TenantCatalogStatus.SUSPENDED) {
      return PlatformAuditEventType.DEPARTMENT_SUSPENDED;
    }
    return PlatformAuditEventType.DEPARTMENT_DEACTIVATED;
  }
  if (status === TenantCatalogStatus.ACTIVE) return PlatformAuditEventType.SPECIALTY_ACTIVATED;
  if (status === TenantCatalogStatus.SUSPENDED) return PlatformAuditEventType.SPECIALTY_SUSPENDED;
  return PlatformAuditEventType.SPECIALTY_DEACTIVATED;
};

describe('HealthcareCatalogService', () => {
  const catalogs = {
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    changeStatusIfCurrent: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  let service: HealthcareCatalogService;

  beforeEach(() => {
    vi.clearAllMocks();
    audit.recordAudit.mockResolvedValue(undefined);
    service = new HealthcareCatalogService(
      catalogs as unknown as ConstructorParameters<typeof HealthcareCatalogService>[0],
      audit as unknown as PlatformAuditService,
    );
  });

  it.each([
    ['department', record('department')],
    ['specialty', record('specialty')],
  ] as const)('creates and audits a normalized %s with trusted ownership', async (kind, result) => {
    catalogs.create.mockResolvedValue({ kind: 'changed', record: result });

    await expect(
      service.create(
        kind,
        context,
        { name: '  Cardiology   Unit  ', description: '  Care team  ' },
        actor,
        requestContext,
      ),
    ).resolves.toEqual(result);

    expect(catalogs.create).toHaveBeenCalledWith(kind, tenantId, {
      name: 'Cardiology Unit',
      description: 'Care team',
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: eventForCreate(kind),
        actorUserId: platformUserId,
        sessionId: actor.sessionId,
        subjectTenantId: tenantId,
        requestId: requestContext.requestId,
        metadata: expect.objectContaining({
          targetType: kind === 'department' ? 'DEPARTMENT' : 'SPECIALTY',
          targetId: result.id,
          action: 'created',
          status: TenantCatalogStatus.ACTIVE,
        }),
      }),
    );
  });

  it.each([
    ['department', record('department')],
    ['specialty', record('specialty')],
  ] as const)(
    'returns the tenant-filtered %s list and keeps lifecycle states visible',
    async (kind, item) => {
      catalogs.list.mockResolvedValue([item]);

      await expect(service.list(kind, context, { limit: 25, offset: 5 })).resolves.toEqual({
        items: [item],
        limit: 25,
        offset: 5,
      });
      expect(catalogs.list).toHaveBeenCalledWith(kind, tenantId, { limit: 25, offset: 5 });
      expect(audit.recordAudit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['department', departmentId, record('department')],
    ['specialty', specialtyId, record('specialty')],
  ] as const)('reads only a tenant-owned %s', async (kind, id, item) => {
    catalogs.findById.mockResolvedValue(item);
    await expect(service.findById(kind, context, id)).resolves.toEqual(item);
    expect(catalogs.findById).toHaveBeenCalledWith(kind, tenantId, id);
  });

  it.each([
    ['department', departmentId],
    ['specialty', specialtyId],
  ] as const)('blocks cross-tenant %s reads and updates', async (kind, id) => {
    catalogs.findById.mockResolvedValue(null);
    await expect(service.findById(kind, context, id)).rejects.toBeInstanceOf(
      HealthcareCatalogNotFoundError,
    );

    catalogs.update.mockResolvedValue({ kind: 'not-found' });
    await expect(
      service.update(kind, context, id, { name: 'Changed' }, actor),
    ).rejects.toBeInstanceOf(HealthcareCatalogNotFoundError);
    expect(catalogs.findById).toHaveBeenCalledWith(kind, tenantId, id);
    expect(catalogs.update).toHaveBeenCalledWith(kind, tenantId, id, { name: 'Changed' });
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    ['department', record('department')],
    ['specialty', record('specialty')],
  ] as const)(
    'updates an allowed %s field and audits the successful change',
    async (kind, item) => {
      catalogs.update.mockResolvedValue({ kind: 'changed', record: item });

      await expect(
        service.update(kind, context, item.id, { name: ' New   Name ' }, actor, requestContext),
      ).resolves.toEqual(item);

      expect(catalogs.update).toHaveBeenCalledWith(kind, tenantId, item.id, { name: 'New Name' });
      expect(audit.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: eventForUpdate(kind),
          actorUserId: platformUserId,
          subjectTenantId: tenantId,
          metadata: expect.objectContaining({
            targetId: item.id,
            action: 'updated',
            changedFields: 'name',
          }),
        }),
      );
    },
  );

  it.each([
    ['department', record('department')],
    ['specialty', record('specialty')],
  ] as const)(
    'does not audit a duplicate %s name or inactive tenant mutation',
    async (kind, item) => {
      catalogs.create.mockResolvedValue({ kind: 'name-conflict' });
      await expect(
        service.create(kind, context, { name: item.name }, actor),
      ).rejects.toBeInstanceOf(HealthcareCatalogNameConflictError);
      expect(audit.recordAudit).not.toHaveBeenCalled();

      catalogs.update.mockResolvedValue({ kind: 'tenant-inactive' });
      await expect(
        service.update(kind, context, item.id, { name: 'Updated' }, actor),
      ).rejects.toBeInstanceOf(TenantContextInvalidError);
      expect(audit.recordAudit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['department', TenantCatalogStatus.ACTIVE, TenantCatalogStatus.SUSPENDED],
    ['department', TenantCatalogStatus.ACTIVE, TenantCatalogStatus.DEACTIVATED],
    ['department', TenantCatalogStatus.SUSPENDED, TenantCatalogStatus.ACTIVE],
    ['department', TenantCatalogStatus.SUSPENDED, TenantCatalogStatus.DEACTIVATED],
    ['specialty', TenantCatalogStatus.ACTIVE, TenantCatalogStatus.SUSPENDED],
    ['specialty', TenantCatalogStatus.ACTIVE, TenantCatalogStatus.DEACTIVATED],
    ['specialty', TenantCatalogStatus.SUSPENDED, TenantCatalogStatus.ACTIVE],
    ['specialty', TenantCatalogStatus.SUSPENDED, TenantCatalogStatus.DEACTIVATED],
  ] as const)(
    'allows %s transition %s -> %s and records its audit event',
    async (kind, currentStatus, nextStatus) => {
      const current = record(kind, currentStatus);
      const updated = record(kind, nextStatus);
      catalogs.findById.mockResolvedValueOnce(current);
      catalogs.changeStatusIfCurrent.mockResolvedValue({
        kind: 'changed',
        record: updated,
      } satisfies HealthcareCatalogMutationResult);

      const method =
        nextStatus === TenantCatalogStatus.SUSPENDED
          ? service.suspend
          : nextStatus === TenantCatalogStatus.ACTIVE
            ? service.activate
            : service.deactivate;
      await expect(
        method.call(service, kind, context, current.id, actor, requestContext),
      ).resolves.toEqual(updated);

      expect(catalogs.changeStatusIfCurrent).toHaveBeenCalledWith(
        kind,
        tenantId,
        current.id,
        currentStatus,
        nextStatus,
        expect.any(Date),
      );
      expect(audit.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: eventForStatus(kind, nextStatus),
          actorUserId: platformUserId,
          subjectTenantId: tenantId,
          metadata: expect.objectContaining({
            targetId: current.id,
            fromStatus: currentStatus,
            toStatus: nextStatus,
          }),
        }),
      );
    },
  );

  it.each(['department', 'specialty'] as const)(
    'treats same-state %s transitions idempotently without another audit',
    async (kind) => {
      const current = record(kind, TenantCatalogStatus.ACTIVE);
      catalogs.findById.mockResolvedValue(current);

      await expect(service.activate(kind, context, current.id, actor)).resolves.toEqual(current);
      expect(catalogs.changeStatusIfCurrent).not.toHaveBeenCalled();
      expect(audit.recordAudit).not.toHaveBeenCalled();
    },
  );

  it.each(['department', 'specialty'] as const)(
    'rejects reactivation of terminal %s records and does not audit failure',
    async (kind) => {
      const current = record(kind, TenantCatalogStatus.DEACTIVATED);
      catalogs.findById.mockResolvedValue(current);

      await expect(service.activate(kind, context, current.id, actor)).rejects.toBeInstanceOf(
        HealthcareCatalogLifecycleConflictError,
      );
      expect(catalogs.changeStatusIfCurrent).not.toHaveBeenCalled();
      expect(audit.recordAudit).not.toHaveBeenCalled();
    },
  );

  it('treats a competing transition to the requested state as idempotent', async () => {
    const suspended = record('department', TenantCatalogStatus.SUSPENDED);
    catalogs.findById.mockResolvedValueOnce(record('department')).mockResolvedValueOnce(suspended);
    catalogs.changeStatusIfCurrent.mockResolvedValue({ kind: 'not-changed' });

    await expect(service.suspend('department', context, departmentId, actor)).resolves.toEqual(
      suspended,
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    ['department', record('department')],
    ['specialty', record('specialty')],
  ] as const)('does not audit failed %s writes', async (kind, item) => {
    catalogs.create.mockResolvedValue({ kind: 'name-conflict' });
    await expect(service.create(kind, context, { name: item.name }, actor)).rejects.toBeInstanceOf(
      HealthcareCatalogNameConflictError,
    );

    catalogs.update.mockResolvedValue({ kind: 'not-found' });
    await expect(
      service.update(kind, context, item.id, { description: null }, actor),
    ).rejects.toBeInstanceOf(HealthcareCatalogNotFoundError);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects invalid inputs, client-supplied ownership, and a mismatched actor', async () => {
    await expect(
      service.create('department', context, { name: '   ' } as never, actor),
    ).rejects.toBeInstanceOf(HealthcareCatalogInputValidationError);
    await expect(
      service.update(
        'specialty',
        context,
        specialtyId,
        { name: 'Valid', status: TenantCatalogStatus.DEACTIVATED } as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(HealthcareCatalogInputValidationError);
    await expect(
      service.create(
        'department',
        context,
        { name: 'Valid' },
        { ...actor, userId: '99999999-9999-4999-8999-999999999999' },
      ),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
    expect(catalogs.create).not.toHaveBeenCalled();
    expect(catalogs.update).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});
