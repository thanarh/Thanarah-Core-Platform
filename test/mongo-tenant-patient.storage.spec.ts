import { TenantStorageProvider, TenantStorageTargetStatus } from '@prisma/client';
import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type { CreatePatientInput } from '../src/tenant/patient.dto';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import { PATIENT_DIRECTORY_SEARCH_FIELDS, PatientStatus } from '../src/tenant/patient.model';
import { MongoTenantPatientStorage } from '../src/tenant/mongo-tenant-patient.storage';
import type { TenantMongoClientManager } from '../src/tenant/tenant-mongo-client.manager';
import type {
  TenantStoragePlacementId,
  TenantStorageRoute,
} from '../src/tenant/tenant-storage.contract';
import { TenantStorageUnavailableError } from '../src/tenant/tenant-storage.errors';
import type { TenantStorageTargetResolver } from '../src/tenant/tenant-storage.registry';
import type { TenantStorageTargetRecord } from '../src/tenant/tenant-storage.registry';

const tenantId = '11111111-1111-4111-8111-111111111111';
const targetId = '44444444-4444-4444-8444-444444444444';
const context = {
  tenantId,
  membershipId: '22222222-2222-4222-8222-222222222222',
  platformUserId: '33333333-3333-4333-8333-333333333333',
} as TrustedTenantContext;
const target: TenantStorageTargetRecord = {
  id: targetId,
  tenantId,
  provider: TenantStorageProvider.MONGODB,
  connectionReference: 'primary',
  databaseName: 'tenant_alpha',
  status: TenantStorageTargetStatus.ACTIVE,
  isPrimary: true,
  createdAt: new Date('2026-10-08T00:00:00.000Z'),
  updatedAt: new Date('2026-10-08T00:00:00.000Z'),
};
const route: TenantStorageRoute = {
  placements: [{ placementId: targetId as TenantStoragePlacementId }],
};
const createInput: CreatePatientInput = {
  patientNumber: 'PAT-000001',
  firstName: 'Amina',
  lastName: 'Hassan',
};
const requiredPatientWriteIndexes = [
  {
    name: 'tenant_patient_number_unique',
    key: { _tenantId: 1, patientNumber: 1 },
    unique: true,
  },
  {
    name: 'tenant_patient_duplicate_phone_name_unique_idx',
    key: { _tenantId: 1, firstName: 1, middleName: 1, lastName: 1, phone: 1 },
    unique: true,
    partialFilterExpression: { phone: { $type: 'string' } },
    collation: { locale: 'en', strength: 2 },
  },
  {
    name: 'tenant_patient_duplicate_email_name_unique_idx',
    key: { _tenantId: 1, firstName: 1, middleName: 1, lastName: 1, email: 1 },
    unique: true,
    partialFilterExpression: { email: { $type: 'string' } },
    collation: { locale: 'en', strength: 2 },
  },
  {
    name: 'tenant_patient_duplicate_name_dob_unique_idx',
    key: { _tenantId: 1, lastName: 1, firstName: 1, dateOfBirth: 1 },
    unique: true,
    partialFilterExpression: { dateOfBirth: { $type: 'date' } },
    collation: { locale: 'en', strength: 2 },
  },
];

type TestMockFunction = ReturnType<typeof vi.fn>;

interface MongoStorageHarness {
  storage: MongoTenantPatientStorage;
  targetResolver: TenantStorageTargetResolver;
  clients: { getDatabase: TestMockFunction };
  collection: {
    insertOne: TestMockFunction;
    find: TestMockFunction;
    findOne: TestMockFunction;
    updateOne: TestMockFunction;
    countDocuments: TestMockFunction;
    createIndex: TestMockFunction;
    indexes: TestMockFunction;
    dropIndex: TestMockFunction;
  };
  cursor: {
    sort: TestMockFunction;
    skip: TestMockFunction;
    limit: TestMockFunction;
    toArray: TestMockFunction;
  };
  database: Db;
  getInsertedDocument(): Record<string, unknown> | undefined;
  getLastFindFilter(): Record<string, unknown> | undefined;
  getLastUpdateFilter(): Record<string, unknown> | undefined;
  getLastUpdate(): Record<string, unknown> | undefined;
}

function makeDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: '66666666-6666-4666-8666-666666666666',
    _tenantId: tenantId,
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
    status: 'ACTIVE',
    createdAt: new Date('2026-10-08T00:00:00.000Z'),
    updatedAt: new Date('2026-10-08T00:00:00.000Z'),
    ...overrides,
  };
}

function setup(activeTarget: TenantStorageTargetRecord | null = target): MongoStorageHarness {
  const document = makeDocument();
  let insertedDocument: Record<string, unknown> | undefined;
  let lastFindFilter: Record<string, unknown> | undefined;
  let lastUpdateFilter: Record<string, unknown> | undefined;
  let lastUpdate: Record<string, unknown> | undefined;

  const cursor = {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([document]),
  };
  const collection = {
    insertOne: vi.fn(async (value: Record<string, unknown>) => {
      insertedDocument = value;
      return { acknowledged: true };
    }),
    find: vi.fn((filter: Record<string, unknown>) => {
      lastFindFilter = filter;
      return cursor;
    }),
    findOne: vi.fn().mockResolvedValue(document),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      lastUpdateFilter = filter;
      lastUpdate = update;
      return { matchedCount: 1 };
    }),
    countDocuments: vi.fn().mockResolvedValue(1),
    createIndex: vi.fn().mockResolvedValue('index'),
    indexes: vi.fn().mockResolvedValue(requiredPatientWriteIndexes),
    dropIndex: vi.fn().mockResolvedValue({ ok: 1 }),
  };
  const database = {
    collection: vi.fn().mockReturnValue(collection),
  } as unknown as Db;
  const targetResolver: TenantStorageTargetResolver = {
    findActivePrimaryTarget: vi.fn().mockResolvedValue(activeTarget),
  };
  const clients = {
    getDatabase: vi.fn().mockResolvedValue(database),
  };
  const storage = new MongoTenantPatientStorage(
    targetResolver,
    clients as unknown as TenantMongoClientManager,
  );

  return {
    storage,
    targetResolver,
    clients,
    collection,
    cursor,
    database,
    getInsertedDocument: (): Record<string, unknown> | undefined => insertedDocument,
    getLastFindFilter: (): Record<string, unknown> | undefined => lastFindFilter,
    getLastUpdateFilter: (): Record<string, unknown> | undefined => lastUpdateFilter,
    getLastUpdate: (): Record<string, unknown> | undefined => lastUpdate,
  };
}

describe('MongoTenantPatientStorage', () => {
  it('writes to the registry-resolved database and keeps tenant metadata out of API records', async () => {
    const setupState = setup();
    const result = await setupState.storage.create(context, route, createInput);

    expect(result.kind).toBe('changed');
    if (result.kind !== 'changed') throw new Error('Expected a stored Patient record');
    const stored = setupState.getInsertedDocument();
    expect(stored).toMatchObject({
      _tenantId: tenantId,
      patientNumber: createInput.patientNumber,
      firstName: createInput.firstName,
      lastName: createInput.lastName,
      status: PatientStatus.ACTIVE,
    });
    expect(stored).not.toHaveProperty('normalizedPhone');
    expect(stored).not.toHaveProperty('normalizedEmail');
    expect(stored).not.toHaveProperty('normalizedName');
    expect(result.record.id).toBe(stored?._id);
    expect(result.record).not.toHaveProperty('_tenantId');
    expect(setupState.targetResolver.findActivePrimaryTarget).toHaveBeenCalledWith(
      context,
      targetId,
    );
    expect(setupState.clients.getDatabase).toHaveBeenCalledWith(target);
  });

  it('scopes list, lookup, and updates by the trusted tenant and preserves ordering', async () => {
    const setupState = setup();

    await expect(
      setupState.storage.list(context, route, {
        limit: 25,
        offset: 50,
        status: PatientStatus.ACTIVE,
        patientNumber: 'PAT-000001',
      }),
    ).resolves.toMatchObject({ total: 1, items: [{ id: '66666666-6666-4666-8666-666666666666' }] });
    expect(setupState.getLastFindFilter()).toEqual({
      _tenantId: tenantId,
      status: PatientStatus.ACTIVE,
      patientNumber: 'PAT-000001',
    });
    expect(setupState.cursor.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(setupState.cursor.skip).toHaveBeenCalledWith(50);
    expect(setupState.cursor.limit).toHaveBeenCalledWith(25);

    await setupState.storage.findById(context, route, '66666666-6666-4666-8666-666666666666');
    expect(setupState.collection.findOne).toHaveBeenLastCalledWith({
      _id: '66666666-6666-4666-8666-666666666666',
      _tenantId: tenantId,
    });

    await setupState.storage.update(context, route, '66666666-6666-4666-8666-666666666666', {
      phone: '+966500000000',
    });
    expect(setupState.getLastUpdateFilter()).toEqual({
      _id: '66666666-6666-4666-8666-666666666666',
      _tenantId: tenantId,
    });
    expect(setupState.getLastUpdate()).toMatchObject({
      $set: { phone: '+966500000000', updatedAt: expect.any(Date) },
    });
  });

  it('builds literal case-insensitive search only from approved fields and shares filters with count', async () => {
    const setupState = setup();
    const search = 'Amina.* [H]';

    await setupState.storage.list(context, route, {
      search,
      status: PatientStatus.ACTIVE,
      limit: 10,
      offset: 0,
    });

    const expectedFilter = {
      _tenantId: tenantId,
      status: PatientStatus.ACTIVE,
      $or: PATIENT_DIRECTORY_SEARCH_FIELDS.map((field) => ({
        [field]: { $regex: 'Amina\\.\\* \\[H\\]', $options: 'i' },
      })),
    };
    expect(setupState.getLastFindFilter()).toEqual(expectedFilter);
    expect(setupState.collection.countDocuments).toHaveBeenCalledWith(expectedFilter);
    expect(setupState.collection.find).toHaveBeenCalledWith(expectedFilter, {
      projection: {
        _id: 1,
        patientNumber: 1,
        firstName: 1,
        middleName: 1,
        lastName: 1,
        preferredName: 1,
        phone: 1,
        email: 1,
        status: 1,
      },
    });
    expect(JSON.stringify(expectedFilter)).not.toMatch(/nationalId|address|dateOfBirth|\\$where/i);
  });

  it('uses an exact tenant-scoped patient-number equality lookup', async () => {
    const setupState = setup();

    await expect(
      setupState.storage.findByPatientNumber(context, route, 'PAT-000001'),
    ).resolves.toMatchObject({ patientNumber: 'PAT-000001' });

    expect(setupState.collection.findOne).toHaveBeenLastCalledWith({
      _tenantId: tenantId,
      patientNumber: 'PAT-000001',
    });
  });

  it('builds tenant-scoped duplicate predicates from normalized identity fields only', async () => {
    const setupState = setup();

    await expect(
      setupState.storage.findPotentialDuplicates(
        context,
        route,
        {
          firstName: ' Ａmina ',
          middleName: 'Noor',
          lastName: ' HASSAN ',
          dateOfBirth: new Date('1990-06-15T12:30:00.000Z'),
          phone: '+1  555 123-4567',
          email: ' PERSON@EXAMPLE.COM ',
        },
        '66666666-6666-4666-8666-666666666666',
      ),
    ).resolves.toBe(true);

    expect(setupState.collection.findOne).toHaveBeenLastCalledWith(
      {
        _tenantId: tenantId,
        _id: { $ne: '66666666-6666-4666-8666-666666666666' },
        $or: [
          {
            phone: '+1 555 123-4567',
            firstName: 'amina',
            middleName: 'noor',
            lastName: 'hassan',
          },
          {
            email: 'person@example.com',
            firstName: 'amina',
            middleName: 'noor',
            lastName: 'hassan',
          },
          {
            firstName: 'amina',
            lastName: 'hassan',
            dateOfBirth: {
              $gte: new Date('1990-06-15T00:00:00.000Z'),
              $lt: new Date('1990-06-16T00:00:00.000Z'),
            },
          },
        ],
      },
      {
        projection: { _id: 1 },
        collation: { locale: 'en', strength: 2 },
      },
    );
    expect(JSON.stringify(setupState.collection.findOne.mock.calls[0])).not.toMatch(
      /nationalId|address|\\$where|\\$regex/i,
    );
  });

  it('does not query when no strong duplicate combination is available', async () => {
    const setupState = setup();

    await expect(
      setupState.storage.findPotentialDuplicates(context, route, {
        firstName: 'Amina',
        middleName: null,
        lastName: 'Hassan',
        dateOfBirth: null,
        phone: null,
        email: null,
      }),
    ).resolves.toBe(false);
    expect(setupState.collection.findOne).not.toHaveBeenCalled();
  });

  it('uses a conditional status update and translates the unique patient-number index conflict', async () => {
    const setupState = setup();
    await setupState.storage.changeStatusIfCurrent(
      context,
      route,
      '66666666-6666-4666-8666-666666666666',
      PatientStatus.ACTIVE,
      PatientStatus.INACTIVE,
      new Date('2026-10-08T00:00:00.000Z'),
    );
    expect(setupState.getLastUpdateFilter()).toEqual({
      _id: '66666666-6666-4666-8666-666666666666',
      _tenantId: tenantId,
      status: PatientStatus.ACTIVE,
    });

    setupState.collection.insertOne.mockRejectedValue({
      code: 11000,
      keyPattern: { _tenantId: 1, patientNumber: 1 },
    });
    await expect(setupState.storage.create(context, route, createInput)).resolves.toEqual({
      kind: 'patient-number-conflict',
    });
  });

  it('fails closed when atomic duplicate indexes are not provisioned', async () => {
    const setupState = setup();
    setupState.collection.indexes.mockResolvedValue([]);

    await expect(setupState.storage.create(context, route, createInput)).rejects.toBeInstanceOf(
      TenantStorageUnavailableError,
    );
    expect(setupState.collection.insertOne).not.toHaveBeenCalled();

    await expect(
      setupState.storage.update(context, route, '66666666-6666-4666-8666-666666666666', {
        firstName: 'Amina Noor',
      }),
    ).rejects.toBeInstanceOf(TenantStorageUnavailableError);
    expect(setupState.collection.updateOne).not.toHaveBeenCalled();
  });

  it('keeps unrelated updates independent from the duplicate indexes', async () => {
    const preferredNameUpdate = setup();
    preferredNameUpdate.collection.indexes.mockResolvedValue([]);
    await expect(
      preferredNameUpdate.storage.update(context, route, '66666666-6666-4666-8666-666666666666', {
        preferredName: 'Amina',
      }),
    ).resolves.toMatchObject({ kind: 'changed' });
    expect(preferredNameUpdate.collection.indexes).not.toHaveBeenCalled();

    const patientNumberUpdate = setup();
    patientNumberUpdate.collection.indexes.mockResolvedValue([requiredPatientWriteIndexes[0]]);
    await expect(
      patientNumberUpdate.storage.update(context, route, '66666666-6666-4666-8666-666666666666', {
        patientNumber: 'PAT-UPDATED',
      }),
    ).resolves.toMatchObject({ kind: 'changed' });
    expect(patientNumberUpdate.collection.indexes).toHaveBeenCalledOnce();
  });

  it('translates an atomic duplicate-key write to the safe duplicate result', async () => {
    const setupState = setup();
    setupState.collection.insertOne.mockRejectedValue({
      code: 11000,
      keyPattern: {
        _tenantId: 1,
        firstName: 1,
        middleName: 1,
        lastName: 1,
        phone: 1,
      },
    });
    setupState.collection.findOne.mockResolvedValueOnce(null);

    await expect(setupState.storage.create(context, route, createInput)).resolves.toEqual({
      kind: 'possible-duplicate',
    });
  });

  it('preserves patient-number precedence when a concurrent insert violates both rules', async () => {
    const setupState = setup();
    setupState.collection.insertOne.mockRejectedValue({
      code: 11000,
      keyPattern: {
        _tenantId: 1,
        firstName: 1,
        middleName: 1,
        lastName: 1,
        phone: 1,
      },
    });

    await expect(setupState.storage.create(context, route, createInput)).resolves.toEqual({
      kind: 'patient-number-conflict',
    });
    expect(setupState.collection.findOne).toHaveBeenCalledWith(
      { _tenantId: tenantId, patientNumber: createInput.patientNumber },
      { projection: { _id: 1 } },
    );
  });

  it('creates only the indexes needed for current operations on explicit operator request', async () => {
    const setupState = setup();
    setupState.collection.indexes.mockResolvedValue([
      ...requiredPatientWriteIndexes,
      { name: 'tenant_patient_duplicate_phone_name_idx' },
      { name: 'tenant_patient_duplicate_email_name_idx' },
      { name: 'tenant_patient_duplicate_name_dob_idx' },
    ]);
    await setupState.storage.ensureIndexesForTarget(target);

    expect(setupState.collection.createIndex).toHaveBeenCalledTimes(6);
    expect(setupState.collection.createIndex).toHaveBeenNthCalledWith(
      1,
      { _tenantId: 1, patientNumber: 1 },
      { unique: true, name: 'tenant_patient_number_unique' },
    );
    expect(setupState.collection.createIndex).toHaveBeenNthCalledWith(
      2,
      { _tenantId: 1, status: 1, createdAt: -1, _id: -1 },
      { name: 'tenant_patient_status_created_idx' },
    );
    expect(setupState.collection.createIndex).toHaveBeenNthCalledWith(
      3,
      { _tenantId: 1, createdAt: -1, _id: -1 },
      { name: 'tenant_patient_created_idx' },
    );
    expect(setupState.collection.createIndex).toHaveBeenNthCalledWith(
      4,
      { _tenantId: 1, firstName: 1, middleName: 1, lastName: 1, phone: 1 },
      {
        name: 'tenant_patient_duplicate_phone_name_unique_idx',
        unique: true,
        partialFilterExpression: { phone: { $type: 'string' } },
        collation: { locale: 'en', strength: 2 },
      },
    );
    expect(setupState.collection.createIndex).toHaveBeenNthCalledWith(
      5,
      { _tenantId: 1, firstName: 1, middleName: 1, lastName: 1, email: 1 },
      {
        name: 'tenant_patient_duplicate_email_name_unique_idx',
        unique: true,
        partialFilterExpression: { email: { $type: 'string' } },
        collation: { locale: 'en', strength: 2 },
      },
    );
    expect(setupState.collection.createIndex).toHaveBeenNthCalledWith(
      6,
      { _tenantId: 1, lastName: 1, firstName: 1, dateOfBirth: 1 },
      {
        name: 'tenant_patient_duplicate_name_dob_unique_idx',
        unique: true,
        partialFilterExpression: { dateOfBirth: { $type: 'date' } },
        collation: { locale: 'en', strength: 2 },
      },
    );
    expect(setupState.collection.dropIndex.mock.calls).toEqual([
      ['tenant_patient_duplicate_phone_name_idx'],
      ['tenant_patient_duplicate_email_name_idx'],
      ['tenant_patient_duplicate_name_dob_idx'],
    ]);
  });

  it('keeps legacy indexes when unique provisioning fails on conflicting existing data', async () => {
    const setupState = setup();
    setupState.collection.createIndex.mockImplementation(async (...args: unknown[]) => {
      const options = args[1] as { name?: string };
      if (options.name === 'tenant_patient_duplicate_phone_name_unique_idx') {
        throw Object.assign(new Error('duplicate key'), { code: 11000 });
      }
      return 'index';
    });

    await expect(setupState.storage.ensureIndexesForTarget(target)).rejects.toBeInstanceOf(
      TenantStorageUnavailableError,
    );
    expect(setupState.collection.dropIndex).not.toHaveBeenCalled();
  });

  it('fails closed for cross-tenant targets and unsupported multi-target routes', async () => {
    const crossTenant = setup({ ...target, tenantId: '99999999-9999-4999-8999-999999999999' });
    await expect(crossTenant.storage.findById(context, route, targetId)).rejects.toBeInstanceOf(
      TenantStorageUnavailableError,
    );
    expect(crossTenant.clients.getDatabase).not.toHaveBeenCalled();

    const multiple = setup();
    const routeWithMultiplePlacements: TenantStorageRoute = {
      placements: [
        { placementId: targetId as TenantStoragePlacementId },
        { placementId: '55555555-5555-4555-8555-555555555555' as TenantStoragePlacementId },
      ],
    };
    await expect(
      multiple.storage.findById(context, routeWithMultiplePlacements, targetId),
    ).rejects.toBeInstanceOf(TenantStorageUnavailableError);
    expect(multiple.clients.getDatabase).not.toHaveBeenCalled();
  });
});
