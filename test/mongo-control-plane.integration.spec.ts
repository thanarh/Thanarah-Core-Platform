import { createHash, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { Db, Document, Collection } from 'mongodb';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import {
  PlatformMongoClientManager,
  OfficialPlatformMongoClientFactory,
} from '../src/platform-mongo/platform-mongo.client.manager';
import { provisionPlatformMongoIndexes } from '../src/platform-mongo/platform-mongo.indexes';
import { MongoSubscriptionPaymentService } from '../src/platform-mongo/mongo-subscription-payment.service';
import { MongoEncounterOperationStore } from '../src/platform-mongo/mongo-encounter-operation.store';
import { MongoTenantStorageRegistryService } from '../src/platform-mongo/mongo-tenant-storage-registry.service';
import { MongoTenantStorageActivationService } from '../src/platform-mongo/mongo-tenant-storage-activation.service';
import { MongoCentralReadinessService } from '../src/platform-mongo/mongo-central-readiness.service';
import { PlatformDocumentConflictError } from '../src/platform-mongo/platform-mongo.errors';
import { documentTimestamps } from '../src/platform-mongo/platform-mongo.models';

const uri = process.env.PHASE65_PLATFORM_MONGO_URI;
const base = process.env.PHASE65_PLATFORM_MONGO_DATABASE;
const integration = uri && base ? describe : describe.skip;
integration('Mongo-only control-plane contracts', () => {
  let db: Db;
  let client: MongoClient;
  let manager: PlatformMongoClientManager;
  let payments: MongoSubscriptionPaymentService;
  let ledger: MongoEncounterOperationStore;
  let registry: MongoTenantStorageRegistryService;
  let activation: MongoTenantStorageActivationService;
  const ensureIndexesForTarget = vi.fn(async () => undefined);
  const ids = {
    tenant: randomUUID(),
    other: randomUUID(),
    actor: randomUUID(),
    plan: randomUUID(),
    subscription: randomUUID(),
    operation: randomUUID(),
    encounter: randomUUID(),
  };
  const actor = { userId: ids.actor } as AuthenticatedPlatformUser;
  const context = {
    tenantId: ids.tenant,
    membershipId: randomUUID(),
    platformUserId: ids.actor,
  } as TrustedTenantContext;
  const col = (name: string): Collection<Document & { _id: string }> =>
    db.collection<Document & { _id: string }>(name);
  const receiptBytes = Buffer.from('synthetic receipt');
  const receipt = {
    bytes: receiptBytes,
    fileName: 'synthetic.png',
    mimeType: 'image/png' as const,
    sha256: createHash('sha256').update(receiptBytes).digest('hex'),
  };
  const settings = (): Parameters<MongoSubscriptionPaymentService['updateSettings']>[0] => ({
    expectedVersion: 0,
    enabled: true,
    bankName: 'Synthetic bank',
    accountHolder: 'Synthetic account',
    iban: 'SYNTHETIC123456',
    currencyCode: 'SAR',
  });
  const operation = (): Parameters<
    MongoEncounterOperationStore['encounterOperation']['create']
  >[0]['data'] => ({
    id: ids.operation,
    tenantId: ids.tenant,
    resourceType: 'encounter' as const,
    resourceId: ids.encounter,
    operationType: 'CREATED',
    actorUserId: ids.actor,
    historyEventId: ids.operation,
    auditEventType: 'ENCOUNTER_CREATED',
    auditMetadata: { synthetic: true },
    mutationState: 'PREPARED' as const,
    expectedVersion: 0,
  });

  beforeAll(async () => {
    if (
      !uri ||
      !base ||
      !/^mongodb:\/\/127\.0\.0\.1:45271,127\.0\.0\.1:45272,127\.0\.0\.1:45273\/\?replicaSet=rs0&retryWrites=true$/u.test(
        uri,
      ) ||
      !/^phase65_platform_[a-zA-Z0-9_]+$/u.test(base)
    )
      throw new Error('Only the disposable replica set is allowed');
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(`${base}_control`);
    manager = new PlatformMongoClientManager(
      { platformMongoUri: uri, platformMongoDatabase: db.databaseName } as ConfigService,
      new OfficialPlatformMongoClientFactory(),
    );
    payments = new MongoSubscriptionPaymentService(manager);
    ledger = new MongoEncounterOperationStore(manager);
    registry = new MongoTenantStorageRegistryService(manager);
    const indexer = { ensureIndexesForTarget };
    activation = new MongoTenantStorageActivationService(
      manager,
      indexer as never,
      indexer as never,
      indexer as never,
      indexer as never,
    );
    await provisionPlatformMongoIndexes(db);
  }, 30_000);
  beforeEach(async () => {
    ensureIndexesForTarget.mockClear();
    for (const name of [
      'tenants',
      'subscriptions',
      'platform_plans',
      'subscription_payment_settings',
      'subscription_transfers',
      'encounter_operations',
      'tenant_storage_targets',
    ])
      await col(name).deleteMany({});
    const now = new Date();
    const common = { ...documentTimestamps(now), schemaVersion: 1 };
    for (const id of [ids.tenant, ids.other])
      await col('tenants').insertOne({
        _id: id,
        ...common,
        slug: id,
        legalName: 'Synthetic',
        displayName: 'Synthetic',
        status: 'ACTIVE',
        statusChangedAt: now,
        suspendedAt: null,
        deactivatedAt: null,
      });
    await col('platform_plans').insertOne({
      _id: ids.plan,
      ...common,
      key: 'synthetic',
      name: 'Synthetic',
      description: null,
      status: 'ACTIVE',
      statusChangedAt: now,
    });
    await col('subscriptions').insertOne({
      _id: ids.subscription,
      ...common,
      tenantId: ids.tenant,
      planId: ids.plan,
      status: 'ACTIVE',
      startsAt: new Date(now.getTime() - 1000),
      endsAt: null,
      cancelledAt: null,
    });
  });
  afterAll(async () => {
    try {
      if (db) await db.dropDatabase();
    } finally {
      await manager?.onApplicationShutdown();
      await client?.close();
    }
  });

  it('keeps missing bank settings disabled and applies versioned, audited updates', async () => {
    expect(await payments.getSettings()).toMatchObject({ enabled: false, version: 0 });
    expect(await payments.updateSettings(settings(), actor)).toMatchObject({
      enabled: true,
      version: 1,
      history: [{ action: 'UPDATED' }],
    });
    await expect(payments.updateSettings(settings(), actor)).rejects.toMatchObject({ status: 409 });
    expect(
      await payments.updateSettings({ ...settings(), enabled: false, expectedVersion: 1 }, actor),
    ).toMatchObject({ enabled: false, version: 2 });
  });
  it('permits exactly one concurrent first settings update', async () => {
    const results = await Promise.allSettled([
      payments.updateSettings(settings(), actor),
      payments.updateSettings(settings(), actor),
    ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((row) => row.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason.getStatus()).toBe(409);
  });
  it('stores and retrieves binary receipts without exposing bytes or retry hashes in listings', async () => {
    await payments.updateSettings(settings(), actor);
    const result = await payments.submitTransfer(
      ids.subscription,
      receipt,
      { amountMinor: '12345', currencyCode: 'SAR' },
      actor,
      'synthetic-key',
    );
    expect(result).toMatchObject({ status: 'PENDING_REVIEW', amountMinor: '12345', version: 1 });
    expect(result).not.toHaveProperty('receiptBytes');
    expect(result).not.toHaveProperty('idempotencyKeyHash');
    const stored = await payments.getTransferReceipt(result.id);
    expect(Buffer.from(stored.receiptBytes)).toEqual(receiptBytes);
    expect(stored.amountMinor).toBe(12345n);
    expect(
      (await payments.listTransfers({ tenantId: ids.tenant, limit: 1, offset: 0 })).total,
    ).toBe(1);
    expect(
      (await payments.listTransfers({ tenantId: ids.other, limit: 10, offset: 0 })).items,
    ).toEqual([]);
  });
  it('replays identical submissions and rejects a changed payload or competing open transfer', async () => {
    await payments.updateSettings(settings(), actor);
    const first = await payments.submitTransfer(
      ids.subscription,
      receipt,
      {},
      actor,
      'synthetic-key',
    );
    expect(
      (await payments.submitTransfer(ids.subscription, receipt, {}, actor, 'synthetic-key')).id,
    ).toBe(first.id);
    await expect(
      payments.submitTransfer(
        ids.subscription,
        { ...receipt, sha256: 'f'.repeat(64) },
        {},
        actor,
        'synthetic-key',
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      payments.submitTransfer(ids.subscription, receipt, {}, actor, 'another-key'),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('serializes competing transfers and reviews with expected-version protection', async () => {
    await payments.updateSettings(settings(), actor);
    const results = await Promise.allSettled([
      payments.submitTransfer(ids.subscription, receipt, {}, actor),
      payments.submitTransfer(ids.subscription, receipt, {}, actor),
    ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    const first = results.find((row) => row.status === 'fulfilled');
    if (!first || first.status !== 'fulfilled') throw new Error('Missing synthetic transfer');
    const reviewed = await payments.reviewTransfer(
      first.value.id,
      { expectedVersion: 1, reason: 'Synthetic review' },
      'REJECTED',
      actor,
    );
    expect(reviewed).toMatchObject({ status: 'REJECTED', version: 2 });
    await expect(
      payments.reviewTransfer(
        first.value.id,
        { expectedVersion: 1, reason: 'Stale review' },
        'APPROVED',
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await payments.submitTransfer(ids.subscription, receipt, {}, actor)).toMatchObject({
      status: 'PENDING_REVIEW',
    });
  });
  it('keeps tenant portal data scoped and denies inactive or foreign tenant submissions', async () => {
    await payments.updateSettings(settings(), actor);
    expect(await payments.getTenantPortal(ids.tenant)).toMatchObject({
      subscription: { id: ids.subscription, planName: 'Synthetic' },
      transfers: [],
    });
    expect(await payments.getTenantPortal(ids.other)).toMatchObject({
      subscription: null,
      transfers: [],
    });
    await expect(
      payments.submitTransfer(ids.subscription, receipt, {}, actor, undefined, ids.other),
    ).rejects.toMatchObject({ status: 404 });
    await col('subscriptions').updateOne(
      { _id: ids.subscription },
      { $set: { status: 'SUSPENDED' } },
    );
    await expect(payments.submitTenantTransfer(ids.tenant, receipt, actor)).rejects.toMatchObject({
      status: 422,
    });
  });
  it('persists operation evidence with defaults and rejects duplicate history markers', async () => {
    expect(await ledger.encounterOperation.create({ data: operation() })).toMatchObject({
      mutationState: 'PREPARED',
      auditDeliveryStatus: 'PENDING',
      attemptCount: 0,
    });
    expect(
      await ledger.encounterOperation.findUnique({ where: { id: ids.operation } }),
    ).toMatchObject({ auditMetadata: { synthetic: true } });
    await expect(ledger.encounterOperation.create({ data: operation() })).rejects.toBeInstanceOf(
      PlatformDocumentConflictError,
    );
  });
  it('claims recovery operations atomically and filters tenant, retry and stale-claim boundaries', async () => {
    await ledger.encounterOperation.create({ data: operation() });
    const where = { id: ids.operation, tenantId: ids.tenant, attemptCount: 0, lastAttemptAt: null };
    const claims = await Promise.all([
      ledger.encounterOperation.updateMany({
        where,
        data: { attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
      }),
      ledger.encounterOperation.updateMany({
        where,
        data: { attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
      }),
    ]);
    expect(claims.map((row) => row.count).sort()).toEqual([0, 1]);
    expect(
      await ledger.encounterOperation.findMany({
        where: { tenantId: ids.other },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),
    ).toEqual([]);
    expect(
      await ledger.encounterOperation.findMany({
        where: {
          tenantId: ids.tenant,
          auditDeliveryStatus: { in: ['PENDING', 'FAILED'] },
          attemptCount: { lt: 5 },
          OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(Date.now() + 60_000) } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),
    ).toHaveLength(1);
  });
  it('keeps ambiguous mutation evidence distinguishable from reconciled audit delivery', async () => {
    await ledger.encounterOperation.create({ data: operation() });
    await ledger.encounterOperation.updateMany({
      where: { id: ids.operation },
      data: { mutationState: 'AMBIGUOUS', auditDeliveryStatus: 'REVIEW_REQUIRED' },
    });
    expect(
      await ledger.encounterOperation.findUnique({ where: { id: ids.operation } }),
    ).toMatchObject({ mutationState: 'AMBIGUOUS', auditDeliveryStatus: 'REVIEW_REQUIRED' });
  });
  it('registers inactive targets, verifies all clinical indexes, and switches primary atomically', async () => {
    const first = await registry.registerTarget(ids.tenant, 'synthetic_target_a');
    const second = await registry.registerTarget(ids.tenant, 'synthetic_target_b');
    expect(await registry.getPlacements(context)).toEqual([]);
    expect(await activation.setTargetStatus(ids.tenant, first.id, 'ACTIVE')).toMatchObject({
      status: 'ACTIVE',
    });
    expect(ensureIndexesForTarget).toHaveBeenCalledTimes(4);
    await activation.setPrimaryTarget(ids.tenant, first.id);
    expect(await registry.findActivePrimaryTarget(context, first.id)).toMatchObject({
      id: first.id,
    });
    await activation.setTargetStatus(ids.tenant, second.id, 'ACTIVE');
    await activation.setPrimaryTarget(ids.tenant, second.id);
    expect(await registry.getPlacements(context)).toEqual([{ placementId: second.id }]);
    expect(await registry.findActivePrimaryTarget(context, first.id)).toBeNull();
  });
  it('rejects cross-tenant routing and preserves inactive state when index verification fails', async () => {
    const target = await registry.registerTarget(ids.tenant, 'synthetic_target_a');
    expect(await activation.setTargetStatus(ids.other, target.id, 'ACTIVE')).toBeNull();
    ensureIndexesForTarget.mockRejectedValueOnce(new Error('Synthetic index failure'));
    await expect(activation.setTargetStatus(ids.tenant, target.id, 'ACTIVE')).rejects.toMatchObject(
      { status: 503 },
    );
    expect(await col('tenant_storage_targets').findOne({ _id: target.id })).toMatchObject({
      status: 'INACTIVE',
      isPrimary: false,
    });
    await expect(registry.registerTarget(ids.tenant, 'admin')).rejects.toThrow(
      'Invalid tenant storage database name',
    );
  });
  it('requires Mongo transaction capability and all required index definitions for readiness', async () => {
    const ready = new MongoCentralReadinessService(manager);
    expect(await ready.isReady()).toBe(true);
    await col('encounter_operations').dropIndex('ux_encounter_operation_history');
    try {
      expect(await ready.isReady()).toBe(false);
    } finally {
      await provisionPlatformMongoIndexes(db);
    }
  });
});
