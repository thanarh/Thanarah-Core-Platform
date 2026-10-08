import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import type { Db, MongoClientOptions } from 'mongodb';
import { ConfigService } from '../config/config.service';
import { isValidTenantMongoDatabaseName } from './tenant-mongo.constants';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from './tenant-storage.errors';
import type { TenantStorageTargetRecord } from './tenant-storage.registry';

export const TENANT_MONGO_CLIENT_FACTORY = Symbol('TENANT_MONGO_CLIENT_FACTORY');
export const MAX_TENANT_MONGO_CLIENTS = 4;

export interface TenantMongoClient {
  connect(): Promise<unknown>;
  db(databaseName: string): Db;
  close(force?: boolean): Promise<void>;
}

export interface TenantMongoClientFactory {
  create(uri: string, options: MongoClientOptions): TenantMongoClient;
}

@Injectable()
export class OfficialTenantMongoClientFactory implements TenantMongoClientFactory {
  create(uri: string, options: MongoClientOptions): TenantMongoClient {
    return new MongoClient(uri, options);
  }
}

/**
 * Reuses a bounded set of official MongoDB clients by connection reference.
 * One client is shared across tenant databases on the same physical cluster.
 */
@Injectable()
export class TenantMongoClientManager implements OnApplicationShutdown {
  private readonly clients = new Map<string, Promise<TenantMongoClient>>();

  constructor(
    private readonly config: ConfigService,
    @Inject(TENANT_MONGO_CLIENT_FACTORY)
    private readonly factory: TenantMongoClientFactory,
  ) {}

  async getDatabase(target: TenantStorageTargetRecord): Promise<Db> {
    if (
      target.provider !== 'MONGODB' ||
      target.connectionReference !== 'primary' ||
      !isValidTenantMongoDatabaseName(target.databaseName)
    ) {
      throw new TenantStorageNotConfiguredError();
    }

    const uri = this.config.tenantStorageMongoUri.trim();
    if (!uri) throw new TenantStorageNotConfiguredError();

    const client = await this.getClient(target.connectionReference, uri);
    try {
      return client.db(target.databaseName);
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(
      clients.map(async (clientPromise) => {
        const client = await clientPromise;
        await client.close();
      }),
    );
  }

  private async getClient(reference: string, uri: string): Promise<TenantMongoClient> {
    let clientPromise = this.clients.get(reference);
    if (!clientPromise) {
      if (this.clients.size >= MAX_TENANT_MONGO_CLIENTS) {
        throw new TenantStorageUnavailableError();
      }

      let client: TenantMongoClient;
      try {
        client = this.factory.create(uri, {
          appName: 'thanarah-tenant-storage',
          maxPoolSize: 20,
          minPoolSize: 0,
          maxIdleTimeMS: 60_000,
          connectTimeoutMS: 5_000,
          serverSelectionTimeoutMS: 5_000,
          retryWrites: true,
          monitorCommands: false,
        });
      } catch {
        throw new TenantStorageUnavailableError();
      }

      clientPromise = client
        .connect()
        .then(() => client)
        .catch(async () => {
          if (this.clients.get(reference) === clientPromise) this.clients.delete(reference);
          await client.close(true).catch(() => undefined);
          throw new TenantStorageUnavailableError();
        });
      this.clients.set(reference, clientPromise);
    }

    return clientPromise;
  }
}
