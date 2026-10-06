import { PlatformAuditEventType, SubscriptionStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import {
  SubscriptionCurrentConflictError,
  SubscriptionIdInvalidError,
  SubscriptionInputInvalidError,
  SubscriptionInvariantViolationError,
  SubscriptionLifecycleConflictError,
  SubscriptionNotFoundError,
  SubscriptionPlanNotFoundError,
  SubscriptionPlanUnavailableError,
  SubscriptionTenantNotFoundError,
  SubscriptionTenantUnavailableError,
} from '../src/subscriptions/subscription.errors';
import type { CreateSubscriptionInput } from '../src/subscriptions/subscription.dto';
import type {
  CreateSubscriptionResult,
  SubscriptionRecord,
  TransitionSubscriptionResult,
} from '../src/subscriptions/subscription.repository';
import { SubscriptionService } from '../src/subscriptions/subscription.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const subscriptionId = '33333333-3333-4333-8333-333333333333';
const actor: AuthenticatedPlatformUser = {
  userId: '44444444-4444-4444-8444-444444444444',
  sessionId: '55555555-5555-4555-8555-555555555555',
  tokenVersion: 1,
  platformRoleIds: [],
};
const auditContext = {
  requestId: 'request-123',
  ipAddress: '192.0.2.15',
  userAgent: 'Subscription test',
};

function record(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: subscriptionId,
    tenantId,
    planId,
    status: SubscriptionStatus.ACTIVE,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 60_000),
    cancelledAt: null,
    createdAt: new Date(Date.now() - 60_000),
    updatedAt: new Date(Date.now() - 60_000),
    ...overrides,
  };
}

function createInput(overrides: Partial<CreateSubscriptionInput> = {}): CreateSubscriptionInput {
  return {
    tenantId,
    planId,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe('SubscriptionService', () => {
  const subscriptions = {
    createForActiveTenantAndPlan: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    findCurrentForTenant: vi.fn(),
    transition: vi.fn(),
  };
  const audit = { recordAudit: vi.fn() };
  const service = new SubscriptionService(subscriptions as never, audit as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a date-validated ACTIVE assignment without accepting a client lifecycle status', async () => {
    const created = record();
    subscriptions.createForActiveTenantAndPlan.mockResolvedValue({
      kind: 'created',
      subscription: created,
    } satisfies CreateSubscriptionResult);

    const result = await service.create(createInput(), actor, auditContext);

    expect(subscriptions.createForActiveTenantAndPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        planId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: expect.any(Date),
        endsAt: expect.any(Date),
      }),
    );
    expect(result).toMatchObject({ id: subscriptionId, effectiveStatus: 'ACTIVE' });
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: PlatformAuditEventType.SUBSCRIPTION_CREATED,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        subjectTenantId: tenantId,
        requestId: auditContext.requestId,
        metadata: expect.objectContaining({
          subscriptionId,
          tenantId,
          planId,
          status: SubscriptionStatus.ACTIVE,
        }),
      }),
    );
    const metadata = audit.recordAudit.mock.calls[0]?.[0].metadata;
    expect(metadata).not.toHaveProperty('token');
    expect(metadata).not.toHaveProperty('password');
  });

  it('derives EXPIRED for a new record whose period has already ended', async () => {
    const historical = record({
      status: SubscriptionStatus.EXPIRED,
      startsAt: new Date('2025-01-01T00:00:00.000Z'),
      endsAt: new Date('2025-02-01T00:00:00.000Z'),
    });
    subscriptions.createForActiveTenantAndPlan.mockResolvedValue({
      kind: 'created',
      subscription: historical,
    } satisfies CreateSubscriptionResult);

    const result = await service.create(
      {
        tenantId,
        planId,
        startsAt: '2025-01-01T00:00:00.000Z',
        endsAt: '2025-02-01T00:00:00.000Z',
      },
      actor,
    );

    expect(subscriptions.createForActiveTenantAndPlan).toHaveBeenCalledWith(
      expect.objectContaining({ status: SubscriptionStatus.EXPIRED }),
    );
    expect(result.effectiveStatus).toBe('EXPIRED');
  });

  it('rejects client-controlled status and unknown body fields before repository access', async () => {
    await expect(
      service.create({ ...createInput(), status: 'ACTIVE' } as never, actor),
    ).rejects.toBeInstanceOf(SubscriptionInputInvalidError);
    expect(subscriptions.createForActiveTenantAndPlan).not.toHaveBeenCalled();
  });

  it('requires UTC date-time inputs and rejects end dates before the start', async () => {
    await expect(
      service.create(createInput({ startsAt: '2026-10-06T12:00:00+03:00' }), actor),
    ).rejects.toBeInstanceOf(SubscriptionInputInvalidError);
    await expect(
      service.create(
        createInput({
          startsAt: '2026-10-08T00:00:00.000Z',
          endsAt: '2026-10-07T00:00:00.000Z',
        }),
        actor,
      ),
    ).rejects.toBeInstanceOf(SubscriptionInputInvalidError);
    expect(subscriptions.createForActiveTenantAndPlan).not.toHaveBeenCalled();
  });

  it.each([
    ['tenant-not-found', SubscriptionTenantNotFoundError],
    ['tenant-unavailable', SubscriptionTenantUnavailableError],
    ['plan-not-found', SubscriptionPlanNotFoundError],
    ['plan-unavailable', SubscriptionPlanUnavailableError],
    ['period-conflict', SubscriptionCurrentConflictError],
  ] as const)('maps create result %s to a safe domain error without audit', async (kind, error) => {
    subscriptions.createForActiveTenantAndPlan.mockResolvedValue({
      kind,
    } as CreateSubscriptionResult);

    await expect(service.create(createInput(), actor)).rejects.toBeInstanceOf(error);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('lists history by tenant/status and reports period-derived effective states', async () => {
    subscriptions.list.mockResolvedValue([
      record({
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date('2025-01-01T00:00:00.000Z'),
        endsAt: new Date('2025-02-01T00:00:00.000Z'),
      }),
    ]);

    const result = await service.list({
      tenantId,
      status: SubscriptionStatus.ACTIVE,
      limit: 20,
      offset: 5,
    });

    expect(subscriptions.list).toHaveBeenCalledWith({
      tenantId,
      status: SubscriptionStatus.ACTIVE,
      limit: 20,
      offset: 5,
    });
    expect(result).toMatchObject({
      limit: 20,
      offset: 5,
      items: [{ status: SubscriptionStatus.ACTIVE, effectiveStatus: 'EXPIRED' }],
    });
  });

  it('validates subscription IDs and distinguishes missing records', async () => {
    await expect(service.findById('not-a-uuid')).rejects.toBeInstanceOf(SubscriptionIdInvalidError);
    subscriptions.findById.mockResolvedValue(null);
    await expect(service.findById(subscriptionId)).rejects.toBeInstanceOf(
      SubscriptionNotFoundError,
    );
    expect(subscriptions.findById).toHaveBeenCalledOnce();
  });

  it('returns null when no current record exists and scopes lookup to a valid Tenant UUID', async () => {
    subscriptions.findCurrentForTenant.mockResolvedValue([]);

    await expect(service.findCurrentForTenant(tenantId)).resolves.toBeNull();
    expect(subscriptions.findCurrentForTenant).toHaveBeenCalledWith(tenantId, expect.any(Date));
    await expect(service.findCurrentForTenant('not-a-uuid')).rejects.toBeInstanceOf(
      SubscriptionInputInvalidError,
    );
  });

  it('returns exactly one current period and fails closed on contradictory database state', async () => {
    subscriptions.findCurrentForTenant.mockResolvedValue([record()]);
    await expect(service.findCurrentForTenant(tenantId)).resolves.toMatchObject({
      id: subscriptionId,
      effectiveStatus: 'ACTIVE',
    });

    subscriptions.findCurrentForTenant.mockResolvedValue([
      record(),
      record({ id: '66666666-6666-4666-8666-666666666666' }),
    ]);
    await expect(service.findCurrentForTenant(tenantId)).rejects.toBeInstanceOf(
      SubscriptionInvariantViolationError,
    );
  });

  it.each([
    ['activate', SubscriptionStatus.ACTIVE, PlatformAuditEventType.SUBSCRIPTION_ACTIVATED],
    ['suspend', SubscriptionStatus.SUSPENDED, PlatformAuditEventType.SUBSCRIPTION_SUSPENDED],
    ['cancel', SubscriptionStatus.CANCELLED, PlatformAuditEventType.SUBSCRIPTION_CANCELLED],
    ['expire', SubscriptionStatus.EXPIRED, PlatformAuditEventType.SUBSCRIPTION_EXPIRED],
  ] as const)(
    'audits %s with the authenticated actor and previous/new lifecycle states',
    async (action, nextStatus, eventType) => {
      subscriptions.transition.mockResolvedValue({
        kind: 'updated',
        subscription: record({ status: nextStatus }),
        previousStatus: SubscriptionStatus.ACTIVE,
      } satisfies TransitionSubscriptionResult);

      const result = await service[action](subscriptionId, actor, auditContext);

      expect(result.status).toBe(nextStatus);
      expect(audit.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType,
          actorUserId: actor.userId,
          sessionId: actor.sessionId,
          subjectTenantId: tenantId,
          requestId: auditContext.requestId,
          metadata: expect.objectContaining({
            subscriptionId,
            tenantId,
            planId,
            previousStatus: SubscriptionStatus.ACTIVE,
            newStatus: nextStatus,
          }),
        }),
      );
    },
  );

  it('maps lifecycle conflicts and missing records without writing audit events', async () => {
    const cases: Array<[TransitionSubscriptionResult, new () => Error]> = [
      [{ kind: 'not-found' }, SubscriptionNotFoundError],
      [{ kind: 'tenant-unavailable' }, SubscriptionTenantUnavailableError],
      [{ kind: 'period-conflict' }, SubscriptionCurrentConflictError],
      [{ kind: 'transition-invalid' }, SubscriptionLifecycleConflictError],
    ];
    for (const [result, error] of cases) {
      subscriptions.transition.mockResolvedValueOnce(result);
      await expect(service.activate(subscriptionId, actor)).rejects.toBeInstanceOf(error);
    }
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('uses a stable 400 error for invalid subscription list filters', async () => {
    await expect(service.list({ status: 'PAST_DUE' } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
