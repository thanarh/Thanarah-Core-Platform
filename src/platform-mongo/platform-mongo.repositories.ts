import { Injectable } from '@nestjs/common';
import type { Collection, Filter, OptionalUnlessRequiredId } from 'mongodb';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import {
  platformPermissionSchema,
  platformRefreshTokenHistorySchema,
  platformRolePermissionSchema,
  platformRoleSchema,
  platformSessionSchema,
  platformUserRoleSchema,
  platformUserSchema,
  tenantMembershipSchema,
  tenantSchema,
} from './platform-mongo.models';
import type {
  PlatformPermissionDocument,
  PlatformRefreshTokenHistoryDocument,
  PlatformRoleDocument,
  PlatformRolePermissionDocument,
  PlatformSessionDocument,
  PlatformUserDocument,
  PlatformUserRoleDocument,
  TenantDocument,
  TenantMembershipDocument,
} from './platform-mongo.models';
import type { z } from 'zod';

export interface PlatformDocumentRepository<T extends { _id: string }> {
  create(document: T): Promise<T>;
  findById(id: string): Promise<T | null>;
  update(id: string, patch: Partial<Omit<T, '_id' | 'createdAt' | 'updatedAt'>>): Promise<T | null>;
}

export interface TenantMembershipRepository extends Omit<
  PlatformDocumentRepository<TenantMembershipDocument>,
  'findById' | 'update'
> {
  findByIdForTenant(id: string, tenantId: string): Promise<TenantMembershipDocument | null>;
  updateForTenant(
    id: string,
    tenantId: string,
    patch: Partial<
      Omit<
        TenantMembershipDocument,
        '_id' | 'createdAt' | 'updatedAt' | 'tenantId' | 'platformUserId'
      >
    >,
  ): Promise<TenantMembershipDocument | null>;
}

export interface PlatformUserRepository extends PlatformDocumentRepository<PlatformUserDocument> {
  findByEmail(email: string): Promise<PlatformUserDocument | null>;
}

class MongoPlatformDocumentRepository<
  T extends { _id: string },
> implements PlatformDocumentRepository<T> {
  constructor(
    private readonly manager: PlatformMongoClientManager,
    private readonly collectionName: string,
    private readonly schema: z.ZodType<T>,
  ) {}

  async create(document: T): Promise<T> {
    const validated = this.parse(document);
    try {
      const collection = await this.collection();
      await collection.insertOne(validated as OptionalUnlessRequiredId<T>);
      return validated;
    } catch (error) {
      this.rethrow(error);
    }
  }

  async findById(id: string): Promise<T | null> {
    try {
      const document = await (await this.collection()).findOne({ _id: id } as Filter<T>);
      return document ? this.parse(document) : null;
    } catch (error) {
      this.rethrow(error);
    }
  }

  async update(
    id: string,
    patch: Partial<Omit<T, '_id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<T | null> {
    return this.updateWhere({ _id: id } as Filter<T>, patch);
  }

  async findOne(filter: Filter<T>): Promise<T | null> {
    try {
      const document = await (await this.collection()).findOne(filter);
      return document ? this.parse(document) : null;
    } catch (error) {
      this.rethrow(error);
    }
  }

  async updateWhere(
    filter: Filter<T>,
    patch: Partial<Omit<T, '_id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<T | null> {
    if ('_id' in patch || 'createdAt' in patch || 'updatedAt' in patch) {
      throw new PlatformDocumentValidationError();
    }
    try {
      const collection = await this.collection();
      const current = await collection.findOne(filter);
      if (!current) return null;
      const validatedCurrent = this.parse(current);
      const next = this.parse({
        ...validatedCurrent,
        ...patch,
        updatedAt: new Date(),
      });
      const result = await collection.replaceOne(validatedCurrent as Filter<T>, next);
      if (result.matchedCount !== 1) throw new PlatformDocumentConflictError();
      return next;
    } catch (error) {
      this.rethrow(error);
    }
  }

  private async collection(): Promise<Collection<T>> {
    return (await this.manager.getDatabase()).collection<T>(this.collectionName);
  }

  private parse(document: unknown): T {
    const parsed = this.schema.safeParse(document);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private rethrow(error: unknown): never {
    if (
      error instanceof PlatformDocumentValidationError ||
      error instanceof PlatformDocumentConflictError
    ) {
      throw error;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    ) {
      throw new PlatformDocumentConflictError();
    }
    throw new PlatformMongoUnavailableError();
  }
}

@Injectable()
export class PlatformMongoRepositories {
  readonly users: PlatformUserRepository;
  readonly tenants: PlatformDocumentRepository<TenantDocument>;
  readonly memberships: TenantMembershipRepository;
  readonly roles: PlatformDocumentRepository<PlatformRoleDocument>;
  readonly permissions: PlatformDocumentRepository<PlatformPermissionDocument>;
  readonly userRoles: PlatformDocumentRepository<PlatformUserRoleDocument>;
  readonly rolePermissions: PlatformDocumentRepository<PlatformRolePermissionDocument>;
  readonly sessions: PlatformDocumentRepository<PlatformSessionDocument>;
  readonly refreshTokenHistory: PlatformDocumentRepository<PlatformRefreshTokenHistoryDocument>;

  constructor(manager: PlatformMongoClientManager) {
    const userRepository = new MongoPlatformDocumentRepository(
      manager,
      'platform_users',
      platformUserSchema,
    );
    this.users = {
      create: (document) => userRepository.create(document),
      findById: (id) => userRepository.findById(id),
      findByEmail: async (email) => {
        try {
          const db = await manager.getDatabase();
          const document = await db
            .collection<PlatformUserDocument>('platform_users')
            .findOne({ email }, { collation: { locale: 'en', strength: 1 } });
          if (!document) return null;
          const parsed = platformUserSchema.safeParse(document);
          if (!parsed.success) throw new PlatformDocumentValidationError();
          return parsed.data;
        } catch (error) {
          if (error instanceof PlatformDocumentValidationError) throw error;
          throw new PlatformMongoUnavailableError();
        }
      },
      update: (id, patch) => userRepository.update(id, patch),
    };
    this.tenants = new MongoPlatformDocumentRepository(manager, 'tenants', tenantSchema);
    const membershipRepository = new MongoPlatformDocumentRepository(
      manager,
      'tenant_memberships',
      tenantMembershipSchema,
    );
    this.memberships = {
      create: (document) => membershipRepository.create(document),
      findByIdForTenant: (id, tenantId) => membershipRepository.findOne({ _id: id, tenantId }),
      updateForTenant: (id, tenantId, patch) =>
        membershipRepository.updateWhere({ _id: id, tenantId }, patch),
    };
    this.roles = new MongoPlatformDocumentRepository(manager, 'platform_roles', platformRoleSchema);
    this.permissions = new MongoPlatformDocumentRepository(
      manager,
      'platform_permissions',
      platformPermissionSchema,
    );
    this.userRoles = new MongoPlatformDocumentRepository(
      manager,
      'platform_user_roles',
      platformUserRoleSchema,
    );
    this.rolePermissions = new MongoPlatformDocumentRepository(
      manager,
      'platform_role_permissions',
      platformRolePermissionSchema,
    );
    this.sessions = new MongoPlatformDocumentRepository(
      manager,
      'platform_sessions',
      platformSessionSchema,
    );
    this.refreshTokenHistory = new MongoPlatformDocumentRepository(
      manager,
      'platform_refresh_token_history',
      platformRefreshTokenHistorySchema,
    );
  }
}
