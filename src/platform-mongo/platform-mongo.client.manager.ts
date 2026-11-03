import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import type {
  ClientSession,
  ClientSessionOptions,
  Db,
  MongoClientOptions,
  TransactionOptions,
} from 'mongodb';
import { ConfigService } from '../config/config.service';
import {
  PlatformMongoNotConfiguredError,
  PlatformMongoUnavailableError,
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
} from './platform-mongo.errors';

export const PLATFORM_MONGO_CLIENT_FACTORY = Symbol('PLATFORM_MONGO_CLIENT_FACTORY');

export interface PlatformMongoClient {
  connect(): Promise<unknown>;
  db(databaseName: string): Db;
  startSession(options?: ClientSessionOptions): ClientSession;
  close(force?: boolean): Promise<void>;
}

export interface PlatformMongoClientFactory {
  create(uri: string, options: MongoClientOptions): PlatformMongoClient;
}

@Injectable()
export class OfficialPlatformMongoClientFactory implements PlatformMongoClientFactory {
  create(uri: string, options: MongoClientOptions): PlatformMongoClient {
    return new MongoClient(uri, options);
  }
}

@Injectable()
export class PlatformMongoClientManager implements OnApplicationShutdown {
  private clientPromise?: Promise<PlatformMongoClient>;

  constructor(
    private readonly config: ConfigService,
    @Inject(PLATFORM_MONGO_CLIENT_FACTORY)
    private readonly factory: PlatformMongoClientFactory,
  ) {}

  get configured(): boolean {
    return Boolean(this.config.platformMongoUri.trim() && this.config.platformMongoDatabase.trim());
  }

  async getDatabase(): Promise<Db> {
    if (!this.configured) throw new PlatformMongoNotConfiguredError();
    try {
      const client = await this.getClient();
      return client.db(this.config.platformMongoDatabase);
    } catch {
      throw new PlatformMongoUnavailableError();
    }
  }

  async checkReadiness(): Promise<boolean> {
    if (!this.configured) return true;
    try {
      const db = await this.getDatabase();
      await db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run database-only work inside a MongoDB transaction. The driver may retry the
   * callback, so external effects must be performed only after this method resolves.
   */
  async withTransaction<T>(
    operation: (session: ClientSession) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    if (!this.configured) throw new PlatformMongoNotConfiguredError();
    const client = await this.getClient();
    let session: ClientSession;
    try {
      session = client.startSession();
    } catch {
      throw new PlatformMongoUnavailableError();
    }

    try {
      return await session.withTransaction(operation, options);
    } catch (error) {
      if (
        error instanceof PlatformDocumentConflictError ||
        error instanceof PlatformDocumentValidationError
      ) {
        throw error;
      }
      throw new PlatformMongoUnavailableError();
    } finally {
      await session.endSession().catch(() => undefined);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const pendingClient = this.clientPromise;
    this.clientPromise = undefined;
    if (!pendingClient) return;
    try {
      const client = await pendingClient;
      await client.close();
    } catch {
      // Client initialization failures are already surfaced through sanitized errors.
    }
  }

  private async getClient(): Promise<PlatformMongoClient> {
    if (!this.clientPromise) {
      let client: PlatformMongoClient;
      try {
        client = this.factory.create(this.config.platformMongoUri.trim(), {
          appName: 'thanarah-platform-storage',
          maxPoolSize: 10,
          minPoolSize: 0,
          maxIdleTimeMS: 60_000,
          connectTimeoutMS: 5_000,
          serverSelectionTimeoutMS: 5_000,
          retryWrites: true,
          monitorCommands: false,
        });
      } catch {
        throw new PlatformMongoUnavailableError();
      }
      this.clientPromise = client.connect().then(
        () => client,
        async () => {
          if (this.clientPromise) this.clientPromise = undefined;
          await client.close(true).catch(() => undefined);
          throw new PlatformMongoUnavailableError();
        },
      );
    }
    return this.clientPromise;
  }
}
