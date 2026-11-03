import type { ClientSession } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '../src/config/config.service';
import {
  PlatformMongoClientManager,
  type PlatformMongoClient,
  type PlatformMongoClientFactory,
} from '../src/platform-mongo/platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformMongoNotConfiguredError,
  PlatformMongoUnavailableError,
} from '../src/platform-mongo/platform-mongo.errors';

interface ManagerHarness {
  manager: PlatformMongoClientManager;
  client: PlatformMongoClient;
  factory: PlatformMongoClientFactory;
  sessionStub: {
    withTransaction: ReturnType<typeof vi.fn>;
    endSession: ReturnType<typeof vi.fn>;
  };
  session: ClientSession;
}

function createManager(): ManagerHarness {
  const sessionStub: {
    withTransaction: ReturnType<typeof vi.fn>;
    endSession: ReturnType<typeof vi.fn>;
  } = {
    withTransaction: vi.fn(async (operation: (session: ClientSession) => Promise<unknown>) =>
      operation(session as ClientSession),
    ),
    endSession: vi.fn(async () => undefined),
  };
  const session = sessionStub as unknown as ClientSession;
  const client = {
    connect: vi.fn(async () => undefined),
    db: vi.fn(),
    startSession: vi.fn(() => session),
    close: vi.fn(async () => undefined),
  } as unknown as PlatformMongoClient;
  const factory: PlatformMongoClientFactory = { create: vi.fn(() => client) };
  const config = {
    platformMongoUri: 'mongodb://127.0.0.1:27017',
    platformMongoDatabase: 'test_platform',
  } as ConfigService;
  return {
    manager: new PlatformMongoClientManager(config, factory),
    client,
    factory,
    sessionStub,
    session,
  };
}

describe('PlatformMongoClientManager transaction boundary', () => {
  it('passes the session to the operation and always ends it', async () => {
    const { manager, session, sessionStub } = createManager();
    const result = await manager.withTransaction(async (receivedSession) => {
      expect(receivedSession).toBe(session);
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(sessionStub.withTransaction).toHaveBeenCalledTimes(1);
    expect(sessionStub.endSession).toHaveBeenCalledTimes(1);
  });

  it('preserves safe document conflict errors so the transaction aborts predictably', async () => {
    const { manager, sessionStub } = createManager();
    const conflict = new PlatformDocumentConflictError();

    await expect(
      manager.withTransaction(async () => {
        throw conflict;
      }),
    ).rejects.toBe(conflict);
    expect(sessionStub.endSession).toHaveBeenCalledTimes(1);
  });

  it('sanitizes driver errors and still ends the session', async () => {
    const { manager, sessionStub } = createManager();
    sessionStub.withTransaction.mockRejectedValueOnce(
      new Error('sensitive driver details must not escape'),
    );

    await expect(manager.withTransaction(async () => 'unreachable')).rejects.toBeInstanceOf(
      PlatformMongoUnavailableError,
    );
    expect(sessionStub.endSession).toHaveBeenCalledTimes(1);
  });

  it('fails closed before creating a client when MongoDB is not configured', async () => {
    const { manager, factory } = createManager();
    const unconfigured = new PlatformMongoClientManager(
      {
        platformMongoUri: '',
        platformMongoDatabase: '',
      } as ConfigService,
      factory,
    );

    await expect(unconfigured.withTransaction(async () => 'unreachable')).rejects.toBeInstanceOf(
      PlatformMongoNotConfiguredError,
    );
    expect(factory.create).not.toHaveBeenCalled();
    await manager.onApplicationShutdown();
  });
});
