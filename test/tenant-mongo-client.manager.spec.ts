import { TenantStorageProvider, TenantStorageTargetStatus } from '@prisma/client';
import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import {
  MAX_TENANT_MONGO_CLIENTS,
  TenantMongoClientManager,
} from '../src/tenant/tenant-mongo-client.manager';
import type {
  TenantMongoClient,
  TenantMongoClientFactory,
} from '../src/tenant/tenant-mongo-client.manager';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from '../src/tenant/tenant-storage.errors';
import type { TenantStorageTargetRecord } from '../src/tenant/tenant-storage.registry';

const target: TenantStorageTargetRecord = {
  id: '44444444-4444-4444-8444-444444444444',
  tenantId: '11111111-1111-4111-8111-111111111111',
  provider: TenantStorageProvider.MONGODB,
  connectionReference: 'primary',
  databaseName: 'tenant_alpha',
  status: TenantStorageTargetStatus.ACTIVE,
  isPrimary: true,
  createdAt: new Date('2026-10-08T00:00:00.000Z'),
  updatedAt: new Date('2026-10-08T00:00:00.000Z'),
};

function createManager(uri = 'mongodb://fixture.invalid'): {
  manager: TenantMongoClientManager;
  client: TenantMongoClient;
  factory: TenantMongoClientFactory;
  database: Db;
} {
  const database = { command: vi.fn().mockResolvedValue({ ok: 1 }) } as unknown as Db;
  const client: TenantMongoClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    db: vi.fn().mockReturnValue(database),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const factory: TenantMongoClientFactory = {
    create: vi.fn().mockReturnValue(client),
  };
  const config = { tenantStorageMongoUri: uri } as ConfigService;
  return {
    manager: new TenantMongoClientManager(config, factory),
    client,
    factory,
    database,
  };
}

describe('TenantMongoClientManager', () => {
  it('reuses one bounded MongoClient for tenant databases on the same cluster', async () => {
    const { manager, client, factory, database } = createManager();

    await expect(manager.getDatabase(target)).resolves.toBe(database);
    await expect(manager.getDatabase({ ...target, databaseName: 'tenant_beta' })).resolves.toBe(
      database,
    );

    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.db).toHaveBeenNthCalledWith(1, 'tenant_alpha');
    expect(client.db).toHaveBeenNthCalledWith(2, 'tenant_beta');
    expect(factory.create).toHaveBeenCalledWith(
      'mongodb://fixture.invalid',
      expect.objectContaining({
        maxPoolSize: 20,
        minPoolSize: 0,
        connectTimeoutMS: 5_000,
        serverSelectionTimeoutMS: 5_000,
        monitorCommands: false,
      }),
    );
    expect(MAX_TENANT_MONGO_CLIENTS).toBeGreaterThan(0);

    await manager.onApplicationShutdown();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('fails closed when connection configuration or its alias is missing', async () => {
    const missingUri = createManager('');
    await expect(missingUri.manager.getDatabase(target)).rejects.toBeInstanceOf(
      TenantStorageNotConfiguredError,
    );
    const whitespaceUri = createManager('   ');
    await expect(whitespaceUri.manager.getDatabase(target)).rejects.toBeInstanceOf(
      TenantStorageNotConfiguredError,
    );
    expect(missingUri.factory.create).not.toHaveBeenCalled();
    expect(whitespaceUri.factory.create).not.toHaveBeenCalled();

    const unknownReference = createManager();
    await expect(
      unknownReference.manager.getDatabase({
        ...target,
        connectionReference: 'unapproved',
      }),
    ).rejects.toBeInstanceOf(TenantStorageNotConfiguredError);
    await expect(
      unknownReference.manager.getDatabase({ ...target, databaseName: 'admin' }),
    ).rejects.toBeInstanceOf(TenantStorageNotConfiguredError);
    expect(unknownReference.factory.create).not.toHaveBeenCalled();
  });

  it('checks only the shared Mongo service and recovers after a transient ping failure', async () => {
    const { manager, client, database } = createManager();
    vi.mocked(database.command)
      .mockRejectedValueOnce(new Error('temporary tenant service outage'))
      .mockResolvedValueOnce({ ok: 1 });

    await expect(manager.checkReadiness()).resolves.toBe(false);
    await expect(manager.checkReadiness()).resolves.toBe(true);

    expect(client.db).toHaveBeenNthCalledWith(1, 'admin');
    expect(client.db).toHaveBeenNthCalledWith(2, 'admin');
    expect(database.command).toHaveBeenCalledWith({ ping: 1 });
  });

  it('reports unconfigured storage without creating a client', async () => {
    const { manager, factory } = createManager('   ');

    await expect(manager.checkReadiness()).resolves.toBe(false);
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('sanitizes connection failures and closes the failed client', async () => {
    const setup = createManager();
    vi.mocked(setup.client.connect).mockRejectedValue(
      new Error('failed to connect using mongodb://sensitive.example/private'),
    );

    const error = await setup.manager.getDatabase(target).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(TenantStorageUnavailableError);
    expect(String(error)).not.toContain('sensitive.example');
    expect(setup.client.close).toHaveBeenCalledWith(true);
  });
});
