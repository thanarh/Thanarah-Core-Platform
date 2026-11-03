import type { ClientSession, Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformMongoClientManager } from '../src/platform-mongo/platform-mongo.client.manager';
import {
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from '../src/platform-mongo/platform-mongo.errors';
import { MongoPlatformAuthorizationRepository } from '../src/platform-mongo/mongo-platform-authorization.repository';

const now = new Date('2026-11-03T00:00:00.000Z');
const userId = '11111111-1111-4111-8111-111111111111';
const roleId = '22222222-2222-4222-8222-222222222222';
const secondRoleId = '33333333-3333-4333-8333-333333333333';
const permissionId = '44444444-4444-4444-8444-444444444444';
const anotherPermissionId = '55555555-5555-4555-8555-555555555555';

function matches(document: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (typeof expected === 'object' && expected !== null && '$in' in expected) {
      const values = (expected as { $in: unknown[] }).$in;
      return values.includes(document[key]);
    }
    return document[key] === expected;
  });
}

function createDb(
  documents: Record<string, Record<string, unknown>[]>,
  expectedSession: ClientSession,
): Db {
  return {
    collection: (name: string) => ({
      find: (filter: Record<string, unknown>, options?: { session?: ClientSession }) => ({
        toArray: async (): Promise<Record<string, unknown>[]> => {
          if (options?.session !== expectedSession) {
            throw new Error('Authorization reads must share the transaction session');
          }
          return (documents[name] ?? []).filter((document) => matches(document, filter));
        },
      }),
    }),
  } as unknown as Db;
}

function createRepository(
  documents: Record<string, Record<string, unknown>[]>,
): MongoPlatformAuthorizationRepository {
  const session = {} as ClientSession;
  const manager = {
    getDatabase: vi.fn().mockResolvedValue(createDb(documents, session)),
    withTransaction: vi.fn(
      async (
        operation: (receivedSession: ClientSession) => Promise<unknown>,
        options?: { readConcern?: { level?: string } },
      ) => {
        if (options?.readConcern?.level !== 'snapshot') {
          throw new Error('Authorization reads require snapshot isolation');
        }
        return operation(session);
      },
    ),
  } as unknown as PlatformMongoClientManager;
  return new MongoPlatformAuthorizationRepository(manager);
}

function validDocuments(): Record<string, Record<string, unknown>[]> {
  const common = { createdAt: now, updatedAt: now, schemaVersion: 1 };
  return {
    platform_user_roles: [
      { _id: 'user-role-1', userId, roleId },
      { _id: 'user-role-2', userId, roleId: secondRoleId },
    ],
    platform_roles: [
      { ...common, _id: roleId, code: 'PLATFORM_ADMIN' },
      { ...common, _id: secondRoleId, code: 'SECURITY_ADMIN' },
    ],
    platform_role_permissions: [
      { _id: 'role-permission-1', roleId, permissionId },
      { _id: 'role-permission-2', roleId: secondRoleId, permissionId },
      { _id: 'role-permission-3', roleId: secondRoleId, permissionId: anotherPermissionId },
    ],
    platform_permissions: [
      { ...common, _id: permissionId, code: 'platform.read' },
      { ...common, _id: anotherPermissionId, code: 'security_events.read' },
    ],
  };
}

describe('MongoPlatformAuthorizationRepository', () => {
  it('resolves role codes, role IDs, and de-duplicated permission codes', async () => {
    const repository = createRepository(validDocuments());

    await expect(repository.findRoleCodesByUserId(userId)).resolves.toEqual([
      'PLATFORM_ADMIN',
      'SECURITY_ADMIN',
    ]);
    await expect(repository.findRoleIdsByUserId(userId)).resolves.toEqual([roleId, secondRoleId]);
    await expect(repository.findPermissionCodesByUserId(userId)).resolves.toEqual([
      'platform.read',
      'security_events.read',
    ]);
  });

  it('returns empty authorization data for users without role assignments', async () => {
    const repository = createRepository({
      ...validDocuments(),
      platform_user_roles: [],
    });

    await expect(repository.findRoleCodesByUserId(userId)).resolves.toEqual([]);
    await expect(repository.findRoleIdsByUserId(userId)).resolves.toEqual([]);
    await expect(repository.findPermissionCodesByUserId(userId)).resolves.toEqual([]);
  });

  it('fails closed when an assigned role reference is missing', async () => {
    const documents = validDocuments();
    documents.platform_roles = documents.platform_roles.slice(0, 1);
    const repository = createRepository(documents);

    await expect(repository.findRoleCodesByUserId(userId)).rejects.toBeInstanceOf(
      PlatformDocumentValidationError,
    );
    await expect(repository.findPermissionCodesByUserId(userId)).rejects.toBeInstanceOf(
      PlatformDocumentValidationError,
    );
  });

  it('fails closed when a role references a missing permission document', async () => {
    const documents = validDocuments();
    documents.platform_permissions = documents.platform_permissions.slice(0, 1);
    const repository = createRepository(documents);

    await expect(repository.findPermissionCodesByUserId(userId)).rejects.toBeInstanceOf(
      PlatformDocumentValidationError,
    );
  });

  it('sanitizes database failures', async () => {
    const manager = {
      getDatabase: vi.fn().mockRejectedValue(new Error('sensitive database details')),
      withTransaction: vi.fn(async (operation: (session: ClientSession) => Promise<unknown>) =>
        operation({} as ClientSession),
      ),
    } as unknown as PlatformMongoClientManager;
    const repository = new MongoPlatformAuthorizationRepository(manager);

    await expect(repository.findRoleIdsByUserId(userId)).rejects.toBeInstanceOf(
      PlatformMongoUnavailableError,
    );
  });
});
