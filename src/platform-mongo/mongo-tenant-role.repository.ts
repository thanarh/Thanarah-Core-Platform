import { Injectable } from '@nestjs/common';
import { TenantMembershipStatus, TenantStatus } from '@prisma/client';
import type { ClientSession, Db, TransactionOptions } from 'mongodb';
import type {
  TenantRoleBootstrapResult,
  TenantRolePersistencePort,
  TenantRoleRecord,
} from '../persistence/platform-persistence.ports';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_DEFINITIONS,
  type TenantPermissionCode,
} from '../tenant/tenant-authorization.constants';
import {
  TenantOwnerBootstrapConflictError,
  TenantPermissionCatalogUnavailableError,
} from '../tenant/tenant-authorization.errors';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import {
  documentTimestamps,
  newStableId,
  stableAssignmentId,
  tenantMembershipRoleSchema,
  tenantPermissionSchema,
  tenantRolePermissionSchema,
  tenantRoleSchema,
} from './platform-mongo.models';
import type {
  TenantDocument,
  TenantMembershipDocument,
  TenantMembershipRoleDocument,
  TenantPermissionDocument,
  TenantRoleDocument,
  TenantRolePermissionDocument,
} from './platform-mongo.models';

const TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

class TenantRoleAbort extends PlatformDocumentConflictError {
  constructor(readonly original: Error) {
    super();
  }
}

class TenantRoleRetryableConflict extends PlatformDocumentConflictError {}

@Injectable()
export class MongoTenantRoleRepository implements TenantRolePersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async create(input: {
    tenantId: string;
    code: string;
    name: string;
    description?: string | null;
  }): Promise<TenantRoleRecord> {
    return this.transaction(async (db, session) => {
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: input.tenantId }, { session, projection: { _id: 1 } });
      if (!tenant) throw new PlatformDocumentValidationError();
      const now = new Date();
      const role = this.parseRole({
        _id: newStableId(),
        ...documentTimestamps(now),
        schemaVersion: 1,
        tenantId: input.tenantId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        isSystemRole: false,
      });
      try {
        await db.collection<TenantRoleDocument>('tenant_roles').insertOne(role, { session });
      } catch (error) {
        if (this.isDuplicateKey(error)) throw new PlatformDocumentConflictError();
        throw error;
      }
      return this.loadRecord(db, session, role);
    });
  }

  findByIdForTenant(tenantId: string, id: string): Promise<TenantRoleRecord | null> {
    return this.read(async (db) => {
      const role = await db
        .collection<TenantRoleDocument>('tenant_roles')
        .findOne({ _id: id, tenantId });
      return role ? this.loadRecord(db, undefined, role) : null;
    });
  }

  listForTenant(tenantId: string): Promise<TenantRoleRecord[]> {
    return this.read(async (db) => {
      const roles = await db
        .collection<TenantRoleDocument>('tenant_roles')
        .find({ tenantId })
        .sort({ isSystemRole: -1, code: 1 })
        .toArray();
      return Promise.all(roles.map((role) => this.loadRecord(db, undefined, role)));
    });
  }

  updateMetadata(
    tenantId: string,
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<TenantRoleRecord | null> {
    return this.transaction(async (db, session) => {
      const $set: Partial<TenantRoleDocument> = { updatedAt: new Date() };
      if (input.name !== undefined) $set.name = input.name;
      if (input.description !== undefined) $set.description = input.description;
      const role = await db
        .collection<TenantRoleDocument>('tenant_roles')
        .findOneAndUpdate(
          { _id: id, tenantId, isSystemRole: false },
          { $set },
          { session, returnDocument: 'after' },
        );
      return role ? this.loadRecord(db, session, role) : null;
    });
  }

  replacePermissions(
    tenantId: string,
    roleId: string,
    permissionCodes: readonly TenantPermissionCode[],
  ): Promise<TenantRoleRecord | null> {
    return this.transaction(async (db, session) => {
      const role = await db
        .collection<TenantRoleDocument>('tenant_roles')
        .findOne({ _id: roleId, tenantId, isSystemRole: false }, { session });
      if (!role) return null;
      const permissions = await db
        .collection<TenantPermissionDocument>('tenant_permissions')
        .find({ code: { $in: [...permissionCodes] } }, { session })
        .toArray();
      if (permissions.length !== permissionCodes.length) {
        throw new TenantRoleAbort(new TenantPermissionCatalogUnavailableError());
      }
      const links = db.collection<TenantRolePermissionDocument>('tenant_role_permissions');
      await links.deleteMany({ tenantRoleId: roleId }, { session });
      if (permissions.length) {
        const now = new Date();
        const documents = permissions.map((permission) =>
          this.parseRolePermission({
            _id: stableAssignmentId(roleId, permission._id),
            tenantRoleId: roleId,
            tenantPermissionId: permission._id,
            assignedAt: now,
          }),
        );
        await links.insertMany(documents, { session });
      }
      return this.loadRecord(db, session, role);
    });
  }

  bootstrapInitialOwner(input: {
    tenantId: string;
    platformUserId: string;
  }): Promise<TenantRoleBootstrapResult> {
    return this.transaction(async (db, session) => {
      await this.acquireTenantBootstrapLock(db, session, input.tenantId);
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: input.tenantId }, { session, projection: { status: 1 } });
      if (!tenant || tenant.status !== TenantStatus.ACTIVE) this.abortOwnerBootstrap();

      const membership = await db
        .collection<TenantMembershipDocument>('tenant_memberships')
        .findOne(
          {
            tenantId: input.tenantId,
            platformUserId: input.platformUserId,
            status: TenantMembershipStatus.ACTIVE,
          },
          { session, projection: { _id: 1 } },
        );
      if (!membership) this.abortOwnerBootstrap();

      const roleCodes = DEFAULT_TENANT_ROLES.map((role) => role.code);
      const rolesCollection = db.collection<TenantRoleDocument>('tenant_roles');
      const existingRoles = await rolesCollection
        .find({ tenantId: input.tenantId, code: { $in: roleCodes } }, { session })
        .toArray();
      if (existingRoles.some((role) => !role.isSystemRole)) this.abortOwnerBootstrap();
      const ownerRole = existingRoles.find((role) => role.code === 'OWNER');
      if (
        ownerRole &&
        (await db
          .collection<TenantMembershipRoleDocument>('tenant_membership_roles')
          .findOne(
            { tenantId: input.tenantId, tenantRoleId: ownerRole._id },
            { session, projection: { _id: 1 } },
          ))
      ) {
        this.abortOwnerBootstrap();
      }

      const permissionCodes = TENANT_PERMISSION_DEFINITIONS.map(({ code }) => code);
      const permissions = await db
        .collection<TenantPermissionDocument>('tenant_permissions')
        .find({ code: { $in: permissionCodes } }, { session })
        .toArray();
      if (permissions.length !== permissionCodes.length) {
        throw new TenantRoleAbort(new TenantPermissionCatalogUnavailableError());
      }
      const permissionByCode = new Map(
        permissions.map((permission) => [permission.code, permission]),
      );
      const existingByCode = new Map(existingRoles.map((role) => [role.code, role]));
      const createdRoleCodes: string[] = [];
      const updatedPermissionRoleCodes: string[] = [];
      const roleByCode = new Map<string, TenantRoleDocument>();
      const now = new Date();
      const links = db.collection<TenantRolePermissionDocument>('tenant_role_permissions');

      for (const definition of DEFAULT_TENANT_ROLES) {
        const existing = existingByCode.get(definition.code);
        if (!existing) createdRoleCodes.push(definition.code);
        const oldLinks = existing
          ? await links.find({ tenantRoleId: existing._id }, { session }).toArray()
          : [];
        const oldPermissions = oldLinks.length
          ? await db
              .collection<TenantPermissionDocument>('tenant_permissions')
              .find({ _id: { $in: oldLinks.map((link) => link.tenantPermissionId) } }, { session })
              .toArray()
          : [];
        const before = oldLinks
          .map(
            (link) =>
              oldPermissions.find((permission) => permission._id === link.tenantPermissionId)?.code,
          )
          .filter((code): code is string => code !== undefined)
          .sort((a, b) => a.localeCompare(b));
        const after = [...definition.permissionCodes].sort((a, b) => a.localeCompare(b));
        if (existing && before.join(',') !== after.join(',')) {
          updatedPermissionRoleCodes.push(definition.code);
        }

        const result = await rolesCollection.findOneAndUpdate(
          { tenantId: input.tenantId, code: definition.code },
          {
            $set: {
              name: definition.name,
              description: definition.description,
              isSystemRole: true,
              updatedAt: now,
            },
            $setOnInsert: {
              _id: newStableId(),
              tenantId: input.tenantId,
              code: definition.code,
              createdAt: now,
              schemaVersion: 1,
            },
          },
          { session, upsert: true, returnDocument: 'after' },
        );
        if (!result) throw new PlatformMongoUnavailableError();
        const role = this.parseRole(result);
        roleByCode.set(definition.code, role);
        await links.deleteMany({ tenantRoleId: role._id }, { session });
        const rolePermissionDocuments = definition.permissionCodes.map((code) => {
          const permission = permissionByCode.get(code);
          if (!permission) {
            throw new TenantRoleAbort(new TenantPermissionCatalogUnavailableError());
          }
          return this.parseRolePermission({
            _id: stableAssignmentId(role._id, permission._id),
            tenantRoleId: role._id,
            tenantPermissionId: permission._id,
            assignedAt: now,
          });
        });
        if (rolePermissionDocuments.length) {
          await links.insertMany(rolePermissionDocuments, { session });
        }
      }

      const owner = roleByCode.get('OWNER');
      if (!owner) this.abortOwnerBootstrap();
      const assignment = this.parseMembershipRole({
        _id: stableAssignmentId(membership!._id, owner._id),
        tenantId: input.tenantId,
        membershipId: membership!._id,
        tenantRoleId: owner._id,
        assignedAt: now,
      });
      await db
        .collection<TenantMembershipRoleDocument>('tenant_membership_roles')
        .insertOne(assignment, { session });

      const roleList = await rolesCollection
        .find({ tenantId: input.tenantId, code: { $in: roleCodes } }, { session })
        .sort({ code: 1 })
        .toArray();
      const records = await Promise.all(roleList.map((role) => this.loadRecord(db, session, role)));
      return {
        ownerMembershipId: membership!._id,
        roles: records,
        createdRoleCodes,
        updatedPermissionRoleCodes,
      };
    });
  }

  private async acquireTenantBootstrapLock(
    db: Db,
    session: ClientSession,
    tenantId: string,
  ): Promise<void> {
    try {
      await db
        .collection<{ _id: string; version: number; schemaVersion: number }>(
          'tenant_role_bootstrap_locks',
        )
        .updateOne(
          { _id: tenantId },
          { $inc: { version: 1 }, $setOnInsert: { schemaVersion: 1 } },
          { session, upsert: true },
        );
    } catch (error) {
      if (this.isDuplicateKey(error)) throw new TenantRoleRetryableConflict();
      throw error;
    }
  }

  private async loadRecord(
    db: Db,
    session: ClientSession | undefined,
    rawRole: TenantRoleDocument,
  ): Promise<TenantRoleRecord> {
    const role = this.parseRole(rawRole);
    const links = await db
      .collection<TenantRolePermissionDocument>('tenant_role_permissions')
      .find({ tenantRoleId: role._id }, { ...(session ? { session } : {}) })
      .toArray();
    const permissionIds = links.map((link) => link.tenantPermissionId);
    const permissions = permissionIds.length
      ? await db
          .collection<TenantPermissionDocument>('tenant_permissions')
          .find({ _id: { $in: permissionIds } }, { ...(session ? { session } : {}) })
          .toArray()
      : [];
    const permissionById = new Map(
      permissions.map((permission) => {
        const parsed = this.parsePermission(permission);
        return [parsed._id, parsed] as const;
      }),
    );
    return {
      id: role._id,
      tenantId: role.tenantId,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystemRole: role.isSystemRole,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      permissions: links
        .map((link) => permissionById.get(link.tenantPermissionId))
        .filter((permission): permission is TenantPermissionDocument => permission !== undefined)
        .map((permission) => ({ permission: { code: permission.code } })),
    };
  }

  private async read<T>(operation: (db: Db) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.manager.getDatabase());
    } catch (error) {
      if (error instanceof PlatformDocumentValidationError) throw error;
      throw new PlatformMongoUnavailableError();
    }
  }

  private async transaction<T>(
    operation: (db: Db, session: ClientSession) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.manager.withTransaction(
          async (session) => operation(await this.manager.getDatabase(), session),
          TRANSACTION_OPTIONS,
        );
      } catch (error) {
        if (error instanceof TenantRoleAbort) throw error.original;
        if (error instanceof PlatformDocumentValidationError) throw error;
        if (error instanceof TenantRoleRetryableConflict && attempt < 2) continue;
        if (error instanceof PlatformDocumentConflictError) throw error;
        throw new PlatformMongoUnavailableError();
      }
    }
    throw new PlatformMongoUnavailableError();
  }

  private parseRole(value: unknown): TenantRoleDocument {
    const parsed = tenantRoleSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private parsePermission(value: unknown): TenantPermissionDocument {
    const parsed = tenantPermissionSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private parseRolePermission(value: unknown): TenantRolePermissionDocument {
    const parsed = tenantRolePermissionSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private parseMembershipRole(value: unknown): TenantMembershipRoleDocument {
    const parsed = tenantMembershipRoleSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private abortOwnerBootstrap(): never {
    throw new TenantRoleAbort(new TenantOwnerBootstrapConflictError());
  }

  private isDuplicateKey(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
  }
}
