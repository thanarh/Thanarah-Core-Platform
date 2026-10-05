import { FeatureStatus, PlatformAuditEventType, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import {
  FeatureInputInvalidError,
  FeatureKeyConflictError,
  FeatureNotFoundError,
} from '../src/platform-catalog/catalog.errors';
import type { FeatureRecord, FeatureRepository } from '../src/platform-catalog/feature.repository';
import { FeatureService } from '../src/platform-catalog/feature.service';

const featureId = 'b04407f4-5b8b-46f4-8e16-8c72def449f2';
const now = new Date('2026-10-06T10:00:00.000Z');
const actor: AuthenticatedPlatformUser = {
  userId: 'trusted-platform-user',
  sessionId: 'trusted-platform-session',
  tokenVersion: 1,
  platformRoleIds: [],
};

function feature(overrides: Partial<FeatureRecord> = {}): FeatureRecord {
  return {
    id: featureId,
    key: 'REPORTS',
    name: 'Reports',
    description: null,
    status: FeatureStatus.ACTIVE,
    statusChangedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('FeatureService', () => {
  const repository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByKey: vi.fn(),
    list: vi.fn(),
    updateIfCurrentStatus: vi.fn(),
    changeStatusIfCurrent: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  let service: FeatureService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.create.mockResolvedValue(feature());
    repository.findById.mockResolvedValue(feature());
    repository.findByKey.mockResolvedValue(null);
    repository.list.mockResolvedValue([]);
    repository.updateIfCurrentStatus.mockResolvedValue(feature());
    repository.changeStatusIfCurrent.mockResolvedValue(feature({ status: FeatureStatus.INACTIVE }));
    audit.recordAudit.mockResolvedValue(undefined);
    service = new FeatureService(
      repository as unknown as FeatureRepository,
      audit as unknown as PlatformAuditService,
    );
  });

  it('normalizes and creates a Feature with trusted actor attribution', async () => {
    await service.create({ key: ' reports ', name: '  Monthly   Reports ' }, actor);

    expect(repository.create).toHaveBeenCalledWith({
      key: 'REPORTS',
      name: 'Monthly Reports',
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.FEATURE_CREATED,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        metadata: {
          featureId,
          featureKey: 'REPORTS',
          status: FeatureStatus.ACTIVE,
        },
      }),
    );
  });

  it('rejects invalid and duplicate Feature keys', async () => {
    await expect(
      service.create({ key: 'appointments.max', name: 'Invalid key' }, actor),
    ).rejects.toBeInstanceOf(FeatureInputInvalidError);

    repository.findByKey.mockResolvedValueOnce(feature());
    await expect(service.create({ key: 'REPORTS', name: 'Reports' }, actor)).rejects.toBeInstanceOf(
      FeatureKeyConflictError,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('maps concurrent unique Feature key collisions', async () => {
    repository.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.create({ key: 'REPORTS', name: 'Reports' }, actor)).rejects.toBeInstanceOf(
      FeatureKeyConflictError,
    );
  });

  it('lists and reads Features while validating identifiers and filters', async () => {
    await service.list({ status: FeatureStatus.INACTIVE, limit: 10, offset: 5 });
    expect(repository.list).toHaveBeenCalledWith({
      status: FeatureStatus.INACTIVE,
      limit: 10,
      offset: 5,
    });
    await expect(service.list({ limit: 101, offset: 0 })).rejects.toBeInstanceOf(
      FeatureInputInvalidError,
    );
    await expect(service.findById('bad-id')).rejects.toMatchObject({
      response: { code: 'FEATURE_ID_INVALID' },
    });
    repository.findById.mockResolvedValueOnce(null);
    await expect(service.findById(featureId)).rejects.toBeInstanceOf(FeatureNotFoundError);
    repository.findById.mockResolvedValueOnce(feature());
    await expect(service.findById(featureId)).resolves.toMatchObject({ key: 'REPORTS' });
  });

  it('updates presentation fields without allowing key reassignment', async () => {
    repository.updateIfCurrentStatus.mockResolvedValueOnce(feature({ name: 'Advanced Reports' }));
    await service.update(featureId, { name: 'Advanced Reports' }, actor);
    expect(repository.updateIfCurrentStatus).toHaveBeenCalledWith(featureId, FeatureStatus.ACTIVE, {
      name: 'Advanced Reports',
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: PlatformAuditEventType.FEATURE_UPDATED }),
    );
    await expect(
      service.update(featureId, { key: 'NEW_KEY' } as never, actor),
    ).rejects.toBeInstanceOf(FeatureInputInvalidError);
  });

  it('activates and deactivates Features without removing existing Plan associations', async () => {
    repository.changeStatusIfCurrent.mockResolvedValueOnce(
      feature({ status: FeatureStatus.INACTIVE }),
    );
    await service.changeStatus(featureId, FeatureStatus.INACTIVE, actor);
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: PlatformAuditEventType.FEATURE_DEACTIVATED }),
    );

    repository.findById.mockResolvedValueOnce(feature({ status: FeatureStatus.INACTIVE }));
    repository.changeStatusIfCurrent.mockResolvedValueOnce(feature());
    await service.changeStatus(featureId, FeatureStatus.ACTIVE, actor);
    expect(audit.recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: PlatformAuditEventType.FEATURE_ACTIVATED }),
    );
  });

  it('treats repeated status changes as idempotent and rejects invalid status values', async () => {
    await service.changeStatus(featureId, FeatureStatus.ACTIVE, actor);
    expect(repository.changeStatusIfCurrent).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();

    await expect(
      service.changeStatus(featureId, 'ARCHIVED' as never, actor),
    ).rejects.toBeInstanceOf(FeatureInputInvalidError);
  });

  it('treats a concurrent transition to the requested Feature status as an idempotent success', async () => {
    repository.changeStatusIfCurrent.mockResolvedValueOnce(null);
    repository.findById
      .mockResolvedValueOnce(feature())
      .mockResolvedValueOnce(feature({ status: FeatureStatus.INACTIVE }));

    await expect(
      service.changeStatus(featureId, FeatureStatus.INACTIVE, actor),
    ).resolves.toMatchObject({ status: FeatureStatus.INACTIVE });
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });
});
