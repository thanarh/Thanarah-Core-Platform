import { TenantStorageProvider, TenantStorageTargetStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import { TenantStorageUnavailableError } from '../src/tenant/tenant-storage.errors';
import { TenantStorageRegistryService } from '../src/tenant/tenant-storage.registry';
import type { TenantStorageTargetRecord } from '../src/tenant/tenant-storage.registry';
import type { PrismaService } from '../src/database/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const targetId = '44444444-4444-4444-8444-444444444444';
const context = {
  tenantId,
  membershipId: '22222222-2222-4222-8222-222222222222',
  platformUserId: '33333333-3333-4333-8333-333333333333',
} as TrustedTenantContext;

function makeTarget(overrides: Partial<TenantStorageTargetRecord> = {}): TenantStorageTargetRecord {
  return {
    id: targetId,
    tenantId,
    provider: TenantStorageProvider.MONGODB,
    connectionReference: 'primary',
    databaseName: 'tenant_alpha',
    status: TenantStorageTargetStatus.ACTIVE,
    isPrimary: true,
    createdAt: new Date('2026-10-08T00:00:00.000Z'),
    updatedAt: new Date('2026-10-08T00:00:00.000Z'),
    ...overrides,
  };
}

interface RegistryDelegate {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
}

function makeRegistry(): { registry: TenantStorageRegistryService; delegate: RegistryDelegate } {
  const delegate = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  };
  const transaction = { tenantStorageTarget: delegate };
  const prismaMock = {
    tenantStorageTarget: delegate,
    $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) =>
      operation(transaction),
    ),
  };
  return {
    registry: new TenantStorageRegistryService(prismaMock as unknown as PrismaService),
    delegate,
  };
}

describe('TenantStorageRegistryService', () => {
  it('resolves only the active primary target within the trusted tenant scope', async () => {
    const { registry, delegate } = makeRegistry();
    delegate.findMany.mockResolvedValue([{ id: targetId }]);

    await expect(registry.getPlacements(context)).resolves.toEqual([{ placementId: targetId }]);
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          provider: TenantStorageProvider.MONGODB,
          status: TenantStorageTargetStatus.ACTIVE,
          isPrimary: true,
        },
        take: 2,
        select: { id: true },
      }),
    );
  });

  it('fails closed if registry state contains multiple active primary targets', async () => {
    const { registry, delegate } = makeRegistry();
    delegate.findMany.mockResolvedValue([
      { id: targetId },
      { id: '55555555-5555-4555-8555-555555555555' },
    ]);

    await expect(registry.getPlacements(context)).rejects.toBeInstanceOf(
      TenantStorageUnavailableError,
    );
  });

  it('scopes physical target lookup by tenant, active status, provider, and primary flag', async () => {
    const { registry, delegate } = makeRegistry();
    const target = makeTarget();
    delegate.findFirst.mockResolvedValue(target);

    await expect(registry.findActivePrimaryTarget(context, targetId)).resolves.toEqual(target);
    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: targetId,
          tenantId,
          provider: TenantStorageProvider.MONGODB,
          status: TenantStorageTargetStatus.ACTIVE,
          isPrimary: true,
        },
      }),
    );

    await expect(registry.findActivePrimaryTarget(context, 'not-a-target-id')).resolves.toBeNull();
  });

  it('registers target metadata inactive with an alias instead of a URI', async () => {
    const { registry, delegate } = makeRegistry();
    delegate.create.mockResolvedValue(makeTarget({ status: TenantStorageTargetStatus.INACTIVE }));

    await registry.registerTarget(tenantId, 'tenant_alpha');

    expect(delegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tenantId,
          provider: TenantStorageProvider.MONGODB,
          connectionReference: 'primary',
          databaseName: 'tenant_alpha',
          status: TenantStorageTargetStatus.INACTIVE,
          isPrimary: false,
        },
      }),
    );
    expect(JSON.stringify(delegate.create.mock.calls[0])).not.toMatch(/mongodb:\/\//iu);
  });

  it('rejects system database names during registration', async () => {
    const { registry, delegate } = makeRegistry();

    expect(() => registry.registerTarget(tenantId, 'admin')).toThrow(
      /Invalid tenant storage database name/u,
    );
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('activates a registered target only when no other active primary exists', async () => {
    const { registry, delegate } = makeRegistry();
    const inactivePrimary = makeTarget({ status: TenantStorageTargetStatus.INACTIVE });
    const activePrimary = makeTarget();
    delegate.findFirst
      .mockResolvedValueOnce(inactivePrimary)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activePrimary);
    delegate.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      registry.setTargetStatus(tenantId, targetId, TenantStorageTargetStatus.ACTIVE),
    ).resolves.toEqual(activePrimary);
    expect(delegate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: targetId, tenantId },
        data: { status: TenantStorageTargetStatus.ACTIVE, updatedAt: expect.any(Date) },
      }),
    );
  });

  it('rejects activation when another active primary is already registered', async () => {
    const { registry, delegate } = makeRegistry();
    delegate.findFirst
      .mockResolvedValueOnce(makeTarget({ status: TenantStorageTargetStatus.INACTIVE }))
      .mockResolvedValueOnce({ id: '55555555-5555-4555-8555-555555555555' });

    await expect(
      registry.setTargetStatus(tenantId, targetId, TenantStorageTargetStatus.ACTIVE),
    ).rejects.toBeInstanceOf(TenantStorageUnavailableError);
    expect(delegate.updateMany).not.toHaveBeenCalled();
  });

  it('switches the primary among active targets without deleting registry history', async () => {
    const { registry, delegate } = makeRegistry();
    const activeTarget = makeTarget({ isPrimary: false });
    delegate.findFirst.mockResolvedValueOnce({ id: targetId }).mockResolvedValueOnce(activeTarget);
    delegate.updateMany.mockResolvedValue({ count: 1 });

    await expect(registry.setPrimaryTarget(tenantId, targetId)).resolves.toEqual(activeTarget);
    expect(delegate.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          tenantId,
          status: TenantStorageTargetStatus.ACTIVE,
          isPrimary: true,
          id: { not: targetId },
        },
        data: { isPrimary: false, updatedAt: expect.any(Date) },
      }),
    );
    expect(delegate.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: targetId, tenantId, status: TenantStorageTargetStatus.ACTIVE },
        data: { isPrimary: true, updatedAt: expect.any(Date) },
      }),
    );
  });

  it('does not query the registry for malformed trusted context', async () => {
    const { registry, delegate } = makeRegistry();

    await expect(
      registry.getPlacements({ tenantId: 'client-selected' } as TrustedTenantContext),
    ).rejects.toThrow();
    expect(delegate.findMany).not.toHaveBeenCalled();
  });
});
