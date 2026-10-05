import { TenantStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { TenantRepository } from '../src/tenant/tenant.repository';

describe('TenantRepository', () => {
  const prisma = {
    tenant: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const repository = new TenantRepository(prisma as unknown as PrismaService);

  it('creates tenants using only the allowed identity fields', async () => {
    prisma.tenant.create.mockResolvedValue({ id: 'tenant-1' });

    await repository.create({
      slug: 'north-clinic',
      legalName: 'North Health Group',
      displayName: 'North Health',
    });

    expect(prisma.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          slug: 'north-clinic',
          legalName: 'North Health Group',
          displayName: 'North Health',
        },
        select: expect.objectContaining({ id: true, status: true }),
      }),
    );
  });

  it('lists in stable order with bounded pagination and optional status filtering', async () => {
    prisma.tenant.findMany.mockResolvedValue([]);

    await repository.list({ status: TenantStatus.SUSPENDED, limit: 25, offset: 50 });

    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: TenantStatus.SUSPENDED },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 50,
        take: 25,
      }),
    );
  });

  it('uses optimistic status matching to prevent stale lifecycle writes', async () => {
    prisma.tenant.updateMany.mockResolvedValue({ count: 0 });
    const changedAt = new Date('2026-10-05T12:00:00.000Z');

    await expect(
      repository.changeStatusIfCurrent(
        'tenant-1',
        TenantStatus.ACTIVE,
        TenantStatus.DEACTIVATED,
        changedAt,
      ),
    ).resolves.toBeNull();

    expect(prisma.tenant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-1', status: TenantStatus.ACTIVE },
        data: expect.objectContaining({
          status: TenantStatus.DEACTIVATED,
          statusChangedAt: changedAt,
          deactivatedAt: changedAt,
          updatedAt: changedAt,
        }),
      }),
    );
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });
});
