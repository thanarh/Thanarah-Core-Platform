import { PlatformAuditEventType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EncounterService } from '../src/tenant/encounter.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const encounterId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';

function setup() {
  const record = {
    id: encounterId,
    history: [
      {
        id: eventId,
        action: 'CLINICAL_UPDATED',
        actorUserId: actorId,
        occurredAt: new Date(),
        fromVersion: 1,
        toVersion: 2,
        changedFields: ['clinical'],
      },
    ],
  };
  const operation = {
    id: eventId,
    historyEventId: eventId,
    tenantId,
    resourceType: 'encounter',
    resourceId: encounterId,
    operationType: 'CLINICAL_UPDATED',
    actorUserId: actorId,
    auditEventType: PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
    auditMetadata: {
      resourceType: 'encounter',
      encounterId,
      facilityId: '55555555-5555-4555-8555-555555555555',
      action: 'clinical_updated',
      changedFields: 'clinical',
    },
    auditDeliveryStatus: 'FAILED',
    attemptCount: 1,
  };
  const repository = { findById: vi.fn(async () => record) };
  const authorization = { authorize: vi.fn(async () => undefined) };
  const audit = { recordAudit: vi.fn(async () => true) };
  const prisma = {
    encounterOperation: {
      findMany: vi.fn(async () => [operation]),
      findUnique: vi.fn(async () => ({ attemptCount: 1 })),
      updateMany: vi.fn(async (_args: { where: Record<string, unknown> }) => ({ count: 1 })),
    },
  };
  const service = new EncounterService(
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    authorization as never,
    audit as never,
    prisma as never,
  );
  return { service, repository, authorization, audit, prisma, operation, record };
}

describe('Encounter audit operation reconciliation', () => {
  it('delivers only when tenant-scoped Mongo history matches the stored operation identity', async () => {
    const harness = setup();
    const result = await harness.service.reconcileAudit(
      { tenantId, platformUserId: actorId } as never,
      5,
    );

    expect(harness.authorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      'tenant.encounters.audit.reconcile',
    );
    expect(harness.prisma.encounterOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId }), take: 5 }),
    );
    expect(harness.audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId,
        subjectTenantId: tenantId,
        eventType: PlatformAuditEventType.ENCOUNTER_CLINICAL_UPDATED,
      }),
    );
    expect(harness.repository.findById).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      encounterId,
    );
    expect(result.items[0]?.outcome).toBe('AUDIT_DELIVERED_OR_ALREADY_DELIVERED');
  });

  it('requires operator review when persisted event identity does not match the operation', async () => {
    const harness = setup();
    harness.record.history[0]!.action = 'CANCELLED';
    const result = await harness.service.reconcileAudit(
      { tenantId, platformUserId: actorId } as never,
      10_000,
    );

    expect(harness.audit.recordAudit).not.toHaveBeenCalled();
    expect(harness.prisma.encounterOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 }),
    );
    expect(result.items[0]?.outcome).toBe('REQUIRES_OPERATOR_REVIEW');
  });

  it('allows only one concurrent caller to claim a pending operation', async () => {
    const harness = setup();
    let claimed = false;
    harness.prisma.encounterOperation.updateMany.mockImplementation(async (args) => {
      if (typeof args.where.attemptCount === 'number') {
        if (claimed) return { count: 0 };
        claimed = true;
      }
      return { count: 1 };
    });

    const context = { tenantId, platformUserId: actorId } as never;
    const results = await Promise.all([
      harness.service.reconcileAudit(context, 10),
      harness.service.reconcileAudit(context, 10),
    ]);

    expect(harness.audit.recordAudit).toHaveBeenCalledTimes(1);
    expect(results.flatMap((result) => result.items.map((item) => item.outcome))).toContain(
      'REQUIRES_OPERATOR_REVIEW',
    );
  });
});
