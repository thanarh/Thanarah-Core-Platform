import { MongoClient } from 'mongodb';
import type { ClientSession, MongoClientOptions } from 'mongodb';
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
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from '../src/platform-mongo/platform-mongo.errors';
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
import { MongoPlatformAuthorizationRepository } from '../src/platform-mongo/mongo-platform-authorization.repository';
import { MongoPlatformFeatureRepository } from '../src/platform-mongo/mongo-platform-feature.repository';
import { MongoPlatformPlanRepository } from '../src/platform-mongo/mongo-platform-plan.repository';
import { MongoTenantEntitlementRepository } from '../src/platform-mongo/mongo-tenant-entitlement.repository';
import { MongoPlatformUserRepository } from '../src/platform-mongo/mongo-platform-user.repository';
import { MongoPlatformSessionRepository } from '../src/platform-mongo/mongo-platform-session.repository';
import { MongoTenantRepository } from '../src/platform-mongo/mongo-tenant.repository';
import { MongoFacilityRepository } from '../src/platform-mongo/mongo-facility.repository';
import { MongoPlatformAuditRepository } from '../src/platform-mongo/mongo-platform-audit.repository';
import { MongoHealthcareCatalogRepository } from '../src/platform-mongo/mongo-healthcare-catalog.repository';
import { MongoServiceCatalogRepository } from '../src/platform-mongo/mongo-service-catalog.repository';
import { MongoSubscriptionRepository } from '../src/platform-mongo/mongo-subscription.repository';
import { MongoTenantRoleRepository } from '../src/platform-mongo/mongo-tenant-role.repository';
import { MongoBranchRepository } from '../src/platform-mongo/mongo-branch.repository';
import { TENANT_PERMISSION_DEFINITIONS } from '../src/tenant/tenant-authorization.constants';
import {
  TenantOwnerBootstrapConflictError,
  TenantPermissionCatalogUnavailableError,
} from '../src/tenant/tenant-authorization.errors';
import { PlatformDocumentConflictError } from '../src/platform-mongo/platform-mongo.errors';

const mongoUri = process.env.PHASE65_PLATFORM_MONGO_URI;
const databaseName = process.env.PHASE65_PLATFORM_MONGO_DATABASE;
const testUri =
  mongoUri ??
  'mongodb://127.0.0.1:45271,127.0.0.1:45272,127.0.0.1:45273/?replicaSet=rs0&retryWrites=true';
const testDatabaseName = databaseName ?? 'phase65_platform_skipped';
const allowedSeeds = new Set(['127.0.0.1:45271', '127.0.0.1:45272', '127.0.0.1:45273']);
const integration = mongoUri && databaseName ? describe : describe.skip;

class CapturingPlatformClientFactory
  extends OfficialPlatformMongoClientFactory
  implements PlatformMongoClientFactory
{
  client?: MongoClient;
  readonly authorizationReadSessions: string[] = [];

  override create(uri: string, options: MongoClientOptions): PlatformMongoClient {
    const client = super.create(uri, { ...options, monitorCommands: true }) as MongoClient;
    client.on('commandStarted', (event) => {
      if (
        event.commandName === 'find' &&
        event.databaseName === testDatabaseName &&
        typeof event.command.find === 'string' &&
        [
          'platform_user_roles',
          'platform_roles',
          'platform_role_permissions',
          'platform_permissions',
        ].includes(event.command.find)
      ) {
        this.authorizationReadSessions.push(JSON.stringify(event.command.lsid));
      }
    });
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
  if (mongoUri && databaseName) assertDisposableLoopbackTarget(mongoUri, databaseName);
  const factory = new CapturingPlatformClientFactory();
  const manager = new PlatformMongoClientManager(
    {
      platformMongoUri: testUri,
      platformMongoDatabase: testDatabaseName,
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
    const connectionDeadline = Date.now() + 30_000;
    let db: Awaited<ReturnType<PlatformMongoClientManager['getDatabase']>> | undefined;
    while (Date.now() < connectionDeadline) {
      try {
        db = await manager.getDatabase();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!db) throw new Error('Platform Mongo client did not recover after replica-set election');
    const appAdmin = factory.client?.db('admin');
    if (!appAdmin) throw new Error('Phase 65 MongoDB client is unavailable');
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const status = await appAdmin.command({ replSetGetStatus: 1 });
        const members = Array.isArray(status.members) ? status.members : [];
        if (
          members.length === 3 &&
          members.filter((member) => member.stateStr === 'PRIMARY').length === 1 &&
          members.filter((member) => member.stateStr === 'SECONDARY').length === 2 &&
          members.every((member) => member.health === 1)
        ) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!ready) {
      throw new Error(
        'Disposable Phase 65 replica set did not reach one primary and two healthy secondaries',
      );
    }
    await db.dropDatabase();
    await provisionPlatformMongoIndexes(db);
  }, 45_000);

  afterAll(async () => {
    try {
      if (factory.client) await factory.client.db(testDatabaseName).dropDatabase();
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

  it('resolves role and permission assignments through the Mongo authorization adapter', async () => {
    const db = await manager.getDatabase();
    const now = new Date();
    const userId = newStableId();
    const roleId = newStableId();
    const permissionId = newStableId();
    await db.collection('platform_roles').insertOne({
      _id: roleId,
      ...documentTimestamps(now),
      schemaVersion: 1,
      code: 'PLATFORM_ADMIN',
    });
    await db.collection('platform_permissions').insertOne({
      _id: permissionId,
      ...documentTimestamps(now),
      schemaVersion: 1,
      code: 'platform.read',
    });
    await db.collection('platform_user_roles').insertOne({
      _id: stableAssignmentId(userId, roleId),
      userId,
      roleId,
    });
    await db.collection('platform_role_permissions').insertOne({
      _id: stableAssignmentId(roleId, permissionId),
      roleId,
      permissionId,
    });

    const authorization = new MongoPlatformAuthorizationRepository(manager);
    const sessionOffset = factory.authorizationReadSessions.length;
    await expect(authorization.findRoleCodesByUserId(userId)).resolves.toEqual(['PLATFORM_ADMIN']);
    await expect(authorization.findRoleIdsByUserId(userId)).resolves.toEqual([roleId]);
    await expect(authorization.findPermissionCodesByUserId(userId)).resolves.toEqual([
      'platform.read',
    ]);
    const readSessions = factory.authorizationReadSessions.slice(sessionOffset);
    expect(readSessions).toHaveLength(8);
    expect(readSessions[0]).toBe(readSessions[1]);
    expect(readSessions[2]).toBe(readSessions[3]);
    expect(readSessions.slice(4)).toEqual(Array(4).fill(readSessions[4]));
    expect(readSessions).not.toContain('undefined');
  }, 20_000);

  it('keeps a transaction snapshot stable while another client revokes a permission', async () => {
    const db = await manager.getDatabase();
    const roleId = newStableId();
    const permissionId = newStableId();
    const assignments = db.collection('platform_role_permissions');
    await assignments.insertOne({
      _id: stableAssignmentId(roleId, permissionId),
      roleId,
      permissionId,
    });

    let beginExternalWrite!: () => void;
    let releaseSnapshotRead!: () => void;
    const firstReadComplete = new Promise<void>((resolve) => {
      beginExternalWrite = resolve;
    });
    const resumeSnapshotRead = new Promise<void>((resolve) => {
      releaseSnapshotRead = resolve;
    });
    const snapshotRead = manager.withTransaction(
      async (session) => {
        const before = await assignments.find({ roleId }, { session }).toArray();
        beginExternalWrite();
        await resumeSnapshotRead;
        const after = await assignments.find({ roleId }, { session }).toArray();
        return [before.length, after.length] as const;
      },
      { readConcern: { level: 'snapshot' } },
    );

    await firstReadComplete;
    try {
      await assignments.deleteOne({ roleId, permissionId });
    } finally {
      releaseSnapshotRead();
    }
    await expect(snapshotRead).resolves.toEqual([1, 1]);
    await expect(assignments.countDocuments({ roleId, permissionId })).resolves.toBe(0);
  }, 20_000);

  it('rejects missing and malformed authorization references and sanitizes active-transaction read failures', async () => {
    const db = await manager.getDatabase();
    const authorization = new MongoPlatformAuthorizationRepository(manager);
    const missingRoleUserId = newStableId();
    const missingRoleId = newStableId();
    await db.collection('platform_user_roles').insertOne({
      _id: stableAssignmentId(missingRoleUserId, missingRoleId),
      userId: missingRoleUserId,
      roleId: missingRoleId,
    });
    await expect(authorization.findRoleCodesByUserId(missingRoleUserId)).rejects.toBeInstanceOf(
      PlatformDocumentValidationError,
    );

    const malformedUserId = newStableId();
    await db.collection('platform_user_roles').insertOne({
      _id: 'malformed-auth-assignment',
      userId: malformedUserId,
      roleId: 'not-a-uuid',
    });
    await expect(authorization.findRoleIdsByUserId(malformedUserId)).rejects.toBeInstanceOf(
      PlatformDocumentValidationError,
    );

    const missingPermissionUserId = newStableId();
    const roleId = newStableId();
    const missingPermissionId = newStableId();
    const now = new Date();
    await db.collection('platform_roles').insertOne({
      _id: roleId,
      ...documentTimestamps(now),
      schemaVersion: 1,
      code: 'SECURITY_ADMIN',
    });
    await db.collection('platform_user_roles').insertOne({
      _id: stableAssignmentId(missingPermissionUserId, roleId),
      userId: missingPermissionUserId,
      roleId,
    });
    await db.collection('platform_role_permissions').insertOne({
      _id: stableAssignmentId(roleId, missingPermissionId),
      roleId,
      permissionId: missingPermissionId,
    });
    await expect(
      authorization.findPermissionCodesByUserId(missingPermissionUserId),
    ).rejects.toBeInstanceOf(PlatformDocumentValidationError);

    const admin = factory.client?.db('admin');
    if (!admin) throw new Error('Phase 65 MongoDB client is unavailable');
    await admin.command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        failCommands: ['find'],
        errorCode: 2,
        errmsg: 'synthetic private database error',
      },
    });
    try {
      await expect(authorization.findPermissionCodesByUserId(newStableId())).rejects.toMatchObject({
        name: new PlatformMongoUnavailableError().name,
        message: new PlatformMongoUnavailableError().message,
      });
    } finally {
      await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
    }
  }, 30_000);

  it('recovers authorization reads after a primary stepdown', async () => {
    const client = factory.client;
    if (!client) throw new Error('Phase 65 MongoDB client is unavailable');
    await client
      .db('admin')
      .command({ replSetStepDown: 5, force: true })
      .catch(() => undefined);

    const authorization = new MongoPlatformAuthorizationRepository(manager);
    const deadline = Date.now() + 30_000;
    let recovered = false;
    while (Date.now() < deadline) {
      try {
        await expect(authorization.findRoleCodesByUserId(newStableId())).resolves.toEqual([]);
        recovered = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    expect(recovered).toBe(true);
  }, 40_000);

  it('implements feature lookup, ordering, unique keys, and conditional status changes', async () => {
    const features = new MongoPlatformFeatureRepository(manager);
    const first = await features.create({ key: 'phase65.feature.alpha', name: 'Alpha' });
    const second = await features.create({
      key: 'phase65.feature.beta',
      name: 'Beta',
      description: 'Synthetic feature',
    });

    await expect(features.findById(first.id)).resolves.toEqual(first);
    await expect(features.findByKey('PHASE65.FEATURE.ALPHA')).resolves.toEqual(first);
    await expect(
      features.create({ key: 'PHASE65.FEATURE.ALPHA', name: 'Duplicate' }),
    ).rejects.toBeInstanceOf(PlatformDocumentConflictError);

    const expectedFirstPage = [first, second].sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
    )[0];
    await expect(features.list({ limit: 1, offset: 0 })).resolves.toEqual([expectedFirstPage]);
    await expect(
      features.updateIfCurrentStatus(first.id, 'INACTIVE', { name: 'Stale update' }),
    ).resolves.toBeNull();
    const updated = await features.updateIfCurrentStatus(first.id, 'ACTIVE', {
      name: 'Updated Alpha',
      description: null,
    });
    expect(updated).toMatchObject({ id: first.id, name: 'Updated Alpha', description: null });

    const changedAt = new Date('2026-11-03T00:00:00.000Z');
    await expect(
      features.changeStatusIfCurrent(first.id, 'ACTIVE', 'INACTIVE', changedAt),
    ).resolves.toMatchObject({ status: 'INACTIVE', statusChangedAt: changedAt });
    await expect(
      features.list({ status: 'INACTIVE', limit: 10, offset: 0 }),
    ).resolves.toContainEqual(expect.objectContaining({ id: first.id }));
    await expect(
      features.changeStatusIfCurrent(first.id, 'ACTIVE', 'INACTIVE', changedAt),
    ).resolves.toBeNull();
  }, 20_000);

  it('implements plan lifecycle and referential plan-feature operations', async () => {
    const plans = new MongoPlatformPlanRepository(manager);
    const features = new MongoPlatformFeatureRepository(manager);
    const feature = await features.create({
      key: 'phase65.plan.feature',
      name: 'Plan Feature',
    });
    const plan = await plans.create({ key: 'phase65.plan.basic', name: 'Basic' });

    await expect(plans.findById(plan.id)).resolves.toEqual(plan);
    await expect(plans.findByKey('PHASE65.PLAN.BASIC')).resolves.toEqual(plan);
    await expect(
      plans.create({ key: 'PHASE65.PLAN.BASIC', name: 'Duplicate Basic' }),
    ).rejects.toBeInstanceOf(PlatformDocumentConflictError);
    await expect(plans.findPlanFeature(plan.id, feature.id)).resolves.toBeNull();

    const attached = await plans.attachFeature(plan.id, feature.id);
    expect(attached).toMatchObject({
      planId: plan.id,
      featureId: feature.id,
      enabled: true,
      quotaLimits: null,
      feature,
    });
    await expect(plans.attachFeature(plan.id, feature.id)).rejects.toBeInstanceOf(
      PlatformDocumentConflictError,
    );
    await expect(plans.listFeatures(plan.id)).resolves.toEqual([attached]);

    await expect(
      plans.updateFeatureConfiguration(plan.id, feature.id, {
        enabled: false,
        quotaLimits: null,
      }),
    ).resolves.toMatchObject({ enabled: false, quotaLimits: null });
    await expect(
      plans.updateFeatureConfiguration(plan.id, newStableId(), { enabled: false }),
    ).resolves.toBeNull();
    await expect(plans.detachFeature(plan.id, feature.id)).resolves.toBe(true);
    await expect(plans.detachFeature(plan.id, feature.id)).resolves.toBe(false);

    await expect(
      plans.changeStatusIfCurrent(plan.id, 'ACTIVE', 'ARCHIVED', new Date()),
    ).resolves.toMatchObject({ status: 'ARCHIVED' });
    await expect(
      plans.changeStatusIfCurrent(plan.id, 'ACTIVE', 'INACTIVE', new Date()),
    ).resolves.toBeNull();
  }, 30_000);

  it('resolves plan entitlements and active quota configurations from one snapshot', async () => {
    const entitlements = new MongoTenantEntitlementRepository(manager);
    const plans = new MongoPlatformPlanRepository(manager);
    const features = new MongoPlatformFeatureRepository(manager);
    const plan = await plans.create({ key: 'phase65.entitlement.plan', name: 'Entitlement' });
    const feature = await features.create({
      key: 'phase65.entitlement.feature',
      name: 'Entitlement Feature',
    });

    await expect(entitlements.resolveFeatureOnPlan(newStableId(), feature.key)).resolves.toEqual({
      kind: 'plan-not-found',
    });
    await expect(
      entitlements.resolveFeatureOnPlan(plan.id, 'phase65.unknown.feature'),
    ).resolves.toEqual({ kind: 'feature-not-found' });
    await expect(entitlements.resolveFeatureOnPlan(plan.id, feature.key)).resolves.toEqual({
      kind: 'plan-feature-missing',
    });

    await plans.attachFeature(plan.id, feature.id);
    await expect(entitlements.resolveFeatureOnPlan(plan.id, feature.key)).resolves.toEqual({
      kind: 'entitled',
      featureId: feature.id,
    });
    await expect(
      entitlements.findActivePlanFeatureQuotaLimits(plan.id, feature.id),
    ).resolves.toEqual({ kind: 'ready', quotaLimits: null });

    await plans.updateFeatureConfiguration(plan.id, feature.id, { enabled: false });
    await expect(entitlements.resolveFeatureOnPlan(plan.id, feature.key)).resolves.toEqual({
      kind: 'plan-feature-disabled',
    });
    await expect(
      entitlements.findActivePlanFeatureQuotaLimits(plan.id, feature.id),
    ).resolves.toEqual({ kind: 'unavailable' });
    await plans.updateFeatureConfiguration(plan.id, feature.id, { enabled: true });

    await features.changeStatusIfCurrent(feature.id, 'ACTIVE', 'INACTIVE', new Date());
    await expect(entitlements.resolveFeatureOnPlan(plan.id, feature.key)).resolves.toEqual({
      kind: 'feature-unavailable',
    });
    await expect(
      entitlements.findActivePlanFeatureQuotaLimits(plan.id, feature.id),
    ).resolves.toEqual({ kind: 'unavailable' });
  }, 30_000);

  it('preserves user authentication reads and atomically records failed logins', async () => {
    const id = newStableId();
    const now = new Date();
    const email = `phase65-auth-${id}@example.test`;
    await repositories.users.create({
      _id: id,
      ...documentTimestamps(now),
      schemaVersion: 1,
      email,
      passwordHash: 'synthetic-hash-only',
      fullName: 'Synthetic Login User',
      status: 'ACTIVE',
      tokenVersion: 7,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    const users = new MongoPlatformUserRepository(manager);
    await expect(users.findAuthRecordById(id)).resolves.toEqual({
      id,
      status: 'ACTIVE',
      tokenVersion: 7,
    });
    await expect(users.findLoginRecordByEmail(email.toUpperCase())).resolves.toMatchObject({
      id,
      email,
      passwordHash: 'synthetic-hash-only',
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    await expect(
      Promise.all(Array.from({ length: 4 }, () => users.recordFailedLogin(id, 3, 15))),
    ).resolves.toEqual(Array.from({ length: 4 }, () => ({ lockApplied: true })));
    const locked = await users.findLoginRecordByEmail(email);
    expect(locked?.failedLoginAttempts).toBe(4);
    expect(locked?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

    await users.resetFailedLogins(id);
    await expect(users.findLoginRecordByEmail(email)).resolves.toMatchObject({
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    await expect(users.recordFailedLogin(newStableId(), 3, 15)).resolves.toEqual({
      lockApplied: false,
    });
    await expect(users.resetFailedLogins(newStableId())).rejects.toBeInstanceOf(
      PlatformDocumentValidationError,
    );
  }, 20_000);

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

  it('implements tenant creation, filtering, stable pagination, and conditional lifecycle updates', async () => {
    const tenants = new MongoTenantRepository(manager);
    const first = await tenants.create({
      slug: `phase65-tenant-${newStableId()}`,
      legalName: 'Synthetic Tenant One',
      displayName: 'Tenant One',
    });
    const second = await tenants.create({
      slug: `phase65-tenant-${newStableId()}`,
      legalName: 'Synthetic Tenant Two',
      displayName: 'Tenant Two',
    });
    await expect(tenants.findById(first.id)).resolves.toEqual(first);
    await expect(tenants.findBySlug(first.slug)).resolves.toEqual(first);
    await expect(tenants.list({ limit: 1, offset: 0 })).resolves.toHaveLength(1);
    await expect(tenants.list({ status: 'ACTIVE', limit: 10, offset: 0 })).resolves.toHaveLength(2);
    const all = await tenants.list({ limit: 10, offset: 0 });
    const firstPage = await tenants.list({ limit: 1, offset: 0 });
    const secondPage = await tenants.list({ limit: 1, offset: 1 });
    expect([...firstPage, ...secondPage].map(({ id }) => id)).toEqual(
      all.slice(0, 2).map(({ id }) => id),
    );
    await expect(
      tenants.create({ slug: first.slug, legalName: 'Duplicate', displayName: 'Duplicate' }),
    ).rejects.toBeInstanceOf(PlatformDocumentConflictError);

    const changedAt = new Date(Date.now() + 1_000);
    await expect(
      tenants.changeStatusIfCurrent(first.id, 'ACTIVE', 'SUSPENDED', changedAt),
    ).resolves.toMatchObject({ status: 'SUSPENDED', suspendedAt: changedAt, updatedAt: changedAt });
    await expect(
      tenants.changeStatusIfCurrent(first.id, 'ACTIVE', 'DEACTIVATED', changedAt),
    ).resolves.toBeNull();
    await expect(
      tenants.changeStatusIfCurrent(second.id, 'ACTIVE', 'DEACTIVATED', changedAt),
    ).resolves.toMatchObject({ status: 'DEACTIVATED', deactivatedAt: changedAt });
  });

  it('preserves approved session and token-history fields through repository updates', async () => {
    const now = new Date();
    const sessionId = newStableId();
    const userId = newStableId();
    const tokenFamilyId = newStableId();
    const session = {
      _id: sessionId,
      schemaVersion: 1 as const,
      createdAt: now,
      userId,
      refreshTokenHash: 'a'.repeat(64),
      tokenFamilyId,
      status: 'ACTIVE' as const,
      ipAddress: null,
      userAgent: null,
      deviceName: null,
      deviceType: null,
      browser: null,
      operatingSystem: null,
      countryCode: null,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
    };
    await repositories.sessions.create(session);
    await expect(
      repositories.sessions.update(sessionId, { status: 'REVOKED' }),
    ).resolves.toMatchObject({ _id: sessionId, status: 'REVOKED' });

    const historyId = newStableId();
    const history = {
      _id: historyId,
      schemaVersion: 1 as const,
      sessionId,
      tokenFamilyId,
      tokenHash: 'b'.repeat(64),
      rotatedAt: now,
      expiresAt: session.expiresAt,
      reuseDetectedAt: null,
    };
    await repositories.refreshTokenHistory.create(history);
    await expect(
      repositories.refreshTokenHistory.update(historyId, { reuseDetectedAt: now }),
    ).resolves.toMatchObject({ _id: historyId, reuseDetectedAt: now });
    await expect(repositories.refreshTokenHistory.findById(historyId)).resolves.toEqual({
      ...history,
      reuseDetectedAt: now,
    });
  });

  it('rotates session tokens atomically and marks reuse as compromise', async () => {
    const now = new Date();
    const userId = newStableId();
    const oldHash = 'c'.repeat(64);
    const nextHash = 'd'.repeat(64);
    const sessions = new MongoPlatformSessionRepository(manager);
    await repositories.users.create({
      _id: userId,
      ...documentTimestamps(now),
      schemaVersion: 1,
      email: `phase65-session-${userId}@example.test`,
      passwordHash: 'synthetic-hash-only',
      fullName: 'Synthetic Session User',
      status: 'ACTIVE',
      tokenVersion: 0,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    const created = await sessions.create({
      userId,
      refreshTokenHash: oldHash,
      tokenFamilyId: newStableId(),
      expiresAt: new Date(now.getTime() + 60_000),
      ipAddress: '127.0.0.1',
      userAgent: 'synthetic-test-agent',
    });
    await expect(
      sessions.create({
        userId: newStableId(),
        refreshTokenHash: '9'.repeat(64),
        tokenFamilyId: newStableId(),
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    ).rejects.toBeInstanceOf(PlatformDocumentValidationError);
    await expect(
      sessions.create({
        userId,
        refreshTokenHash: oldHash,
        tokenFamilyId: newStableId(),
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    ).rejects.toBeInstanceOf(PlatformDocumentConflictError);
    expect(created.status).toBe('ACTIVE');
    await expect(sessions.findByIdForUser(created.id, newStableId())).resolves.toBeNull();
    await expect(sessions.rotateByRefreshTokenHash(oldHash, nextHash, now)).resolves.toMatchObject({
      kind: 'rotated',
      session: { id: created.id, refreshTokenHash: nextHash, status: 'ACTIVE' },
    });
    const replay = await sessions.rotateByRefreshTokenHash(
      oldHash,
      'e'.repeat(64),
      new Date(now.getTime() + 1),
    );
    expect(replay).toEqual({ kind: 'reused', sessionId: created.id, subjectUserId: userId });
    await expect(sessions.findById(created.id)).resolves.toMatchObject({
      status: 'COMPROMISED',
      revocationReason: 'Refresh token reuse detected',
    });
    const db = await manager.getDatabase();
    const history = await db
      .collection('platform_refresh_token_history')
      .findOne({ tokenHash: oldHash });
    expect(history?.reuseDetectedAt).toBeInstanceOf(Date);

    const raceHash = '8'.repeat(64);
    const racing = await sessions.create({
      userId,
      refreshTokenHash: raceHash,
      tokenFamilyId: newStableId(),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const rotations = await Promise.allSettled([
      sessions.rotateByRefreshTokenHash(raceHash, '7'.repeat(64), now),
      sessions.rotateByRefreshTokenHash(raceHash, '6'.repeat(64), now),
    ]);
    expect(rotations.every((result) => result.status === 'fulfilled')).toBe(true);
    const rotationKinds = rotations.map((result) =>
      result.status === 'fulfilled' ? result.value.kind : 'failed',
    );
    expect(rotationKinds.sort()).toEqual(['reused', 'rotated']);
    await expect(sessions.findById(racing.id)).resolves.toMatchObject({ status: 'COMPROMISED' });
  }, 20_000);

  it('preserves session lookup, ordering, activity, and lifecycle transitions', async () => {
    const now = new Date();
    const userId = newStableId();
    await repositories.users.create({
      _id: userId,
      ...documentTimestamps(now),
      schemaVersion: 1,
      email: `phase65-session-lifecycle-${userId}@example.test`,
      passwordHash: 'synthetic-hash-only',
      fullName: 'Synthetic Session Lifecycle User',
      status: 'ACTIVE',
      tokenVersion: 0,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    const sessions = new MongoPlatformSessionRepository(manager);
    const first = await sessions.create({
      userId,
      refreshTokenHash: 'f'.repeat(64),
      tokenFamilyId: newStableId(),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const second = await sessions.create({
      userId,
      refreshTokenHash: '0'.repeat(64),
      tokenFamilyId: first.tokenFamilyId,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await expect(sessions.findByRefreshTokenHash(first.refreshTokenHash)).resolves.toMatchObject({
      id: first.id,
    });
    await expect(sessions.findByIdForUser(first.id, userId)).resolves.toMatchObject({
      id: first.id,
    });
    await expect(sessions.findByTokenFamilyId(first.tokenFamilyId)).resolves.toHaveLength(2);
    await expect(sessions.listByUserId(userId)).resolves.toHaveLength(2);
    await expect(sessions.findActiveByUserId(userId)).resolves.toHaveLength(2);

    const activityTime = new Date(now.getTime() + 1_000);
    await expect(sessions.updateLastActivity(first.id, activityTime)).resolves.toMatchObject({
      lastActivityAt: activityTime,
    });
    await expect(sessions.revokeOne(second.id, userId, 'user requested')).resolves.toMatchObject({
      status: 'REVOKED',
      revokedBy: userId,
    });
    await expect(sessions.revokeAllForUser(userId, userId, 'sign out all')).resolves.toBe(1);
    await expect(sessions.findActiveByUserId(userId)).resolves.toHaveLength(0);
    await expect(sessions.findById(first.id)).resolves.toMatchObject({
      status: 'REVOKED',
      revocationReason: 'sign out all',
    });

    await expect(sessions.markExpired(second.id)).resolves.toMatchObject({ status: 'EXPIRED' });
    await expect(sessions.markCompromised(first.id)).resolves.toMatchObject({
      status: 'COMPROMISED',
    });
    await expect(sessions.revokeAll(userId)).resolves.toBe(0);
  }, 20_000);

  it('commits and aborts through the managed platform transaction boundary', async () => {
    const db = await manager.getDatabase();
    const collection = db.collection('phase65_transaction_boundary');
    let committedSession: ClientSession | undefined;
    await manager.withTransaction(async (session) => {
      committedSession = session;
      await collection.insertOne({ _id: 'committed', value: 1 }, { session });
    });
    expect(await collection.findOne({ _id: 'committed' })).toMatchObject({ value: 1 });
    expect(committedSession?.hasEnded).toBe(true);

    let abortedSession: ClientSession | undefined;
    await expect(
      manager.withTransaction(async (session) => {
        abortedSession = session;
        await collection.insertOne({ _id: 'aborted', value: 2 }, { session });
        throw new PlatformDocumentConflictError();
      }),
    ).rejects.toBeInstanceOf(PlatformDocumentConflictError);
    expect(await collection.findOne({ _id: 'aborted' })).toBeNull();
    expect(abortedSession?.hasEnded).toBe(true);
  }, 20_000);

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

  it('recovers readiness and repository operations after an injected connection close', async () => {
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
    const id = newStableId();
    const now = new Date();
    await expect(
      repositories.tenants.create({
        _id: id,
        ...documentTimestamps(now),
        schemaVersion: 1,
        slug: `recovery-${id}`,
        legalName: 'Synthetic Recovery Tenant',
        displayName: 'Synthetic Recovery Tenant',
        status: 'ACTIVE',
        statusChangedAt: now,
        suspendedAt: null,
        deactivatedAt: null,
      }),
    ).resolves.toMatchObject({ _id: id });
  }, 60_000);

  it('enforces facility tenant references, isolation, lifecycle CAS, and stable pagination', async () => {
    const facilities = new MongoFacilityRepository(manager);
    const tenantA = await repositories.tenants.create({
      _id: newStableId(),
      ...documentTimestamps(),
      schemaVersion: 1,
      slug: `facility-a-${newStableId()}`,
      legalName: 'Synthetic Facility Tenant A',
      displayName: 'Synthetic Facility Tenant A',
      status: 'ACTIVE',
      statusChangedAt: new Date(),
      suspendedAt: null,
      deactivatedAt: null,
    });
    const tenantB = await repositories.tenants.create({
      _id: newStableId(),
      ...documentTimestamps(),
      schemaVersion: 1,
      slug: `facility-b-${newStableId()}`,
      legalName: 'Synthetic Facility Tenant B',
      displayName: 'Synthetic Facility Tenant B',
      status: 'ACTIVE',
      statusChangedAt: new Date(),
      suspendedAt: null,
      deactivatedAt: null,
    });
    await expect(
      facilities.create(newStableId(), { name: 'Missing-parent facility' }),
    ).rejects.toBeInstanceOf(PlatformDocumentConflictError);
    const older = await facilities.create(tenantA._id, { name: 'Older synthetic facility' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const newer = await facilities.create(tenantA._id, { name: 'Newer synthetic facility' });
    expect(await facilities.findById(tenantB._id, older.id)).toBeNull();
    expect(await facilities.listForTenant(tenantA._id, { limit: 1, offset: 0 })).toMatchObject([
      { id: newer.id },
    ]);
    expect(await facilities.updateName(tenantA._id, older.id, 'Renamed facility')).toMatchObject({
      name: 'Renamed facility',
    });
    const changedAt = new Date(Date.now() + 10);
    await expect(
      facilities.changeStatusIfCurrent(tenantA._id, older.id, 'ACTIVE', 'SUSPENDED', changedAt),
    ).resolves.toMatchObject({
      status: 'SUSPENDED',
      statusChangedAt: changedAt,
      suspendedAt: changedAt,
    });
    await expect(
      facilities.changeStatusIfCurrent(tenantA._id, older.id, 'ACTIVE', 'DEACTIVATED', changedAt),
    ).resolves.toBeNull();
  });

  it('persists audit/security events with reference checks, idempotent lookup, and one-time resolution', async () => {
    const audit = new MongoPlatformAuditRepository(manager);
    const userId = newStableId();
    const tenantId = newStableId();
    const now = new Date();
    await repositories.users.create({
      _id: userId,
      ...documentTimestamps(now),
      schemaVersion: 1,
      email: `audit-${userId}@example.test`,
      passwordHash: 'synthetic-hash-only',
      fullName: 'Synthetic Audit User',
      status: 'ACTIVE',
      tokenVersion: 0,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    await repositories.tenants.create({
      _id: tenantId,
      ...documentTimestamps(now),
      schemaVersion: 1,
      slug: `audit-${tenantId}`,
      legalName: 'Synthetic Audit Tenant',
      displayName: 'Synthetic Audit Tenant',
      status: 'ACTIVE',
      statusChangedAt: now,
      suspendedAt: null,
      deactivatedAt: null,
    });
    const auditId = newStableId();
    const event = {
      id: auditId,
      eventType: 'AUTH_LOGIN_SUCCEEDED' as const,
      actorUserId: userId,
      subjectTenantId: tenantId,
      requestId: 'synthetic-request',
      metadata: { source: 'integration-test', accepted: true },
    };
    await expect(audit.createAuditLog(event)).resolves.toMatchObject({
      id: auditId,
      actorUserId: userId,
      subjectTenantId: tenantId,
    });
    await expect(audit.createAuditLog(event)).rejects.toBeInstanceOf(PlatformDocumentConflictError);
    await expect(audit.findAuditLog(auditId)).resolves.toMatchObject({
      id: auditId,
      eventType: 'AUTH_LOGIN_SUCCEEDED',
      metadata: event.metadata,
    });
    await expect(
      audit.createAuditLog({
        ...event,
        id: newStableId(),
        actorUserId: newStableId(),
      }),
    ).rejects.toBeInstanceOf(PlatformDocumentConflictError);

    const security = await audit.createSecurityEvent({
      eventType: 'AUTH_LOGIN_FAILED',
      actorUserId: userId,
      metadata: { reason: 'synthetic' },
    });
    await expect(
      audit.resolveSecurityEvent(security.id, userId, 'Reviewed synthetic event'),
    ).resolves.toBe(true);
    await expect(
      audit.resolveSecurityEvent(security.id, userId, 'Duplicate resolution'),
    ).resolves.toBe(false);
  });

  it('implements tenant healthcare catalogs with unique names, scoped reads, and lifecycle CAS', async () => {
    const catalogs = new MongoHealthcareCatalogRepository(manager);
    const activeTenant = await repositories.tenants.create({
      _id: newStableId(),
      ...documentTimestamps(),
      schemaVersion: 1,
      slug: `healthcare-active-${newStableId()}`,
      legalName: 'Synthetic Healthcare Tenant',
      displayName: 'Synthetic Healthcare Tenant',
      status: 'ACTIVE',
      statusChangedAt: new Date(),
      suspendedAt: null,
      deactivatedAt: null,
    });
    const inactiveTenant = await repositories.tenants.create({
      _id: newStableId(),
      ...documentTimestamps(),
      schemaVersion: 1,
      slug: `healthcare-inactive-${newStableId()}`,
      legalName: 'Synthetic Inactive Tenant',
      displayName: 'Synthetic Inactive Tenant',
      status: 'SUSPENDED',
      statusChangedAt: new Date(),
      suspendedAt: new Date(),
      deactivatedAt: null,
    });
    const department = await catalogs.create('department', activeTenant._id, {
      name: 'Cardiology',
      description: 'Synthetic department',
    });
    expect(department.kind).toBe('changed');
    if (department.kind !== 'changed') throw new Error('Synthetic department was not created');
    await expect(
      catalogs.create('department', activeTenant._id, { name: 'CARDIOLOGY' }),
    ).resolves.toEqual({ kind: 'name-conflict' });
    await expect(
      catalogs.create('specialty', inactiveTenant._id, { name: 'Unavailable specialty' }),
    ).resolves.toEqual({ kind: 'tenant-inactive' });
    expect(
      await catalogs.findById('department', inactiveTenant._id, department.record.id),
    ).toBeNull();
    await expect(
      catalogs.list('department', activeTenant._id, { limit: 1, offset: 0 }),
    ).resolves.toMatchObject([{ id: department.record.id, name: 'Cardiology' }]);
    const specialty = await catalogs.create('specialty', activeTenant._id, {
      name: 'Cardiology',
      description: null,
    });
    expect(specialty.kind).toBe('changed');
    await expect(
      catalogs.update('department', activeTenant._id, department.record.id, {
        name: 'Neurology',
        description: null,
      }),
    ).resolves.toMatchObject({
      kind: 'changed',
      record: { name: 'Neurology', description: null },
    });
    const changedAt = new Date(Date.now() + 10);
    await expect(
      catalogs.changeStatusIfCurrent(
        'department',
        activeTenant._id,
        department.record.id,
        'ACTIVE',
        'SUSPENDED',
        changedAt,
      ),
    ).resolves.toMatchObject({
      kind: 'changed',
      record: { status: 'SUSPENDED', statusChangedAt: changedAt, suspendedAt: changedAt },
    });
    await expect(
      catalogs.changeStatusIfCurrent(
        'department',
        activeTenant._id,
        department.record.id,
        'ACTIVE',
        'DEACTIVATED',
        changedAt,
      ),
    ).resolves.toEqual({ kind: 'not-changed' });
  });

  it('preserves service catalog nullable-code uniqueness, conflict kinds, counts, and lifecycle rules', async () => {
    const services = new MongoServiceCatalogRepository(manager);
    const activeTenant = await repositories.tenants.create({
      _id: newStableId(),
      ...documentTimestamps(),
      schemaVersion: 1,
      slug: `services-active-${newStableId()}`,
      legalName: 'Synthetic Service Tenant',
      displayName: 'Synthetic Service Tenant',
      status: 'ACTIVE',
      statusChangedAt: new Date(),
      suspendedAt: null,
      deactivatedAt: null,
    });
    const inactiveTenant = await repositories.tenants.create({
      _id: newStableId(),
      ...documentTimestamps(),
      schemaVersion: 1,
      slug: `services-inactive-${newStableId()}`,
      legalName: 'Synthetic Inactive Service Tenant',
      displayName: 'Synthetic Inactive Service Tenant',
      status: 'SUSPENDED',
      statusChangedAt: new Date(),
      suspendedAt: new Date(),
      deactivatedAt: null,
    });
    const first = await services.create(activeTenant._id, { name: 'Imaging' });
    const second = await services.create(activeTenant._id, { name: 'Laboratory' });
    const coded = await services.create(activeTenant._id, {
      name: 'Administration',
      code: 'ADM',
      description: 'Synthetic service',
    });
    expect(first.kind).toBe('changed');
    expect(second.kind).toBe('changed');
    expect(coded.kind).toBe('changed');
    if (first.kind !== 'changed' || second.kind !== 'changed' || coded.kind !== 'changed') {
      throw new Error('Synthetic services were not created');
    }
    await expect(services.create(activeTenant._id, { name: 'IMAGING' })).resolves.toEqual({
      kind: 'name-conflict',
    });
    await expect(
      services.create(activeTenant._id, { name: 'Admin copy', code: 'adm' }),
    ).resolves.toEqual({ kind: 'code-conflict' });
    await expect(services.create(inactiveTenant._id, { name: 'Unavailable' })).resolves.toEqual({
      kind: 'tenant-inactive',
    });
    await expect(
      services.update(activeTenant._id, second.record.id, { code: 'ADM' }),
    ).resolves.toEqual({ kind: 'code-conflict' });
    const servicePage = await services.list(activeTenant._id, { limit: 2, offset: 0 });
    expect(servicePage.total).toBe(3);
    expect(servicePage.items.map((item) => item.name)).toContain('Administration');
    expect(await services.findById(inactiveTenant._id, first.record.id)).toBeNull();
    await expect(
      services.update(activeTenant._id, first.record.id, { description: null }),
    ).resolves.toMatchObject({ kind: 'changed', record: { description: null } });
    const changedAt = new Date(Date.now() + 10);
    await expect(
      services.changeStatusIfCurrent(
        activeTenant._id,
        first.record.id,
        'ACTIVE',
        'DEACTIVATED',
        changedAt,
      ),
    ).resolves.toMatchObject({
      kind: 'changed',
      record: { status: 'DEACTIVATED', statusChangedAt: changedAt, deactivatedAt: changedAt },
    });
    await expect(
      services.changeStatusIfCurrent(
        activeTenant._id,
        first.record.id,
        'ACTIVE',
        'SUSPENDED',
        changedAt,
      ),
    ).resolves.toEqual({ kind: 'not-changed' });
  });

  it('enforces subscription periods and lifecycle transitions transactionally', async () => {
    const subscriptions = new MongoSubscriptionRepository(manager);
    const tenant = await repositories.tenants.create({
      _id: newStableId(),
      ...documentTimestamps(),
      schemaVersion: 1,
      slug: `subscription-${newStableId()}`,
      legalName: 'Synthetic Subscription Tenant',
      displayName: 'Synthetic Subscription Tenant',
      status: 'ACTIVE',
      statusChangedAt: new Date(),
      suspendedAt: null,
      deactivatedAt: null,
    });
    const planId = newStableId();
    const now = new Date();
    await manager.getDatabase().then((db) =>
      db.collection('platform_plans').insertOne({
        _id: planId,
        ...documentTimestamps(now),
        schemaVersion: 1,
        key: `subscription-${planId}`,
        name: 'Synthetic subscription plan',
        description: null,
        status: 'ACTIVE',
        statusChangedAt: now,
      }),
    );
    const firstStart = new Date(now.getTime() - 60_000);
    const firstEnd = new Date(now.getTime() + 60_000);
    const created = await subscriptions.createForActiveTenantAndPlan({
      tenantId: tenant._id,
      planId,
      status: 'ACTIVE',
      startsAt: firstStart,
      endsAt: firstEnd,
    });
    expect(created.kind).toBe('created');
    if (created.kind !== 'created') throw new Error('Synthetic subscription was not created');
    await expect(subscriptions.findById(created.subscription.id)).resolves.toMatchObject({
      tenantId: tenant._id,
      planId,
    });
    await expect(
      subscriptions.createForActiveTenantAndPlan({
        tenantId: tenant._id,
        planId,
        status: 'ACTIVE',
        startsAt: now,
        endsAt: null,
      }),
    ).resolves.toEqual({ kind: 'period-conflict' });
    const afterFirst = new Date(firstEnd.getTime() + 1);
    const concurrent = await Promise.all([
      subscriptions.createForActiveTenantAndPlan({
        tenantId: tenant._id,
        planId,
        status: 'ACTIVE',
        startsAt: afterFirst,
        endsAt: null,
      }),
      subscriptions.createForActiveTenantAndPlan({
        tenantId: tenant._id,
        planId,
        status: 'ACTIVE',
        startsAt: afterFirst,
        endsAt: null,
      }),
    ]);
    expect(concurrent.map((result) => result.kind).sort()).toEqual(['created', 'period-conflict']);
    await expect(subscriptions.findCurrentForTenant(tenant._id, now)).resolves.toMatchObject([
      { id: created.subscription.id, status: 'ACTIVE' },
    ]);
    await expect(
      subscriptions.transition(created.subscription.id, 'suspend', now),
    ).resolves.toMatchObject({
      kind: 'updated',
      previousStatus: 'ACTIVE',
      subscription: { status: 'SUSPENDED' },
    });
    await expect(
      subscriptions.transition(created.subscription.id, 'activate', now),
    ).resolves.toMatchObject({
      kind: 'updated',
      previousStatus: 'SUSPENDED',
      subscription: { status: 'ACTIVE' },
    });
    await expect(
      subscriptions.transition(created.subscription.id, 'cancel', now),
    ).resolves.toMatchObject({
      kind: 'updated',
      previousStatus: 'ACTIVE',
      subscription: { status: 'CANCELLED', cancelledAt: now },
    });
    await expect(
      subscriptions.transition(created.subscription.id, 'activate', now),
    ).resolves.toEqual({ kind: 'transition-invalid' });
  });

  it('implements tenant role metadata, permission replacement, and initial owner bootstrap', async () => {
    const roles = new MongoTenantRoleRepository(manager);
    const tenant = await repositories.tenants.create({
      _id: newStableId(),
      ...documentTimestamps(),
      schemaVersion: 1,
      slug: `roles-${newStableId()}`,
      legalName: 'Synthetic Role Tenant',
      displayName: 'Synthetic Role Tenant',
      status: 'ACTIVE',
      statusChangedAt: new Date(),
      suspendedAt: null,
      deactivatedAt: null,
    });
    const now = new Date();
    const permissions = TENANT_PERMISSION_DEFINITIONS.map((permission) => ({
      _id: newStableId(),
      ...documentTimestamps(now),
      schemaVersion: 1 as const,
      code: permission.code,
      description: permission.description,
    }));
    const membershipId = newStableId();
    const platformUserId = newStableId();
    await Promise.all([
      manager
        .getDatabase()
        .then((db) => db.collection('tenant_permissions').insertMany(permissions)),
      manager.getDatabase().then((db) =>
        db.collection('tenant_memberships').insertOne({
          _id: membershipId,
          ...documentTimestamps(now),
          schemaVersion: 1,
          tenantId: tenant._id,
          platformUserId,
          status: 'ACTIVE',
          statusChangedAt: now,
          activatedAt: now,
          suspendedAt: null,
          removedAt: null,
        }),
      ),
    ]);
    const permissionCode = TENANT_PERMISSION_DEFINITIONS[0].code;
    const custom = await roles.create({
      tenantId: tenant._id,
      code: 'REPORT_VIEWER',
      name: 'Report Viewer',
      description: null,
    });
    expect(custom.permissions).toEqual([]);
    await expect(
      roles.create({
        tenantId: tenant._id,
        code: 'REPORT_VIEWER',
        name: 'Duplicate',
      }),
    ).rejects.toBeInstanceOf(PlatformDocumentConflictError);
    await expect(
      roles.replacePermissions(tenant._id, custom.id, [permissionCode]),
    ).resolves.toMatchObject({
      id: custom.id,
      permissions: [{ permission: { code: permissionCode } }],
    });
    await expect(
      roles.updateMetadata(tenant._id, custom.id, { name: 'Updated Viewer' }),
    ).resolves.toMatchObject({ name: 'Updated Viewer' });
    const bootstrap = await roles.bootstrapInitialOwner({
      tenantId: tenant._id,
      platformUserId,
    });
    expect(bootstrap.ownerMembershipId).toBe(membershipId);
    expect(bootstrap.createdRoleCodes).toEqual(['OWNER', 'ADMIN', 'MEMBER']);
    expect(bootstrap.roles.map((role) => role.code)).toEqual(['ADMIN', 'MEMBER', 'OWNER']);
    expect(bootstrap.roles.find((role) => role.code === 'OWNER')?.permissions.length).toBe(
      TENANT_PERMISSION_DEFINITIONS.length,
    );
    await expect(
      roles.updateMetadata(tenant._id, bootstrap.roles.find((role) => role.code === 'OWNER')!.id, {
        name: 'Blocked system role edit',
      }),
    ).resolves.toBeNull();
    await expect(
      roles.bootstrapInitialOwner({
        tenantId: tenant._id,
        platformUserId,
      }),
    ).rejects.toBeInstanceOf(TenantOwnerBootstrapConflictError);
    await expect(
      roles.replacePermissions(tenant._id, custom.id, [
        'tenant.permission.not-configured' as (typeof TENANT_PERMISSION_DEFINITIONS)[number]['code'],
      ]),
    ).rejects.toBeInstanceOf(TenantPermissionCatalogUnavailableError);
  });

  it('enforces active facility and tenant scope for branch CRUD and lifecycle updates', async () => {
    const facilities = new MongoFacilityRepository(manager);
    const branches = new MongoBranchRepository(manager);
    const tenant = await repositories.tenants.create({
      _id: newStableId(),
      ...documentTimestamps(),
      schemaVersion: 1,
      slug: `branches-${newStableId()}`,
      legalName: 'Synthetic Branch Tenant',
      displayName: 'Synthetic Branch Tenant',
      status: 'ACTIVE',
      statusChangedAt: new Date(),
      suspendedAt: null,
      deactivatedAt: null,
    });
    const otherTenant = await repositories.tenants.create({
      _id: newStableId(),
      ...documentTimestamps(),
      schemaVersion: 1,
      slug: `branch-other-${newStableId()}`,
      legalName: 'Synthetic Other Tenant',
      displayName: 'Synthetic Other Tenant',
      status: 'ACTIVE',
      statusChangedAt: new Date(),
      suspendedAt: null,
      deactivatedAt: null,
    });
    const facility = await facilities.create(tenant._id, { name: 'Branch test facility' });
    await expect(branches.findFacilityScope(tenant._id, facility.id)).resolves.toMatchObject({
      id: facility.id,
      status: 'ACTIVE',
      tenant: { status: 'ACTIVE' },
    });
    const branch = await branches.createUnderActiveFacility(tenant._id, facility.id, {
      name: 'Outpatient',
    });
    expect(branch).toMatchObject({ facilityId: facility.id, name: 'Outpatient', status: 'ACTIVE' });
    if (!branch) throw new Error('Synthetic branch was not created');
    await expect(
      branches.findByIdWithinFacility(otherTenant._id, facility.id, branch.id),
    ).resolves.toBeNull();
    await expect(
      branches.listForFacility(tenant._id, facility.id, { limit: 10, offset: 0 }),
    ).resolves.toMatchObject([{ id: branch.id }]);
    await expect(
      branches.updateNameWithinFacility(tenant._id, facility.id, branch.id, 'Clinic'),
    ).resolves.toMatchObject({ name: 'Clinic' });
    const changedAt = new Date(Date.now() + 10);
    await expect(
      branches.changeStatusIfCurrentWithinFacility(
        tenant._id,
        facility.id,
        branch.id,
        'ACTIVE',
        'SUSPENDED',
        changedAt,
      ),
    ).resolves.toMatchObject({
      status: 'SUSPENDED',
      statusChangedAt: changedAt,
      suspendedAt: changedAt,
    });
    await expect(
      branches.changeStatusIfCurrentWithinFacility(
        tenant._id,
        facility.id,
        branch.id,
        'ACTIVE',
        'DEACTIVATED',
        changedAt,
      ),
    ).resolves.toBeNull();
    await facilities.changeStatusIfCurrent(
      tenant._id,
      facility.id,
      'ACTIVE',
      'SUSPENDED',
      changedAt,
    );
    await expect(
      branches.createUnderActiveFacility(tenant._id, facility.id, { name: 'Blocked branch' }),
    ).resolves.toBeNull();
    await expect(
      branches.listForFacility(tenant._id, facility.id, { limit: 10, offset: 0 }),
    ).resolves.toEqual([]);
    await expect(
      branches.updateNameWithinFacility(tenant._id, facility.id, branch.id, 'Blocked edit'),
    ).resolves.toBeNull();
  });
});
