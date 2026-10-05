import { BadRequestException } from '@nestjs/common';
import { PlatformAuditEventType, Prisma, TenantStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import {
  TenantInputValidationError,
  TenantLifecycleConflictError,
  TenantNotFoundError,
  TenantSlugConflictError,
} from '../src/tenant/tenant.errors';
import type { TenantRepository } from '../src/tenant/tenant.repository';
import type { TenantRecord } from '../src/tenant/tenant.repository';
import { TenantService } from '../src/tenant/tenant.service';

const tenantId = '88c97293-0825-4c6e-b75e-72aee285d195';
const actor: AuthenticatedPlatformUser = {
  userId: 'platform-user-1',
  sessionId: 'platform-session-1',
  tokenVersion: 1,
  platformRoleIds: [],
};

const timestamp = new Date('2026-10-05T12:00:00.000Z');

function tenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: tenantId,
    slug: 'north-clinic',
    legalName: 'North Health Group',
    displayName: 'North Health Group',
    status: TenantStatus.ACTIVE,
    statusChangedAt: timestamp,
    suspendedAt: null,
    deactivatedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('TenantService', () => {
  const repository = {
    create: vi.fn(),
    findById: vi.fn(),
    findBySlug: vi.fn(),
    list: vi.fn(),
    changeStatusIfCurrent: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  let service: TenantService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.create.mockResolvedValue(tenant());
    repository.findById.mockResolvedValue(tenant());
    repository.findBySlug.mockResolvedValue(null);
    repository.list.mockResolvedValue([tenant()]);
    repository.changeStatusIfCurrent.mockResolvedValue(
      tenant({ status: TenantStatus.SUSPENDED, suspendedAt: timestamp }),
    );
    audit.recordAudit.mockResolvedValue(undefined);
    service = new TenantService(
      repository as unknown as TenantRepository,
      audit as unknown as PlatformAuditService,
    );
  });

  it('normalizes tenant identity and attributes creation audit to the authenticated actor', async () => {
    await service.create(
      { slug: '  North---Clinic ', legalName: '  North   Health Group  ' },
      actor,
      { requestId: 'req-123' },
    );

    expect(repository.create).toHaveBeenCalledWith({
      slug: 'north-clinic',
      legalName: 'North Health Group',
      displayName: 'North Health Group',
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.TENANT_CREATED,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        subjectTenantId: tenantId,
        requestId: 'req-123',
        metadata: { tenantSlug: 'north-clinic', status: TenantStatus.ACTIVE },
      }),
    );
  });

  it('rejects missing or invalid required identity fields before persistence', async () => {
    await expect(
      service.create({ slug: 'x', legalName: '   ' } as never, actor),
    ).rejects.toBeInstanceOf(TenantInputValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate normalized slugs', async () => {
    repository.findBySlug.mockResolvedValue(tenant());

    await expect(
      service.create({ slug: 'NORTH CLINIC', legalName: 'Other Organization' }, actor),
    ).rejects.toBeInstanceOf(TenantSlugConflictError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent unique-slug collision to a stable conflict', async () => {
    repository.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['slug'] },
      }),
    );

    await expect(
      service.create({ slug: 'north-clinic', legalName: 'North Health Group' }, actor),
    ).rejects.toBeInstanceOf(TenantSlugConflictError);
  });

  it('allows ACTIVE to SUSPENDED and records the transition', async () => {
    repository.changeStatusIfCurrent.mockResolvedValue(
      tenant({ status: TenantStatus.SUSPENDED, suspendedAt: timestamp }),
    );

    await service.changeStatus(tenantId, TenantStatus.SUSPENDED, actor);

    expect(repository.changeStatusIfCurrent).toHaveBeenCalledWith(
      tenantId,
      TenantStatus.ACTIVE,
      TenantStatus.SUSPENDED,
      expect.any(Date),
    );
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.TENANT_STATUS_CHANGED,
        actorUserId: actor.userId,
        subjectTenantId: tenantId,
        metadata: {
          tenantSlug: 'north-clinic',
          fromStatus: TenantStatus.ACTIVE,
          toStatus: TenantStatus.SUSPENDED,
        },
      }),
    );
  });

  it('makes deactivation terminal and records a dedicated event', async () => {
    repository.changeStatusIfCurrent.mockResolvedValue(
      tenant({ status: TenantStatus.DEACTIVATED, deactivatedAt: timestamp }),
    );

    await service.changeStatus(tenantId, TenantStatus.DEACTIVATED, actor);

    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.TENANT_DEACTIVATED,
        actorUserId: actor.userId,
        subjectTenantId: tenantId,
      }),
    );

    repository.findById.mockResolvedValue(
      tenant({ status: TenantStatus.DEACTIVATED, deactivatedAt: timestamp }),
    );
    await expect(service.changeStatus(tenantId, TenantStatus.ACTIVE, actor)).rejects.toBeInstanceOf(
      TenantLifecycleConflictError,
    );
  });

  it('treats repeating the current status as an idempotent no-op', async () => {
    await service.changeStatus(tenantId, TenantStatus.ACTIVE, actor);

    expect(repository.changeStatusIfCurrent).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('does not permit a concurrent transition to bypass the lifecycle check', async () => {
    repository.changeStatusIfCurrent.mockResolvedValue(null);
    repository.findById
      .mockResolvedValueOnce(tenant())
      .mockResolvedValueOnce(tenant({ status: TenantStatus.DEACTIVATED }));

    await expect(
      service.changeStatus(tenantId, TenantStatus.SUSPENDED, actor),
    ).rejects.toBeInstanceOf(TenantLifecycleConflictError);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects malformed identifiers and reports missing tenants without querying other scopes', async () => {
    await expect(service.findById('not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);

    repository.findById.mockResolvedValue(null);
    await expect(service.findById(tenantId)).rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it('passes bounded list filters to the repository', async () => {
    await service.list({ status: TenantStatus.SUSPENDED, limit: 20, offset: 10 });

    expect(repository.list).toHaveBeenCalledWith({
      status: TenantStatus.SUSPENDED,
      limit: 20,
      offset: 10,
    });
  });
});
