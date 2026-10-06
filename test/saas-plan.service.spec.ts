import { FeatureStatus, PlanStatus, PlatformAuditEventType, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import {
  FeatureNotFoundError,
  PlanFeatureConflictError,
  PlanFeatureNotFoundError,
  PlanInputInvalidError,
  PlanKeyConflictError,
  PlanLifecycleConflictError,
  PlanNotFoundError,
} from '../src/platform-catalog/catalog.errors';
import type { FeatureRecord, FeatureRepository } from '../src/platform-catalog/feature.repository';
import type {
  PlanFeatureRecord,
  PlanRecord,
  PlanRepository,
} from '../src/platform-catalog/plan.repository';
import { PlanService } from '../src/platform-catalog/plan.service';

const planId = 'a3551110-e8a8-4f93-91d8-f0e9e0ff1bd9';
const featureId = 'b04407f4-5b8b-46f4-8e16-8c72def449f2';
const now = new Date('2026-10-06T10:00:00.000Z');
const actor: AuthenticatedPlatformUser = {
  userId: 'trusted-platform-user',
  sessionId: 'trusted-platform-session',
  tokenVersion: 1,
  platformRoleIds: [],
};

function plan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: planId,
    key: 'PRO',
    name: 'Professional',
    description: null,
    status: PlanStatus.ACTIVE,
    statusChangedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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

function association(overrides: Partial<PlanFeatureRecord> = {}): PlanFeatureRecord {
  return {
    planId,
    featureId,
    enabled: true,
    quotaLimits: null,
    createdAt: now,
    updatedAt: now,
    feature: feature(),
    ...overrides,
  } as PlanFeatureRecord;
}

describe('PlanService', () => {
  const plans = {
    create: vi.fn(),
    findById: vi.fn(),
    findByKey: vi.fn(),
    list: vi.fn(),
    updateIfCurrentStatus: vi.fn(),
    changeStatusIfCurrent: vi.fn(),
    findPlanFeature: vi.fn(),
    listFeatures: vi.fn(),
    attachFeature: vi.fn(),
    updateFeatureConfiguration: vi.fn(),
    detachFeature: vi.fn(),
  };
  const features = { findById: vi.fn() };
  const audit = { recordAudit: vi.fn() };
  let service: PlanService;

  beforeEach(() => {
    vi.clearAllMocks();
    plans.create.mockResolvedValue(plan());
    plans.findById.mockResolvedValue(plan());
    plans.findByKey.mockResolvedValue(null);
    plans.list.mockResolvedValue([]);
    plans.updateIfCurrentStatus.mockResolvedValue(plan());
    plans.changeStatusIfCurrent.mockResolvedValue(plan({ status: PlanStatus.INACTIVE }));
    plans.findPlanFeature.mockResolvedValue(null);
    plans.listFeatures.mockResolvedValue([]);
    plans.attachFeature.mockResolvedValue(association());
    plans.updateFeatureConfiguration.mockResolvedValue(association({ enabled: false }));
    plans.detachFeature.mockResolvedValue(true);
    features.findById.mockResolvedValue(feature());
    audit.recordAudit.mockResolvedValue(undefined);
    service = new PlanService(
      plans as unknown as PlanRepository,
      features as unknown as FeatureRepository,
      audit as unknown as PlatformAuditService,
    );
  });

  it('normalizes and creates a reusable Plan with trusted actor audit attribution', async () => {
    await service.create({ key: ' pro ', name: '  Pro   Plan  ' }, actor, {
      requestId: 'request-1',
    });

    expect(plans.create).toHaveBeenCalledWith({ key: 'PRO', name: 'Pro Plan' });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.PLAN_CREATED,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        requestId: 'request-1',
        metadata: { planId, planKey: 'PRO', status: PlanStatus.ACTIVE },
      }),
    );
    expect(JSON.stringify(audit.recordAudit.mock.calls[0][0])).not.toMatch(
      /password|access.?token|refresh.?token|authorization|cookie|secret|DATABASE_URL/i,
    );
  });

  it('rejects invalid Plan keys and duplicate keys before persistence', async () => {
    await expect(service.create({ key: 'bad-key', name: 'Bad' }, actor)).rejects.toBeInstanceOf(
      PlanInputInvalidError,
    );
    plans.findByKey.mockResolvedValueOnce(plan());
    await expect(service.create({ key: 'PRO', name: 'Pro' }, actor)).rejects.toBeInstanceOf(
      PlanKeyConflictError,
    );
    expect(plans.create).not.toHaveBeenCalled();
  });

  it('maps concurrent unique Plan key collisions to a stable conflict', async () => {
    plans.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.create({ key: 'PRO', name: 'Pro' }, actor)).rejects.toBeInstanceOf(
      PlanKeyConflictError,
    );
  });

  it('validates list filters and returns bounded pagination', async () => {
    await service.list({ status: PlanStatus.INACTIVE, limit: 20, offset: 10 });

    expect(plans.list).toHaveBeenCalledWith({
      status: PlanStatus.INACTIVE,
      limit: 20,
      offset: 10,
    });
    await expect(service.list({ limit: 1000, offset: 0 })).rejects.toBeInstanceOf(
      PlanInputInvalidError,
    );
  });

  it('returns a Plan and distinguishes malformed and missing identifiers', async () => {
    await expect(service.findById('not-a-uuid')).rejects.toMatchObject({
      response: { code: 'PLAN_ID_INVALID' },
    });
    plans.findById.mockResolvedValueOnce(null);
    await expect(service.findById(planId)).rejects.toBeInstanceOf(PlanNotFoundError);
    plans.findById.mockResolvedValueOnce(plan());
    await expect(service.findById(planId)).resolves.toMatchObject({ id: planId });
  });

  it('updates only presentation fields, keeps the key immutable, and audits changes', async () => {
    plans.updateIfCurrentStatus.mockResolvedValueOnce(plan({ name: 'Professional Plus' }));
    await service.update(planId, { name: 'Professional Plus' }, actor);

    expect(plans.updateIfCurrentStatus).toHaveBeenCalledWith(planId, PlanStatus.ACTIVE, {
      name: 'Professional Plus',
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.PLAN_UPDATED,
        actorUserId: actor.userId,
        metadata: {
          planId,
          planKey: 'PRO',
          changedFields: 'name',
        },
      }),
    );
    await expect(service.update(planId, { key: 'OTHER' } as never, actor)).rejects.toBeInstanceOf(
      PlanInputInvalidError,
    );
  });

  it('does not write an audit event for an unchanged Plan update', async () => {
    await service.update(planId, { name: 'Professional' }, actor);

    expect(plans.updateIfCurrentStatus).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects metadata changes to an archived Plan', async () => {
    plans.findById.mockResolvedValueOnce(plan({ status: PlanStatus.ARCHIVED }));

    await expect(service.update(planId, { name: 'Renamed' }, actor)).rejects.toBeInstanceOf(
      PlanLifecycleConflictError,
    );
    expect(plans.updateIfCurrentStatus).not.toHaveBeenCalled();
  });

  it('allows ACTIVE to INACTIVE and INACTIVE to ARCHIVED with distinct audit events', async () => {
    plans.changeStatusIfCurrent
      .mockResolvedValueOnce(plan({ status: PlanStatus.INACTIVE }))
      .mockResolvedValueOnce(plan({ status: PlanStatus.ARCHIVED }));

    await service.changeStatus(planId, PlanStatus.INACTIVE, actor);
    plans.findById.mockResolvedValueOnce(plan({ status: PlanStatus.INACTIVE }));
    await service.changeStatus(planId, PlanStatus.ARCHIVED, actor);

    expect(audit.recordAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ eventType: PlatformAuditEventType.PLAN_DEACTIVATED }),
    );
    expect(audit.recordAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ eventType: PlatformAuditEventType.PLAN_ARCHIVED }),
    );
  });

  it('allows reactivation from INACTIVE and keeps ARCHIVED terminal', async () => {
    plans.findById.mockResolvedValueOnce(plan({ status: PlanStatus.INACTIVE }));
    plans.changeStatusIfCurrent.mockResolvedValueOnce(plan({ status: PlanStatus.ACTIVE }));
    await service.changeStatus(planId, PlanStatus.ACTIVE, actor);
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: PlatformAuditEventType.PLAN_ACTIVATED }),
    );

    plans.findById.mockResolvedValueOnce(plan({ status: PlanStatus.ARCHIVED }));
    await expect(service.changeStatus(planId, PlanStatus.ACTIVE, actor)).rejects.toBeInstanceOf(
      PlanLifecycleConflictError,
    );
  });

  it('treats repeated lifecycle transitions as a no-op and rejects invalid transitions', async () => {
    await service.changeStatus(planId, PlanStatus.ACTIVE, actor);
    expect(plans.changeStatusIfCurrent).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();

    plans.findById.mockResolvedValueOnce(plan({ status: PlanStatus.ARCHIVED }));
    await expect(service.changeStatus(planId, PlanStatus.INACTIVE, actor)).rejects.toBeInstanceOf(
      PlanLifecycleConflictError,
    );
  });

  it('blocks stale concurrent lifecycle transitions', async () => {
    plans.changeStatusIfCurrent.mockResolvedValueOnce(null);
    plans.findById
      .mockResolvedValueOnce(plan())
      .mockResolvedValueOnce(plan({ status: PlanStatus.ARCHIVED }));

    await expect(service.changeStatus(planId, PlanStatus.INACTIVE, actor)).rejects.toBeInstanceOf(
      PlanLifecycleConflictError,
    );
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('lists Plan Features only after confirming the Plan exists', async () => {
    plans.listFeatures.mockResolvedValueOnce([association()]);
    await expect(service.listFeatures(planId)).resolves.toHaveLength(1);
    expect(plans.listFeatures).toHaveBeenCalledWith(planId);

    plans.findById.mockResolvedValueOnce(null);
    await expect(service.listFeatures(planId)).rejects.toBeInstanceOf(PlanNotFoundError);
  });

  it('attaches only active Features to active Plans and rejects duplicate relationships', async () => {
    await service.attachFeature(planId, featureId, actor);
    expect(plans.attachFeature).toHaveBeenCalledWith(planId, featureId);
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.PLAN_FEATURE_ATTACHED,
        actorUserId: actor.userId,
        metadata: expect.objectContaining({ planId, featureId, enabled: true }),
      }),
    );

    plans.findPlanFeature.mockResolvedValueOnce(association());
    await expect(service.attachFeature(planId, featureId, actor)).rejects.toBeInstanceOf(
      PlanFeatureConflictError,
    );

    features.findById.mockResolvedValueOnce(feature({ status: FeatureStatus.INACTIVE }));
    await expect(service.attachFeature(planId, featureId, actor)).rejects.toBeInstanceOf(
      PlanFeatureConflictError,
    );
  });

  it('rejects nonexistent Plans and concurrent duplicate Plan Feature associations', async () => {
    plans.findById.mockResolvedValueOnce(null);
    await expect(service.attachFeature(planId, featureId, actor)).rejects.toBeInstanceOf(
      PlanNotFoundError,
    );

    plans.attachFeature.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(service.attachFeature(planId, featureId, actor)).rejects.toBeInstanceOf(
      PlanFeatureConflictError,
    );
  });

  it('does not associate Features with inactive or archived Plans', async () => {
    plans.findById.mockResolvedValueOnce(plan({ status: PlanStatus.INACTIVE }));
    await expect(service.attachFeature(planId, featureId, actor)).rejects.toBeInstanceOf(
      PlanLifecycleConflictError,
    );
    plans.findById.mockResolvedValueOnce(plan({ status: PlanStatus.ARCHIVED }));
    await expect(service.attachFeature(planId, featureId, actor)).rejects.toBeInstanceOf(
      PlanLifecycleConflictError,
    );
    expect(plans.attachFeature).not.toHaveBeenCalled();
  });

  it('updates enabled state or quota definitions and prevents re-enabling an inactive Feature', async () => {
    plans.findPlanFeature.mockResolvedValueOnce(association());
    plans.updateFeatureConfiguration.mockResolvedValueOnce(association({ enabled: false }));
    await service.updateFeature(planId, featureId, { enabled: false }, actor);
    expect(plans.updateFeatureConfiguration).toHaveBeenCalledWith(planId, featureId, {
      enabled: false,
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: PlatformAuditEventType.PLAN_FEATURE_UPDATED }),
    );

    plans.findPlanFeature.mockResolvedValueOnce(association());
    plans.updateFeatureConfiguration.mockResolvedValueOnce(
      association({ quotaLimits: { BRANCHES: { type: 'COUNT', max: 7 } } }),
    );
    await service.updateFeature(
      planId,
      featureId,
      { quotaLimits: { BRANCHES: { type: 'COUNT', max: 7 } } },
      actor,
    );
    expect(plans.updateFeatureConfiguration).toHaveBeenLastCalledWith(planId, featureId, {
      quotaLimits: { BRANCHES: { type: 'COUNT', max: 7 } },
    });
    expect(audit.recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.PLAN_FEATURE_UPDATED,
        metadata: expect.objectContaining({ quotaResourceKeys: ['BRANCHES'] }),
      }),
    );

    plans.findPlanFeature.mockResolvedValueOnce(association({ enabled: false }));
    features.findById.mockResolvedValueOnce(feature({ status: FeatureStatus.INACTIVE }));
    await expect(
      service.updateFeature(planId, featureId, { enabled: true }, actor),
    ).rejects.toBeInstanceOf(PlanFeatureConflictError);
  });

  it('removes only an existing relationship and audits its trusted actor', async () => {
    plans.findPlanFeature.mockResolvedValueOnce(association());
    await expect(service.detachFeature(planId, featureId, actor)).resolves.toEqual({
      detached: true,
    });
    expect(plans.detachFeature).toHaveBeenCalledWith(planId, featureId);
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.PLAN_FEATURE_DETACHED,
        actorUserId: actor.userId,
        metadata: expect.objectContaining({ planId, featureId, wasEnabled: true }),
      }),
    );

    plans.findPlanFeature.mockResolvedValueOnce(null);
    await expect(service.detachFeature(planId, featureId, actor)).rejects.toBeInstanceOf(
      PlanFeatureNotFoundError,
    );
    features.findById.mockResolvedValueOnce(null);
    await expect(service.attachFeature(planId, featureId, actor)).rejects.toBeInstanceOf(
      FeatureNotFoundError,
    );
  });
});
