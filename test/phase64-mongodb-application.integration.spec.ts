import { TenantStorageProvider, TenantStorageTargetStatus } from '@prisma/client';
import { MongoClient } from 'mongodb';
import type { MongoClientOptions } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import { MongoTenantPatientStorage } from '../src/tenant/mongo-tenant-patient.storage';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import {
  OfficialTenantMongoClientFactory,
  TenantMongoClientManager,
} from '../src/tenant/tenant-mongo-client.manager';
import type {
  TenantMongoClient,
  TenantMongoClientFactory,
} from '../src/tenant/tenant-mongo-client.manager';
import type { TenantStorageRoute } from '../src/tenant/tenant-storage.contract';
import type {
  TenantStorageTargetRecord,
  TenantStorageTargetResolver,
} from '../src/tenant/tenant-storage.registry';

const mongoUri = process.env.PHASE64_MONGO_URI;
const databaseName = `phase64_app_${process.pid}`;
const tenantId = '11111111-1111-4111-8111-111111111111';
const targetId = '44444444-4444-4444-8444-444444444444';
const target: TenantStorageTargetRecord = {
  id: targetId,
  tenantId,
  provider: TenantStorageProvider.MONGODB,
  connectionReference: 'primary',
  databaseName,
  status: TenantStorageTargetStatus.ACTIVE,
  isPrimary: true,
  createdAt: new Date('2026-10-31T00:00:00.000Z'),
  updatedAt: new Date('2026-10-31T00:00:00.000Z'),
};
const context = {
  tenantId,
  membershipId: '22222222-2222-4222-8222-222222222222',
  platformUserId: '33333333-3333-4333-8333-333333333333',
} as TrustedTenantContext;
const route: TenantStorageRoute = {
  placements: [
    { placementId: targetId as TenantStorageRoute['placements'][number]['placementId'] },
  ],
};

class CapturingMongoClientFactory
  extends OfficialTenantMongoClientFactory
  implements TenantMongoClientFactory
{
  client?: MongoClient;

  override create(uri: string, options: MongoClientOptions): TenantMongoClient {
    const client = super.create(uri, options) as MongoClient;
    this.client = client;
    return client;
  }
}

const integration = mongoUri ? describe : describe.skip;

integration('Phase 64 actual Thanarah MongoDB application integration', () => {
  const factory = new CapturingMongoClientFactory();
  const resolver: TenantStorageTargetResolver = {
    findActivePrimaryTarget: async (receivedContext, placementId) =>
      receivedContext.tenantId === tenantId && placementId === targetId ? target : null,
  };
  const manager = new TenantMongoClientManager(
    { tenantStorageMongoUri: mongoUri ?? '' } as ConfigService,
    factory,
  );
  const patients = new MongoTenantPatientStorage(resolver, manager);

  beforeAll(async () => {
    if (
      !mongoUri ||
      mongoUri.includes('@') ||
      !mongoUri.startsWith('mongodb://') ||
      !mongoUri.includes('replicaSet=rs0') ||
      !mongoUri.includes('retryWrites=true') ||
      !(mongoUri.split('://')[1]?.split(/[/?]/u)[0] ?? '')
        .split(',')
        .every((seed) => /^127\.0\.0\.1:(45271|45272|45273)$/u.test(seed))
    ) {
      throw new Error('Phase 64 requires a credential-free loopback rs0 URI with retryWrites=true');
    }
    const database = await manager.getDatabase(target);
    await database.dropDatabase();
  }, 20_000);

  afterAll(async () => {
    try {
      if (factory.client) await factory.client.db(databaseName).dropDatabase();
    } finally {
      await manager.onApplicationShutdown();
    }
  }, 20_000);

  it('discovers the replica set through the application-managed client and reports readiness', async () => {
    expect(await manager.checkReadiness()).toBe(true);
    const admin = factory.client?.db('admin');
    if (!admin) throw new Error('Application MongoDB client was not initialized');
    const hello = await admin.command({ hello: 1 });
    const status = await admin.command({ replSetGetStatus: 1 });

    expect(hello.setName).toBe('rs0');
    expect(hello.isWritablePrimary).toBe(true);
    expect(status.members).toHaveLength(3);
    expect(
      status.members.filter((member: { stateStr: string }) => member.stateStr === 'PRIMARY'),
    ).toHaveLength(1);
    expect(
      status.members.filter((member: { stateStr: string }) => member.stateStr === 'SECONDARY'),
    ).toHaveLength(2);
    expect(factory.client).toBeInstanceOf(MongoClient);
  }, 20_000);

  it('commits and aborts application-driver transactions, then ends sessions', async () => {
    const client = factory.client;
    if (!client) throw new Error('Application MongoDB client was not initialized');
    const collection = client.db(databaseName).collection('phase64_transactions');
    const committedSession = client.startSession();
    try {
      await committedSession.withTransaction(async () => {
        await collection.insertOne({ _id: 'committed', value: 1 }, { session: committedSession });
      });
    } finally {
      await committedSession.endSession();
    }
    expect(await collection.findOne({ _id: 'committed' })).toMatchObject({ value: 1 });

    const abortedSession = client.startSession();
    try {
      await expect(
        abortedSession.withTransaction(async () => {
          await collection.insertOne({ _id: 'aborted', value: 2 }, { session: abortedSession });
          throw new Error('phase64 intentional abort');
        }),
      ).rejects.toThrow('phase64 intentional abort');
    } finally {
      await abortedSession.endSession();
    }
    expect(await collection.findOne({ _id: 'aborted' })).toBeNull();
    expect(committedSession.hasEnded).toBe(true);
    expect(abortedSession.hasEnded).toBe(true);
  }, 20_000);

  it('runs the real Patient storage adapter against the resolved tenant database', async () => {
    await patients.ensureIndexesForTarget(target);
    const result = await patients.create(context, route, {
      patientNumber: 'P64-0001',
      firstName: 'Synthetic',
      lastName: 'Patient',
    });

    expect(result.kind).toBe('changed');
    if (result.kind !== 'changed') throw new Error('Expected synthetic Patient creation');
    await expect(patients.findById(context, route, result.record.id)).resolves.toMatchObject({
      patientNumber: 'P64-0001',
      firstName: 'Synthetic',
      lastName: 'Patient',
    });
    await expect(
      patients.create(context, route, {
        patientNumber: 'P64-0001',
        firstName: 'Different',
        lastName: 'Synthetic',
      }),
    ).resolves.toEqual({ kind: 'patient-number-conflict' });
  }, 20_000);

  it('retries a retryable insert after an injected pre-execution connection loss', async () => {
    const client = factory.client;
    if (!client) throw new Error('Application MongoDB client was not initialized');
    const admin = client.db('admin');
    const collection = client.db(databaseName).collection('phase64_retryable_writes');
    await admin.command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: { failCommands: ['insert'], closeConnection: true },
    });
    try {
      await collection.insertOne({ _id: 'retry-once', value: 1 });
    } finally {
      await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
    }
    expect(await collection.countDocuments({ _id: 'retry-once' })).toBe(1);
    await collection.insertOne({ _id: 'failpoint-cleared', value: 1 });
    expect(await collection.countDocuments({ _id: 'failpoint-cleared' })).toBe(1);
  }, 30_000);

  it('retries a transaction after an injected transient error without duplicating its write', async () => {
    const client = factory.client;
    if (!client) throw new Error('Application MongoDB client was not initialized');
    const admin = client.db('admin');
    const collection = client.db(databaseName).collection('phase64_transaction_retry');
    const session = client.startSession();
    let callbackAttempts = 0;
    await admin.command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        failCommands: ['insert'],
        errorCode: 112,
        errorLabels: ['TransientTransactionError'],
      },
    });
    try {
      await session.withTransaction(async () => {
        callbackAttempts += 1;
        await collection.insertOne(
          { _id: 'retry-transaction', callbackAttempt: callbackAttempts },
          { session },
        );
      });
    } finally {
      await session.endSession();
      await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
    }

    expect(callbackAttempts).toBeGreaterThan(1);
    expect(await collection.countDocuments({ _id: 'retry-transaction' })).toBe(1);
    await collection.insertOne({ _id: 'transaction-failpoint-cleared' });
    expect(await collection.countDocuments({ _id: 'transaction-failpoint-cleared' })).toBe(1);
  }, 30_000);

  it('reconnects through the application-managed seed list after a controlled stepdown', async () => {
    const client = factory.client;
    if (!client) throw new Error('Application MongoDB client was not initialized');
    try {
      await client.db('admin').command({ replSetStepDown: 5, force: true });
    } catch {
      // Stepdown commonly closes the command connection; the assertions below verify recovery.
    }

    const deadline = Date.now() + 20_000;
    let hello: Record<string, unknown> | undefined;
    while (Date.now() < deadline) {
      try {
        hello = await client.db('admin').command({ hello: 1 });
        if (hello.isWritablePrimary === true) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    expect(hello?.setName).toBe('rs0');
    expect(hello?.isWritablePrimary).toBe(true);
    await client
      .db(databaseName)
      .collection('phase64_after_stepdown')
      .insertOne({ _id: 'recovered' });
    expect(
      await client
        .db(databaseName)
        .collection('phase64_after_stepdown')
        .countDocuments({ _id: 'recovered' }),
    ).toBe(1);
  }, 30_000);
});
