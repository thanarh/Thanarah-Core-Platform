import { MongoClient } from 'mongodb';
import type { MongoClientOptions } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import {
  OfficialPlatformMongoClientFactory,
  PlatformMongoClientManager,
} from '../src/platform-mongo/platform-mongo.client.manager';
import type {
  PlatformMongoClient,
  PlatformMongoClientFactory,
} from '../src/platform-mongo/platform-mongo.client.manager';
import { PlatformDocumentConflictError } from '../src/platform-mongo/platform-mongo.errors';
import {
  provisionPlatformMongoIndexes,
  verifyPlatformMongoIndexes,
} from '../src/platform-mongo/platform-mongo.indexes';
import {
  documentTimestamps,
  newStableId,
  stableAssignmentId,
} from '../src/platform-mongo/platform-mongo.models';
import { PlatformMongoRepositories } from '../src/platform-mongo/platform-mongo.repositories';

const mongoUri = process.env.PHASE65_PLATFORM_MONGO_URI;
const databaseName = process.env.PHASE65_PLATFORM_MONGO_DATABASE;
const allowedSeeds = new Set(['127.0.0.1:45271', '127.0.0.1:45272', '127.0.0.1:45273']);
const integration = mongoUri && databaseName ? describe : describe.skip;

class CapturingPlatformClientFactory
  extends OfficialPlatformMongoClientFactory
  implements PlatformMongoClientFactory
{
  client?: MongoClient;

  override create(uri: string, options: MongoClientOptions): PlatformMongoClient {
    const client = super.create(uri, options) as MongoClient;
    this.client = client;
    return client;
  }
}

function assertDisposableLoopbackTarget(uri: string, database: string): void {
  const match = /^mongodb:\/\/([^/?]+)\/?(\?[^#]*)?$/u.exec(uri);
  const seeds = match?.[1]?.split(',') ?? [];
  const query = new URLSearchParams(match?.[2]?.slice(1) ?? '');
  if (
    !match ||
    seeds.some((seed) => seed.includes('@')) ||
    query.get('replicaSet') !== 'rs0' ||
    seeds.length !== 3 ||
    seeds.some((seed) => !allowedSeeds.has(seed)) ||
    !/^phase65_platform_[a-z0-9_]+$/u.test(database)
  ) {
    throw new Error(
      'Phase 65 only accepts its credential-free loopback replica set and test database',
    );
  }
}

integration('Phase 65 isolated platform MongoDB foundation', () => {
  if (!mongoUri || !databaseName) throw new Error('Phase 65 test target is missing');
  assertDisposableLoopbackTarget(mongoUri, databaseName);
  const factory = new CapturingPlatformClientFactory();
  const manager = new PlatformMongoClientManager(
    {
      platformMongoUri: mongoUri,
      platformMongoDatabase: databaseName,
    } as ConfigService,
    factory,
  );
  const repositories = new PlatformMongoRepositories(manager);

  beforeAll(async () => {
    const bootstrapClient = new MongoClient('mongodb://127.0.0.1:45271/?directConnection=true', {
      serverSelectionTimeoutMS: 3_000,
    });
    await bootstrapClient.connect();
    const admin = bootstrapClient.db('admin');
    try {
      await admin.command({
        replSetInitiate: {
          _id: 'rs0',
          members: [
            { _id: 0, host: '127.0.0.1:45271' },
            { _id: 1, host: '127.0.0.1:45272' },
            { _id: 2, host: '127.0.0.1:45273' },
          ],
        },
      });
    } catch (error) {
      if (!(error instanceof Error) || !/already initialized/iu.test(error.message)) throw error;
    }
    await bootstrapClient.close();
    const db = await manager.getDatabase();
    const appAdmin = factory.client?.db('admin');
    if (!appAdmin) throw new Error('Phase 65 MongoDB client is unavailable');
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const hello = await appAdmin.command({ hello: 1 });
        if (hello.setName === 'rs0' && hello.isWritablePrimary) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!ready) throw new Error('Disposable Phase 65 replica set did not elect a primary');
    await db.dropDatabase();
    await provisionPlatformMongoIndexes(db);
  }, 45_000);

  afterAll(async () => {
    try {
      if (factory.client) await factory.client.db(databaseName).dropDatabase();
    } finally {
      await manager.onApplicationShutdown();
    }
  }, 20_000);

  it('provisions and verifies exact index keys/options including identity collation', async () => {
    const db = await manager.getDatabase();
    await verifyPlatformMongoIndexes(db);
    const emailIndex = (await db.collection('platform_users').listIndexes().toArray()).find(
      (index) => index.name === 'ux_platform_users_email',
    );
    expect(emailIndex?.unique).toBe(true);
    expect(emailIndex?.collation).toMatchObject({ locale: 'en', strength: 1 });
    expect(
      (await db.collection('platform_sessions').listIndexes().toArray()).some(
        (index) => index.expireAfterSeconds !== undefined,
      ),
    ).toBe(false);
  });

  it('creates, reads, and updates platform identities with strict document validation', async () => {
    const now = new Date();
    const userId = newStableId();
    const user = {
      _id: userId,
      ...documentTimestamps(now),
      schemaVersion: 1 as const,
      email: `phase65-${userId}@example.test`,
      passwordHash: 'synthetic-hash-only',
      fullName: 'Synthetic User',
      status: 'ACTIVE' as const,
      tokenVersion: 0,
      failedLoginAttempts: 0,
      lockedUntil: null,
    };
    await expect(repositories.users.create(user)).resolves.toEqual(user);
    await expect(repositories.users.findById(userId)).resolves.toEqual(user);
    await expect(repositories.users.findByEmail(user.email.toUpperCase())).resolves.toMatchObject({
      _id: userId,
    });
    await expect(
      repositories.users.update(userId, { fullName: 'Updated Synthetic User' }),
    ).resolves.toMatchObject({ fullName: 'Updated Synthetic User' });
    await expect(
      repositories.users.create({ ...user, _id: newStableId(), email: user.email.toUpperCase() }),
    ).rejects.toBeInstanceOf(PlatformDocumentConflictError);
    await expect(
      repositories.users.create({ ...user, _id: newStableId(), unknown: 'rejected' } as never),
    ).rejects.toThrow('Platform document validation failed');
  });

  it('enforces membership uniqueness and tenant-scoped reads and updates', async () => {
    const now = new Date();
    const tenantId = newStableId();
    const otherTenantId = newStableId();
    const userId = newStableId();
    const membershipId = newStableId();
    const membership = {
      _id: membershipId,
      ...documentTimestamps(now),
      schemaVersion: 1 as const,
      tenantId,
      platformUserId: userId,
      status: 'INVITED' as const,
      statusChangedAt: now,
      activatedAt: null,
      suspendedAt: null,
      removedAt: null,
    };
    await repositories.memberships.create(membership);
    await expect(
      repositories.memberships.findByIdForTenant(membershipId, otherTenantId),
    ).resolves.toBeNull();
    await expect(
      repositories.memberships.updateForTenant(membershipId, otherTenantId, { status: 'ACTIVE' }),
    ).resolves.toBeNull();
    await expect(
      repositories.memberships.updateForTenant(membershipId, tenantId, { status: 'ACTIVE' }),
    ).resolves.toMatchObject({ tenantId, status: 'ACTIVE' });
    await expect(
      repositories.memberships.create({ ...membership, _id: newStableId() }),
    ).rejects.toBeInstanceOf(PlatformDocumentConflictError);
  });

  it('uses stable composite identifiers and prevents concurrent duplicate identity writes', async () => {
    const now = new Date();
    const userId = newStableId();
    const email = `race-${userId}@example.test`;
    const userDocument = {
      ...documentTimestamps(now),
      schemaVersion: 1 as const,
      email,
      passwordHash: 'synthetic-hash-only',
      fullName: 'Concurrent Synthetic User',
      status: 'ACTIVE' as const,
      tokenVersion: 0,
      failedLoginAttempts: 0,
      lockedUntil: null,
    };
    const attempts = await Promise.allSettled([
      repositories.users.create({ ...userDocument, _id: newStableId() }),
      repositories.users.create({ ...userDocument, _id: newStableId() }),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(stableAssignmentId(userId, newStableId())).toContain('|');
  });

  it('recovers readiness after an injected connection close and after primary stepdown', async () => {
    const client = factory.client;
    if (!client) throw new Error('Phase 65 MongoDB client was not initialized');
    const admin = client.db('admin');
    await admin.command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: { failCommands: ['ping'], closeConnection: true },
    });
    expect(await manager.checkReadiness()).toBe(false);
    await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
    expect(await manager.checkReadiness()).toBe(true);
    try {
      await admin.command({ replSetStepDown: 5, force: true });
    } catch {
      // Expected: the stepdown disconnects its command socket.
    }
    const deadline = Date.now() + 30_000;
    let primaryRecovered = false;
    while (Date.now() < deadline) {
      try {
        const hello = await admin.command({ hello: 1 });
        if (hello.setName === 'rs0' && hello.isWritablePrimary === true) {
          primaryRecovered = true;
          break;
        }
      } catch {
        // Election temporarily removes a writable primary.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(primaryRecovered).toBe(true);
    expect(await manager.checkReadiness()).toBe(true);
    expect(
      await manager.getDatabase().then((db) =>
        db.collection('tenants').insertOne({
          _id: newStableId(),
          schemaVersion: 1,
          slug: `recovery-${newStableId()}`,
          legalName: 'Synthetic Recovery Tenant',
          displayName: 'Synthetic Recovery Tenant',
          status: 'ACTIVE',
          statusChangedAt: new Date(),
          suspendedAt: null,
          deactivatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    ).toMatchObject({ acknowledged: true });
  }, 60_000);
});
