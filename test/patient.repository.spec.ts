import { PatientStatus, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { PatientRepository } from '../src/tenant/patient.repository';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const patientId = '22222222-2222-4222-8222-222222222222';
const createdAt = new Date('2026-10-07T10:00:00.000Z');

const patientRecord = {
  id: patientId,
  patientNumber: 'PAT-000001',
  firstName: 'Amina',
  middleName: null,
  lastName: 'Hassan',
  preferredName: null,
  dateOfBirth: null,
  gender: null,
  phone: null,
  email: null,
  nationalId: null,
  address: null,
  status: PatientStatus.ACTIVE,
  createdAt,
  updatedAt: createdAt,
};

const duplicateError = (target: string[]): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Duplicate tenant patient field', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });

function makePrisma(): {
  tenant: { findFirst: ReturnType<typeof vi.fn> };
  patient: {
    create: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
} {
  return {
    tenant: { findFirst: vi.fn() },
    patient: {
      create: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe('PatientRepository', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repository: PatientRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    prisma.tenant.findFirst.mockResolvedValue({ id: tenantId });
    repository = new PatientRepository(prisma as unknown as PrismaService);
  });

  it('creates a tenant-owned patient with the server-owned ACTIVE status', async () => {
    prisma.patient.create.mockResolvedValue(patientRecord);

    await expect(
      repository.create(tenantId, {
        patientNumber: 'PAT-000001',
        firstName: 'Amina',
        lastName: 'Hassan',
      }),
    ).resolves.toEqual({ kind: 'changed', record: patientRecord });
    expect(prisma.patient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          patientNumber: 'PAT-000001',
          firstName: 'Amina',
          lastName: 'Hassan',
        }),
        select: expect.objectContaining({
          id: true,
          patientNumber: true,
          nationalId: true,
          address: true,
          status: true,
        }),
      }),
    );
    expect(prisma.patient.create.mock.calls[0][0].data).not.toHaveProperty('status');
  });

  it('allows the same patient number to be attempted independently in another tenant', async () => {
    prisma.patient.create.mockResolvedValue(patientRecord);
    const input = { patientNumber: 'PAT-000001', firstName: 'Amina', lastName: 'Hassan' };

    await expect(repository.create(tenantId, input)).resolves.toMatchObject({ kind: 'changed' });
    await expect(repository.create(otherTenantId, input)).resolves.toMatchObject({
      kind: 'changed',
    });
    expect(prisma.patient.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: expect.objectContaining({ tenantId }) }),
    );
    expect(prisma.patient.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ tenantId: otherTenantId }) }),
    );
  });

  it('scopes ID reads, lists, exact-number filters, and totals to the trusted tenant', async () => {
    prisma.patient.findFirst.mockResolvedValue(null);
    prisma.patient.findMany.mockResolvedValue([patientRecord]);
    prisma.patient.count.mockResolvedValue(1);

    await expect(repository.findByIdForTenant(tenantId, patientId)).resolves.toBeNull();
    expect(prisma.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: patientId, tenantId } }),
    );
    await expect(
      repository.list(tenantId, {
        status: PatientStatus.INACTIVE,
        patientNumber: 'PAT-000001',
        limit: 20,
        offset: 5,
      }),
    ).resolves.toEqual({ items: [patientRecord], total: 1 });
    const expectedWhere = {
      tenantId,
      status: PatientStatus.INACTIVE,
      patientNumber: 'PAT-000001',
    };
    expect(prisma.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 5,
        take: 20,
      }),
    );
    expect(prisma.patient.count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('updates only supplied values with both patient and tenant identifiers', async () => {
    prisma.patient.updateMany.mockResolvedValue({ count: 1 });
    prisma.patient.findFirst.mockResolvedValue({ ...patientRecord, address: null });

    await expect(
      repository.update(tenantId, patientId, { address: null, email: 'new@example.com' }),
    ).resolves.toMatchObject({ kind: 'changed' });
    expect(prisma.patient.updateMany).toHaveBeenCalledWith({
      where: { id: patientId, tenantId },
      data: { address: null, email: 'new@example.com' },
    });
  });

  it('uses tenant-qualified compare-and-set lifecycle updates', async () => {
    const inactive = { ...patientRecord, status: PatientStatus.INACTIVE };
    prisma.patient.updateMany.mockResolvedValue({ count: 1 });
    prisma.patient.findFirst.mockResolvedValue(inactive);
    const changedAt = new Date('2026-10-07T12:00:00.000Z');

    await expect(
      repository.changeStatusIfCurrent(
        tenantId,
        patientId,
        PatientStatus.ACTIVE,
        PatientStatus.INACTIVE,
        changedAt,
      ),
    ).resolves.toEqual({ kind: 'changed', record: inactive });
    expect(prisma.patient.updateMany).toHaveBeenCalledWith({
      where: { id: patientId, tenantId, status: PatientStatus.ACTIVE },
      data: { status: PatientStatus.INACTIVE, updatedAt: changedAt },
    });
  });

  it('reports a concurrent lifecycle change without overwriting it', async () => {
    prisma.patient.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.changeStatusIfCurrent(
        tenantId,
        patientId,
        PatientStatus.ACTIVE,
        PatientStatus.INACTIVE,
        createdAt,
      ),
    ).resolves.toEqual({ kind: 'not-changed' });
    expect(prisma.patient.findFirst).not.toHaveBeenCalled();
  });

  it('maps database patient-number uniqueness conflicts for creates and updates', async () => {
    prisma.patient.create.mockRejectedValueOnce(duplicateError(['tenantId', 'patientNumber']));
    prisma.patient.updateMany.mockRejectedValueOnce(duplicateError(['tenantId', 'patientNumber']));

    await expect(
      repository.create(tenantId, {
        patientNumber: 'PAT-000001',
        firstName: 'Amina',
        lastName: 'Hassan',
      }),
    ).resolves.toEqual({ kind: 'patient-number-conflict' });
    await expect(
      repository.update(tenantId, patientId, { patientNumber: 'PAT-000001' }),
    ).resolves.toEqual({ kind: 'patient-number-conflict' });
  });

  it('does not write when the tenant is inactive', async () => {
    prisma.tenant.findFirst.mockResolvedValue(null);

    await expect(
      repository.create(tenantId, {
        patientNumber: 'PAT-000001',
        firstName: 'Amina',
        lastName: 'Hassan',
      }),
    ).resolves.toEqual({ kind: 'tenant-inactive' });
    await expect(repository.update(tenantId, patientId, { firstName: 'Amal' })).resolves.toEqual({
      kind: 'tenant-inactive',
    });
    await expect(
      repository.changeStatusIfCurrent(
        tenantId,
        patientId,
        PatientStatus.ACTIVE,
        PatientStatus.INACTIVE,
        createdAt,
      ),
    ).resolves.toEqual({ kind: 'tenant-inactive' });
    expect(prisma.patient.create).not.toHaveBeenCalled();
    expect(prisma.patient.updateMany).not.toHaveBeenCalled();
  });
});
