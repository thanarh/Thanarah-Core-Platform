import { Prisma, TenantCatalogStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { HealthcareCatalogRepository } from '../src/tenant/healthcare-catalog.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const departmentId = '22222222-2222-4222-8222-222222222222';
const specialtyId = '33333333-3333-4333-8333-333333333333';
const createdAt = new Date('2026-10-07T10:00:00.000Z');

const department = {
  id: departmentId,
  tenantId,
  name: 'Cardiology',
  description: null,
  status: TenantCatalogStatus.ACTIVE,
  statusChangedAt: createdAt,
  suspendedAt: null,
  deactivatedAt: null,
  createdAt,
  updatedAt: createdAt,
};
const specialty = { ...department, id: specialtyId, name: 'Cardiology' };

type MockModel = Record<
  'create' | 'findFirst' | 'findMany' | 'updateMany',
  ReturnType<typeof vi.fn>
>;

const makePrisma = (): {
  tenant: { findFirst: ReturnType<typeof vi.fn> };
  department: MockModel;
  specialty: MockModel;
} => ({
  tenant: { findFirst: vi.fn() },
  department: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  specialty: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
});

const duplicateNameError = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Duplicate tenant catalog name', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('HealthcareCatalogRepository', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repository: HealthcareCatalogRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValue({ id: tenantId });
    repository = new HealthcareCatalogRepository(prisma as unknown as PrismaService);
  });

  it.each([
    ['department', department],
    ['specialty', specialty],
  ] as const)('creates a tenant-owned %s with an optional description', async (kind, record) => {
    const model = kind === 'department' ? prisma.department : prisma.specialty;
    model.create.mockResolvedValue(record);

    const result = await repository.create(kind, tenantId, {
      name: record.name,
      description: 'Clinical division',
    });

    expect(result).toEqual({ kind: 'changed', record });
    expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
      where: { id: tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { tenantId, name: record.name, description: 'Clinical division' },
        select: expect.objectContaining({
          tenantId: true,
          name: true,
          description: true,
          status: true,
        }),
      }),
    );
  });

  it.each([
    ['department', departmentId],
    ['specialty', specialtyId],
  ] as const)('constrains %s reads to the trusted tenant and ID', async (kind, id) => {
    const model = kind === 'department' ? prisma.department : prisma.specialty;
    model.findFirst.mockResolvedValue(null);

    await expect(repository.findById(kind, tenantId, id)).resolves.toBeNull();
    expect(model.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id } }),
    );
    expect(model.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: otherTenantId, id } }),
    );
  });

  it.each([
    ['department', department],
    ['specialty', specialty],
  ] as const)('lists all %s lifecycle states by default with pagination', async (kind, record) => {
    const model = kind === 'department' ? prisma.department : prisma.specialty;
    model.findMany.mockResolvedValue([record]);

    const result = await repository.list(kind, tenantId, { limit: 20, offset: 5 });

    expect(result).toEqual([record]);
    expect(model.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 5,
        take: 20,
      }),
    );
  });

  it('supports administrative lifecycle filtering for both catalogs', async () => {
    prisma.department.findMany.mockResolvedValue([]);
    prisma.specialty.findMany.mockResolvedValue([]);
    const filter = { status: TenantCatalogStatus.SUSPENDED, limit: 10, offset: 0 };

    await repository.list('department', tenantId, filter);
    await repository.list('specialty', tenantId, filter);

    expect(prisma.department.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, status: TenantCatalogStatus.SUSPENDED } }),
    );
    expect(prisma.specialty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, status: TenantCatalogStatus.SUSPENDED } }),
    );
  });

  it.each([
    ['department', department],
    ['specialty', specialty],
  ] as const)('updates only mutable fields on the tenant-owned %s', async (kind, record) => {
    const model = kind === 'department' ? prisma.department : prisma.specialty;
    model.updateMany.mockResolvedValue({ count: 1 });
    model.findFirst.mockResolvedValue(record);

    const result = await repository.update(kind, tenantId, record.id, { description: null });

    expect(result).toEqual({ kind: 'changed', record });
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { tenantId, id: record.id },
      data: { description: null },
    });
  });

  it('uses compare-and-set lifecycle updates and preserves each tenant boundary', async () => {
    prisma.specialty.updateMany.mockResolvedValue({ count: 1 });
    prisma.specialty.findFirst.mockResolvedValue({
      ...specialty,
      status: TenantCatalogStatus.SUSPENDED,
    });
    const changedAt = new Date('2026-10-07T12:00:00.000Z');

    const result = await repository.changeStatusIfCurrent(
      'specialty',
      tenantId,
      specialtyId,
      TenantCatalogStatus.ACTIVE,
      TenantCatalogStatus.SUSPENDED,
      changedAt,
    );

    expect(result.kind).toBe('changed');
    expect(prisma.specialty.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        id: specialtyId,
        status: TenantCatalogStatus.ACTIVE,
      },
      data: expect.objectContaining({
        status: TenantCatalogStatus.SUSPENDED,
        statusChangedAt: changedAt,
        suspendedAt: changedAt,
      }),
    });
  });

  it('reports a concurrent lifecycle change without overwriting it', async () => {
    prisma.department.updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.changeStatusIfCurrent(
      'department',
      tenantId,
      departmentId,
      TenantCatalogStatus.ACTIVE,
      TenantCatalogStatus.DEACTIVATED,
      createdAt,
    );

    expect(result).toEqual({ kind: 'not-changed' });
    expect(prisma.department.findFirst).not.toHaveBeenCalled();
  });

  it('maps duplicate tenant-scoped names to a conflict result on create and update', async () => {
    prisma.department.create.mockRejectedValue(duplicateNameError());
    prisma.specialty.updateMany.mockRejectedValue(duplicateNameError());

    await expect(
      repository.create('department', tenantId, { name: 'Cardiology' }),
    ).resolves.toEqual({ kind: 'name-conflict' });
    await expect(
      repository.update('specialty', tenantId, specialtyId, { name: 'Cardiology' }),
    ).resolves.toEqual({ kind: 'name-conflict' });
  });

  it('does not mutate catalogs when the tenant is inactive', async () => {
    prisma.tenant.findFirst.mockResolvedValue(null);

    await expect(
      repository.create('department', tenantId, { name: 'Cardiology' }),
    ).resolves.toEqual({ kind: 'tenant-inactive' });
    await expect(
      repository.update('specialty', tenantId, specialtyId, { name: 'Cardiology' }),
    ).resolves.toEqual({ kind: 'tenant-inactive' });
    await expect(
      repository.changeStatusIfCurrent(
        'department',
        tenantId,
        departmentId,
        TenantCatalogStatus.ACTIVE,
        TenantCatalogStatus.SUSPENDED,
        createdAt,
      ),
    ).resolves.toEqual({ kind: 'tenant-inactive' });

    expect(prisma.department.create).not.toHaveBeenCalled();
    expect(prisma.specialty.updateMany).not.toHaveBeenCalled();
  });
});
