import { Prisma, TenantCatalogStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { ServiceCatalogRepository } from '../src/tenant/service-catalog.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const serviceId = '22222222-2222-4222-8222-222222222222';
const createdAt = new Date('2026-10-07T10:00:00.000Z');

const serviceRecord = {
  id: serviceId,
  name: 'Consultation',
  code: 'CONS-01',
  description: 'General consultation',
  status: TenantCatalogStatus.ACTIVE,
  statusChangedAt: createdAt,
  suspendedAt: null,
  deactivatedAt: null,
  createdAt,
  updatedAt: createdAt,
};

const duplicateError = (target: string[]): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Duplicate tenant service field', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });

function makePrisma(): {
  tenant: { findFirst: ReturnType<typeof vi.fn> };
  service: {
    create: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
} {
  return {
    tenant: { findFirst: vi.fn() },
    service: {
      create: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe('ServiceCatalogRepository', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repository: ServiceCatalogRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValue({ id: tenantId });
    repository = new ServiceCatalogRepository(prisma as unknown as PrismaService);
  });

  it('creates a service with tenant-owned optional code and description', async () => {
    prisma.service.create.mockResolvedValue(serviceRecord);

    await expect(
      repository.create(tenantId, {
        name: 'Consultation',
        code: 'CONS-01',
        description: 'General consultation',
      }),
    ).resolves.toEqual({ kind: 'changed', record: serviceRecord });
    expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
      where: { id: tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    expect(prisma.service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tenantId,
          name: 'Consultation',
          code: 'CONS-01',
          description: 'General consultation',
        },
        select: expect.objectContaining({
          name: true,
          code: true,
          description: true,
          status: true,
        }),
      }),
    );
  });

  it('allows equal names and codes when they belong to different tenants', async () => {
    prisma.service.create.mockResolvedValueOnce(serviceRecord).mockResolvedValueOnce(serviceRecord);

    await expect(
      repository.create(tenantId, { name: 'Consultation', code: 'CONS-01' }),
    ).resolves.toMatchObject({ kind: 'changed' });
    await expect(
      repository.create(otherTenantId, { name: 'Consultation', code: 'CONS-01' }),
    ).resolves.toMatchObject({ kind: 'changed' });
    expect(prisma.service.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: expect.objectContaining({ tenantId }) }),
    );
    expect(prisma.service.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ tenantId: otherTenantId }) }),
    );
  });

  it('constrains reads and lists to the trusted tenant', async () => {
    prisma.service.findFirst.mockResolvedValue(null);
    prisma.service.findMany.mockResolvedValue([serviceRecord]);
    prisma.service.count.mockResolvedValue(1);

    await expect(repository.findById(tenantId, serviceId)).resolves.toBeNull();
    expect(prisma.service.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: serviceId } }),
    );
    await expect(repository.list(tenantId, { limit: 20, offset: 5 })).resolves.toEqual({
      items: [serviceRecord],
      total: 1,
    });
    expect(prisma.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 5,
        take: 20,
      }),
    );
    expect(prisma.service.count).toHaveBeenCalledWith({ where: { tenantId } });
    expect(prisma.service.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: otherTenantId, id: serviceId } }),
    );
  });

  it.each([
    TenantCatalogStatus.ACTIVE,
    TenantCatalogStatus.SUSPENDED,
    TenantCatalogStatus.DEACTIVATED,
  ])('applies the %s lifecycle filter to rows and total count', async (status) => {
    prisma.service.findMany.mockResolvedValue([]);
    prisma.service.count.mockResolvedValue(0);

    await repository.list(tenantId, {
      status,
      limit: 10,
      offset: 0,
    });
    expect(prisma.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, status },
      }),
    );
    expect(prisma.service.count).toHaveBeenCalledWith({ where: { tenantId, status } });
  });

  it('updates only supplied fields for the tenant-owned service', async () => {
    prisma.service.updateMany.mockResolvedValue({ count: 1 });
    prisma.service.findFirst.mockResolvedValue(serviceRecord);

    await expect(
      repository.update(tenantId, serviceId, { code: null, description: null }),
    ).resolves.toEqual({ kind: 'changed', record: serviceRecord });
    expect(prisma.service.updateMany).toHaveBeenCalledWith({
      where: { tenantId, id: serviceId },
      data: { code: null, description: null },
    });
  });

  it('uses tenant-qualified compare-and-set lifecycle updates', async () => {
    const suspended = { ...serviceRecord, status: TenantCatalogStatus.SUSPENDED };
    prisma.service.updateMany.mockResolvedValue({ count: 1 });
    prisma.service.findFirst.mockResolvedValue(suspended);
    const changedAt = new Date('2026-10-07T12:00:00.000Z');

    await expect(
      repository.changeStatusIfCurrent(
        tenantId,
        serviceId,
        TenantCatalogStatus.ACTIVE,
        TenantCatalogStatus.SUSPENDED,
        changedAt,
      ),
    ).resolves.toEqual({ kind: 'changed', record: suspended });
    expect(prisma.service.updateMany).toHaveBeenCalledWith({
      where: { tenantId, id: serviceId, status: TenantCatalogStatus.ACTIVE },
      data: expect.objectContaining({
        status: TenantCatalogStatus.SUSPENDED,
        statusChangedAt: changedAt,
        suspendedAt: changedAt,
      }),
    });
  });

  it('reports a concurrent lifecycle change without overwriting it', async () => {
    prisma.service.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.changeStatusIfCurrent(
        tenantId,
        serviceId,
        TenantCatalogStatus.ACTIVE,
        TenantCatalogStatus.DEACTIVATED,
        createdAt,
      ),
    ).resolves.toEqual({ kind: 'not-changed' });
    expect(prisma.service.findFirst).not.toHaveBeenCalled();
  });

  it('maps duplicate tenant names and codes to distinct conflicts', async () => {
    prisma.service.create
      .mockRejectedValueOnce(duplicateError(['tenantId', 'name']))
      .mockRejectedValueOnce(duplicateError(['tenantId', 'code']));
    prisma.service.updateMany.mockRejectedValueOnce(duplicateError(['tenantId', 'code']));

    await expect(repository.create(tenantId, { name: 'Consultation' })).resolves.toEqual({
      kind: 'name-conflict',
    });
    await expect(
      repository.create(tenantId, { name: 'Follow-up', code: 'CONS-01' }),
    ).resolves.toEqual({ kind: 'code-conflict' });
    await expect(repository.update(tenantId, serviceId, { code: 'CONS-01' })).resolves.toEqual({
      kind: 'code-conflict',
    });
  });

  it('does not mutate services when their tenant is inactive', async () => {
    prisma.tenant.findFirst.mockResolvedValue(null);

    await expect(repository.create(tenantId, { name: 'Consultation' })).resolves.toEqual({
      kind: 'tenant-inactive',
    });
    await expect(repository.update(tenantId, serviceId, { name: 'Changed' })).resolves.toEqual({
      kind: 'tenant-inactive',
    });
    await expect(
      repository.changeStatusIfCurrent(
        tenantId,
        serviceId,
        TenantCatalogStatus.ACTIVE,
        TenantCatalogStatus.SUSPENDED,
        createdAt,
      ),
    ).resolves.toEqual({ kind: 'tenant-inactive' });
    expect(prisma.service.create).not.toHaveBeenCalled();
    expect(prisma.service.updateMany).not.toHaveBeenCalled();
  });
});
