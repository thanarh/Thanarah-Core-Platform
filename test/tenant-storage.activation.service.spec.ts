import { Prisma, TenantStorageProvider, TenantStorageTargetStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { MongoTenantPatientStorage } from '../src/tenant/mongo-tenant-patient.storage';
import type { PrismaService } from '../src/database/prisma.service';
import { TenantStorageActivationService } from '../src/tenant/tenant-storage.activation.service';
import { TenantStorageUnavailableError } from '../src/tenant/tenant-storage.errors';
import type { TenantStorageTargetRecord } from '../src/tenant/tenant-storage.registry';

const tenantId = '11111111-1111-4111-8111-111111111111';
const targetId = '44444444-4444-4444-8444-444444444444';
const secondTargetId = '55555555-5555-4555-8555-555555555555';

function makeTarget(
  id: string,
  overrides: Partial<TenantStorageTargetRecord> = {},
): TenantStorageTargetRecord {
  return {
    id,
    tenantId,
    provider: TenantStorageProvider.MONGODB,
    connectionReference: 'primary',
    databaseName: `tenant_${id.slice(0, 4)}`,
    status: TenantStorageTargetStatus.INACTIVE,
    isPrimary: true,
    createdAt: new Date('2026-10-08T00:00:00.000Z'),
    updatedAt: new Date('2026-10-08T00:00:00.000Z'),
    ...overrides,
  };
}

type TargetWhere = Record<string, unknown>;
type MockFunction = ReturnType<typeof vi.fn>;

function matchesTarget(target: TenantStorageTargetRecord, where: TargetWhere): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = target[key as keyof TenantStorageTargetRecord];
    if (expected && typeof expected === 'object' && 'not' in expected) {
      return actual !== (expected as { not: unknown }).not;
    }
    return actual === expected;
  });
}

interface ActivationServiceHarness {
  service: TenantStorageActivationService;
  targets: TenantStorageTargetRecord[];
  rawQueries: unknown[];
  prismaMock: {
    tenantStorageTarget: { findFirst: MockFunction; updateMany: MockFunction };
    $transaction: MockFunction;
  };
  patientStorage: { ensureIndexesForTarget: MockFunction };
  updateMany: MockFunction;
}

function makeActivationService(
  initialTargets: TenantStorageTargetRecord[],
): ActivationServiceHarness {
  const targets = initialTargets.map((target) => ({ ...target }));
  const rawQueries: unknown[] = [];
  let lockTail: Promise<void> = Promise.resolve();

  const findFirst = vi.fn(async ({ where }: { where: TargetWhere }) => {
    const target = targets.find((candidate) => matchesTarget(candidate, where));
    return target ? { ...target } : null;
  });
  const updateMany = vi.fn(
    async ({ where, data }: { where: TargetWhere; data: Partial<TenantStorageTargetRecord> }) => {
      let count = 0;
      for (const target of targets) {
        if (!matchesTarget(target, where)) continue;
        Object.assign(target, data);
        count += 1;
      }
      return { count };
    },
  );
  const delegate = { findFirst, updateMany };
  const prismaMock = {
    tenantStorageTarget: delegate,
    $transaction: vi.fn(
      async (operation: (transaction: unknown) => Promise<unknown>, _options?: unknown) => {
        let releaseLock: (() => void) | undefined;
        const transaction = {
          tenantStorageTarget: delegate,
          $queryRaw: vi.fn(async (query: Prisma.Sql) => {
            rawQueries.push(query);
            const previous = lockTail;
            let release!: () => void;
            const current = new Promise<void>((resolve) => {
              release = resolve;
            });
            lockTail = previous.then(() => current);
            await previous;
            releaseLock = release;
            return [{ id: tenantId }];
          }),
        };

        try {
          return await operation(transaction);
        } finally {
          releaseLock?.();
        }
      },
    ),
  };
  const patientStorage = {
    ensureIndexesForTarget: vi.fn().mockResolvedValue(undefined),
  };
  const service = new TenantStorageActivationService(
    prismaMock as unknown as PrismaService,
    patientStorage as unknown as MongoTenantPatientStorage,
  );

  return { service, targets, prismaMock, patientStorage, rawQueries, updateMany };
}

describe('TenantStorageActivationService', () => {
  it('verifies indexes for the tenant-scoped target before activating it', async () => {
    const target = makeTarget(targetId);
    const harness = makeActivationService([target]);

    await expect(
      harness.service.setTargetStatus(tenantId, targetId, TenantStorageTargetStatus.ACTIVE),
    ).resolves.toMatchObject({ id: targetId, status: TenantStorageTargetStatus.ACTIVE });

    expect(harness.patientStorage.ensureIndexesForTarget).toHaveBeenCalledWith(target);
    expect(harness.patientStorage.ensureIndexesForTarget.mock.invocationCallOrder[0]).toBeLessThan(
      harness.prismaMock.$transaction.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(harness.targets[0]?.status).toBe(TenantStorageTargetStatus.ACTIVE);
    expect(harness.rawQueries).toHaveLength(1);
    expect((harness.rawQueries[0] as { sql: string }).sql).toContain('FOR UPDATE');
    expect((harness.rawQueries[0] as { values: unknown[] }).values).toContain(tenantId);
    expect(harness.prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  });

  it('leaves the target inactive when index creation fails', async () => {
    const harness = makeActivationService([makeTarget(targetId)]);
    harness.patientStorage.ensureIndexesForTarget.mockRejectedValueOnce(
      new TenantStorageUnavailableError(),
    );

    await expect(
      harness.service.setTargetStatus(tenantId, targetId, TenantStorageTargetStatus.ACTIVE),
    ).rejects.toBeInstanceOf(TenantStorageUnavailableError);

    expect(harness.targets[0]?.status).toBe(TenantStorageTargetStatus.INACTIVE);
    expect(harness.prismaMock.$transaction).not.toHaveBeenCalled();
    expect(harness.updateMany).not.toHaveBeenCalled();
  });

  it('leaves the target inactive when post-provisioning index verification fails', async () => {
    const harness = makeActivationService([makeTarget(targetId)]);
    harness.patientStorage.ensureIndexesForTarget.mockRejectedValueOnce(
      new TenantStorageUnavailableError(),
    );

    await expect(
      harness.service.setTargetStatus(tenantId, targetId, TenantStorageTargetStatus.ACTIVE),
    ).rejects.toBeInstanceOf(TenantStorageUnavailableError);

    expect(harness.targets[0]?.status).toBe(TenantStorageTargetStatus.INACTIVE);
    expect(harness.prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('leaves the target inactive when MongoDB is unavailable', async () => {
    const harness = makeActivationService([makeTarget(targetId)]);
    harness.patientStorage.ensureIndexesForTarget.mockRejectedValueOnce(
      new TenantStorageUnavailableError(),
    );

    await expect(
      harness.service.setTargetStatus(tenantId, targetId, TenantStorageTargetStatus.ACTIVE),
    ).rejects.toBeInstanceOf(TenantStorageUnavailableError);

    expect(harness.targets[0]?.status).toBe(TenantStorageTargetStatus.INACTIVE);
    expect(harness.prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('keeps an existing active-primary conflict enforced after index readiness', async () => {
    const candidate = makeTarget(targetId);
    const existing = makeTarget(secondTargetId, {
      status: TenantStorageTargetStatus.ACTIVE,
      isPrimary: true,
    });
    const harness = makeActivationService([candidate, existing]);

    await expect(
      harness.service.setTargetStatus(tenantId, targetId, TenantStorageTargetStatus.ACTIVE),
    ).rejects.toBeInstanceOf(TenantStorageUnavailableError);

    expect(harness.patientStorage.ensureIndexesForTarget).toHaveBeenCalledWith(candidate);
    expect(harness.targets[0]?.status).toBe(TenantStorageTargetStatus.INACTIVE);
    expect(harness.updateMany).not.toHaveBeenCalled();
  });

  it('switches the primary only after verifying the candidate indexes', async () => {
    const previousPrimary = makeTarget(targetId, {
      status: TenantStorageTargetStatus.ACTIVE,
      isPrimary: true,
    });
    const candidate = makeTarget(secondTargetId, {
      status: TenantStorageTargetStatus.ACTIVE,
      isPrimary: false,
    });
    const harness = makeActivationService([previousPrimary, candidate]);

    await expect(harness.service.setPrimaryTarget(tenantId, secondTargetId)).resolves.toMatchObject(
      {
        id: secondTargetId,
        isPrimary: true,
      },
    );

    expect(harness.patientStorage.ensureIndexesForTarget).toHaveBeenCalledWith(candidate);
    expect(harness.patientStorage.ensureIndexesForTarget.mock.invocationCallOrder[0]).toBeLessThan(
      harness.prismaMock.$transaction.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(harness.targets[0]?.isPrimary).toBe(false);
    expect(harness.targets[1]?.isPrimary).toBe(true);
  });

  it('serializes concurrent primary activations for one tenant', async () => {
    const harness = makeActivationService([makeTarget(targetId), makeTarget(secondTargetId)]);

    const results = await Promise.allSettled([
      harness.service.setTargetStatus(tenantId, targetId, TenantStorageTargetStatus.ACTIVE),
      harness.service.setTargetStatus(tenantId, secondTargetId, TenantStorageTargetStatus.ACTIVE),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(TenantStorageUnavailableError);
    }
    expect(
      harness.targets.filter(
        (target) => target.status === TenantStorageTargetStatus.ACTIVE && target.isPrimary,
      ),
    ).toHaveLength(1);
    expect(harness.rawQueries).toHaveLength(2);
  });
});
