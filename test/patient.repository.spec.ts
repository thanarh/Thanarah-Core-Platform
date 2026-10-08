import { describe, expect, it, vi } from 'vitest';
import type { CreatePatientInput } from '../src/tenant/patient.dto';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  type TrustedTenantContext,
} from '../src/tenant/tenant-context.contract';
import type {
  TenantDatabaseRegistry,
  TenantStoragePlacement,
  TenantStoragePlacementId,
} from '../src/tenant/tenant-storage.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from '../src/tenant/tenant-storage.errors';
import { PatientStatus } from '../src/tenant/patient.model';
import { TenantStoragePatientRepository } from '../src/tenant/patient.repository';
import { InMemoryTenantPatientStorage } from '../src/tenant/tenant-patient.storage';
import {
  DevelopmentTenantDatabaseRegistry,
  TenantStorageResolverService,
  UnconfiguredTenantDatabaseRegistry,
} from '../src/tenant/tenant-storage.resolver';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '99999999-9999-4999-8999-999999999999';
const contextA = {
  tenantId: tenantA,
  membershipId: '22222222-2222-4222-8222-222222222222',
  platformUserId: '33333333-3333-4333-8333-333333333333',
} as TrustedTenantContext;
const contextB = {
  tenantId: tenantB,
  membershipId: '88888888-8888-4888-8888-888888888888',
  platformUserId: '77777777-7777-4777-8777-777777777777',
} as TrustedTenantContext;
const createInput: CreatePatientInput = {
  patientNumber: 'PAT-000001',
  firstName: 'Amina',
  lastName: 'Hassan',
};
const localPlacement: TenantStoragePlacement = {
  placementId: 'dev-memory' as TenantStoragePlacementId,
};

function setup(placements: readonly TenantStoragePlacement[] = [localPlacement]): {
  registry: TenantDatabaseRegistry;
  resolver: TenantStorageResolverService;
  storage: InMemoryTenantPatientStorage;
  repository: TenantStoragePatientRepository;
} {
  const registry: TenantDatabaseRegistry = {
    getPlacements: vi.fn().mockResolvedValue(placements),
  };
  const resolver = new TenantStorageResolverService(registry);
  const storage = new InMemoryTenantPatientStorage();
  const repository = new TenantStoragePatientRepository(resolver, storage);
  return { registry, resolver, storage, repository };
}

describe('TenantStoragePatientRepository', () => {
  it('resolves development placement from trusted context without exposing physical details', async () => {
    const resolver = new TenantStorageResolverService(new DevelopmentTenantDatabaseRegistry());
    const route = await resolver.resolve(contextA);

    expect(route.placements).toEqual([{ placementId: 'development-memory' }]);
    expect(JSON.stringify(route)).not.toMatch(/databaseName|connectionString|mongodb/i);
  });

  it('rejects absent or malformed context before registry access', async () => {
    const registry = {
      getPlacements: vi.fn().mockResolvedValue([localPlacement]),
    } satisfies TenantDatabaseRegistry;
    const resolver = new TenantStorageResolverService(registry);

    await expect(resolver.resolve(undefined as never)).rejects.toBeInstanceOf(
      TenantContextRequiredError,
    );
    await expect(
      resolver.resolve({ tenantId: 'client-value' } as TrustedTenantContext),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
    expect(registry.getPlacements).not.toHaveBeenCalled();
  });

  it('resolves every operation using trusted context and allows multiple opaque placements', async () => {
    const secondPlacement: TenantStoragePlacement = {
      placementId: 'dev-memory-secondary' as TenantStoragePlacementId,
    };
    const { registry, repository } = setup([localPlacement, secondPlacement]);

    const created = await repository.create(contextA, createInput);
    expect(created.kind).toBe('changed');
    if (created.kind !== 'changed') throw new Error('Expected a created record');
    expect(created.record).not.toHaveProperty('tenantId');

    await expect(repository.findByIdForTenant(contextA, created.record.id)).resolves.toMatchObject({
      id: created.record.id,
      patientNumber: createInput.patientNumber,
    });
    expect(registry.getPlacements).toHaveBeenCalledWith(contextA);
    expect(registry.getPlacements).toHaveBeenCalledTimes(2);
  });

  it('isolates records and patient-number uniqueness by logical tenant', async () => {
    const { repository } = setup();
    const createdA = await repository.create(contextA, createInput);
    const createdB = await repository.create(contextB, createInput);
    expect(createdA.kind).toBe('changed');
    expect(createdB.kind).toBe('changed');
    if (createdA.kind !== 'changed' || createdB.kind !== 'changed') {
      throw new Error('Expected both tenant records to be created');
    }

    await expect(repository.findByIdForTenant(contextB, createdA.record.id)).resolves.toBeNull();
    await expect(repository.findByIdForTenant(contextA, createdA.record.id)).resolves.toMatchObject(
      {
        id: createdA.record.id,
        firstName: 'Amina',
      },
    );
    await expect(
      repository.create(contextA, { ...createInput, firstName: 'Different' }),
    ).resolves.toEqual({ kind: 'patient-number-conflict' });
    await expect(repository.list(contextA, { limit: 50, offset: 0 })).resolves.toMatchObject({
      total: 1,
    });
    await expect(repository.list(contextB, { limit: 50, offset: 0 })).resolves.toMatchObject({
      total: 1,
    });
  });

  it('looks up an exact patient number only within the trusted tenant', async () => {
    const { repository } = setup();
    const patientA = await repository.create(contextA, {
      ...createInput,
      patientNumber: 'PAT-A-ONLY',
    });
    const patientB = await repository.create(contextB, {
      ...createInput,
      patientNumber: 'PAT-B-ONLY',
    });
    if (patientA.kind !== 'changed' || patientB.kind !== 'changed') {
      throw new Error('Expected both tenant records to be created');
    }

    await expect(repository.findByPatientNumber(contextA, 'PAT-A-ONLY')).resolves.toMatchObject({
      id: patientA.record.id,
    });
    await expect(repository.findByPatientNumber(contextB, 'PAT-B-ONLY')).resolves.toMatchObject({
      id: patientB.record.id,
    });
    await expect(repository.findByPatientNumber(contextB, 'PAT-A-ONLY')).resolves.toBeNull();
  });

  it('updates and transitions a record only within its tenant partition', async () => {
    const { repository } = setup();
    const created = await repository.create(contextA, createInput);
    if (created.kind !== 'changed') throw new Error('Expected a created record');

    const changed = await repository.update(contextA, created.record.id, { phone: null });
    expect(changed.kind).toBe('changed');
    if (changed.kind !== 'changed') throw new Error('Expected an updated record');
    expect(changed.record.phone).toBeNull();

    const transition = await repository.changeStatusIfCurrent(
      contextA,
      created.record.id,
      PatientStatus.ACTIVE,
      PatientStatus.INACTIVE,
      new Date('2026-10-08T10:00:00.000Z'),
    );
    expect(transition).toMatchObject({
      kind: 'changed',
      record: { status: PatientStatus.INACTIVE },
    });
    await expect(
      repository.changeStatusIfCurrent(
        contextB,
        created.record.id,
        PatientStatus.ACTIVE,
        PatientStatus.INACTIVE,
        new Date(),
      ),
    ).resolves.toEqual({ kind: 'not-changed' });
  });

  it('fails closed for an empty registry route without calling patient storage', async () => {
    const storage = new InMemoryTenantPatientStorage();
    const create = vi.spyOn(storage, 'create');
    const repository = new TenantStoragePatientRepository(
      new TenantStorageResolverService(new UnconfiguredTenantDatabaseRegistry()),
      storage,
    );

    await expect(repository.create(contextA, createInput)).rejects.toBeInstanceOf(
      TenantStorageNotConfiguredError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('sanitizes registry failures rather than exposing physical storage details', async () => {
    const registry: TenantDatabaseRegistry = {
      getPlacements: vi.fn().mockRejectedValue(new Error('mongodb://private-host/database')),
    };
    const repository = new TenantStoragePatientRepository(
      new TenantStorageResolverService(registry),
      new InMemoryTenantPatientStorage(),
    );

    let response: unknown;
    try {
      await repository.create(contextA, createInput);
    } catch (error) {
      response = error instanceof TenantStorageUnavailableError ? error.getResponse() : error;
    }

    expect(response).toEqual({
      code: 'TENANT_STORAGE_UNAVAILABLE',
      message: 'Tenant storage is currently unavailable',
    });
    expect(JSON.stringify(response)).not.toMatch(/mongodb|private-host|database/i);
  });
});
