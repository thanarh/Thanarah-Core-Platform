import { Injectable } from '@nestjs/common';
import type { ClientSession, Db, TransactionOptions } from 'mongodb';
import type {
  TenantMembershipDirectoryRecord,
  TenantMembershipListFilter,
  TenantMembershipPersistencePort,
  TenantMembershipRecord,
  TenantMembershipStatusChangeResult,
  TenantWorkspaceMembershipRecord,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import { MongoTenantAuthorizationContext } from './mongo-tenant-authorization.context';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import { documentTimestamps, newStableId, tenantMembershipSchema } from './platform-mongo.models';
import type {
  PlatformUserDocument,
  TenantDocument,
  TenantMembershipDocument,
  TenantMembershipRoleDocument,
  TenantRoleDocument,
} from './platform-mongo.models';

const TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

/**
 * Mongo implementation of the central tenant-membership port.
 * Membership mutations share a per-tenant write lock with role assignment
 * workflows so owner protection can be made race-safe across adapters.
 */
@Injectable()
export class MongoTenantMembershipRepository implements TenantMembershipPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  create(input: { tenantId: string; platformUserId: string }): Promise<TenantMembershipRecord> {
    return this.transaction(async (db, session) => {
      const references = new MongoTenantAuthorizationContext(db, session);
      await references.touch('tenants', input.tenantId);
      await references.touch('platform_users', input.platformUserId);
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: input.tenantId }, { session, projection: { _id: 1 } });
      const user = await db
        .collection<PlatformUserDocument>('platform_users')
        .findOne({ _id: input.platformUserId }, { session, projection: { _id: 1 } });
      if (!tenant || !user) throw new PlatformDocumentConflictError();

      const now = new Date();
      const document = this.parse({
        _id: newStableId(),
        ...documentTimestamps(now),
        schemaVersion: 1,
        ...input,
        status: 'INVITED',
        statusChangedAt: now,
        activatedAt: null,
        suspendedAt: null,
        removedAt: null,
      });
      try {
        await db.collection<TenantMembershipDocument>('tenant_memberships').insertOne(document, {
          session,
        });
      } catch (error) {
        if (this.isDuplicateKey(error)) throw new PlatformDocumentConflictError();
        throw error;
      }
      return this.toRecord(document);
    });
  }

  findByTenantAndPlatformUser(
    tenantId: string,
    platformUserId: string,
  ): Promise<TenantMembershipRecord | null> {
    return this.read(async (db) => {
      const document = await db
        .collection<TenantMembershipDocument>('tenant_memberships')
        .findOne({ tenantId, platformUserId });
      return document ? this.toRecord(document) : null;
    });
  }

  findActiveForTenantAndPlatformUser(
    tenantId: string,
    platformUserId: string,
  ): Promise<TenantMembershipRecord | null> {
    return this.read(async (db) => {
      const [membership, tenant] = await Promise.all([
        db.collection<TenantMembershipDocument>('tenant_memberships').findOne({
          tenantId,
          platformUserId,
          status: 'ACTIVE',
        }),
        db
          .collection<TenantDocument>('tenants')
          .findOne({ _id: tenantId, status: 'ACTIVE' }, { projection: { _id: 1 } }),
      ]);
      return membership && tenant ? this.toRecord(membership) : null;
    });
  }

  listActiveForPlatformUser(platformUserId: string): Promise<TenantWorkspaceMembershipRecord[]> {
    return this.read(async (db) => {
      const memberships = await db
        .collection<TenantMembershipDocument>('tenant_memberships')
        .find({ platformUserId, status: 'ACTIVE' })
        .sort({ tenantId: 1 })
        .toArray();
      const tenantIds = memberships.map(({ tenantId }) => tenantId);
      if (!tenantIds.length) return [];
      const tenants = await db
        .collection<TenantDocument>('tenants')
        .find({ _id: { $in: tenantIds }, status: 'ACTIVE' })
        .toArray();
      const tenantById = new Map(tenants.map((tenant) => [tenant._id, tenant]));
      return memberships.flatMap((membership) => {
        const tenant = tenantById.get(membership.tenantId);
        return tenant
          ? [
              {
                id: membership._id,
                tenantId: tenant._id,
                tenant: { displayName: tenant.displayName, slug: tenant.slug },
              },
            ]
          : [];
      });
    });
  }

  findByIdForTenant(id: string, tenantId: string): Promise<TenantMembershipRecord | null> {
    return this.read(async (db) => {
      const document = await db
        .collection<TenantMembershipDocument>('tenant_memberships')
        .findOne({ _id: id, tenantId });
      return document ? this.toRecord(document) : null;
    });
  }

  listForTenant(filter: TenantMembershipListFilter): Promise<TenantMembershipRecord[]> {
    return this.read(async (db) => {
      const documents = await db
        .collection<TenantMembershipDocument>('tenant_memberships')
        .find({ tenantId: filter.tenantId, ...(filter.status ? { status: filter.status } : {}) })
        .sort({ createdAt: -1, _id: -1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .toArray();
      return documents.map((document) => this.toRecord(document));
    });
  }

  listDirectoryForTenant(
    filter: TenantMembershipListFilter,
  ): Promise<TenantMembershipDirectoryRecord[]> {
    return this.read(async (db) => {
      const memberships = await db
        .collection<TenantMembershipDocument>('tenant_memberships')
        .find({ tenantId: filter.tenantId, ...(filter.status ? { status: filter.status } : {}) })
        .sort({ createdAt: -1, _id: -1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .toArray();
      if (!memberships.length) return [];
      const users = await db
        .collection<PlatformUserDocument>('platform_users')
        .find({ _id: { $in: memberships.map(({ platformUserId }) => platformUserId) } })
        .toArray();
      const userById = new Map(users.map((user) => [user._id, user]));
      return memberships.map((membership) => {
        const user = userById.get(membership.platformUserId);
        if (!user) throw new PlatformDocumentValidationError();
        return {
          id: membership._id,
          tenantId: membership.tenantId,
          platformUserId: membership.platformUserId,
          status: membership.status,
          statusChangedAt: membership.statusChangedAt,
          createdAt: membership.createdAt,
          platformUser: { fullName: user.fullName, status: user.status },
        };
      });
    });
  }

  changeStatusIfCurrent(
    id: string,
    tenantId: string,
    expectedStatus: TenantMembershipRecord['status'],
    nextStatus: TenantMembershipRecord['status'],
    changedAt: Date,
  ): Promise<TenantMembershipStatusChangeResult> {
    return this.transaction(async (db, session) => {
      await new MongoTenantAuthorizationContext(db, session).touch('tenants', tenantId);
      const membership = await db
        .collection<TenantMembershipDocument>('tenant_memberships')
        .findOne({ _id: id, tenantId, status: expectedStatus }, { session });
      if (!membership) return { kind: 'stale' };
      if (nextStatus !== 'ACTIVE') {
        const role = await db
          .collection<TenantRoleDocument>('tenant_roles')
          .findOne({ tenantId, code: 'OWNER' }, { session, projection: { _id: 1 } });
        if (
          role &&
          (await db
            .collection<TenantMembershipRoleDocument>('tenant_membership_roles')
            .findOne(
              { membershipId: id, tenantId, tenantRoleId: role._id },
              { session, projection: { _id: 1 } },
            ))
        )
          return { kind: 'owner-protected' };
      }

      const set: Partial<TenantMembershipDocument> = {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
      };
      if (nextStatus === 'ACTIVE') set.activatedAt = changedAt;
      if (nextStatus === 'SUSPENDED') set.suspendedAt = changedAt;
      if (nextStatus === 'REMOVED') set.removedAt = changedAt;
      const updated = await db
        .collection<TenantMembershipDocument>('tenant_memberships')
        .findOneAndUpdate(
          { _id: id, tenantId, status: expectedStatus },
          { $set: set },
          { session, returnDocument: 'after' },
        );
      return updated ? { kind: 'updated', membership: this.toRecord(updated) } : { kind: 'stale' };
    });
  }

  hasActiveMembership(tenantId: string, platformUserId: string): Promise<boolean> {
    return this.read(async (db) => {
      const membership = await db
        .collection<TenantMembershipDocument>('tenant_memberships')
        .findOne({ tenantId, platformUserId }, { projection: { status: 1 } });
      return membership?.status === 'ACTIVE';
    });
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
    try {
      return await this.manager.withTransaction(
        async (session) => operation(await this.manager.getDatabase(), session),
        TRANSACTION_OPTIONS,
      );
    } catch (error) {
      if (
        error instanceof PlatformDocumentValidationError ||
        error instanceof PlatformDocumentConflictError
      ) {
        throw error;
      }
      throw new PlatformMongoUnavailableError();
    }
  }

  private parse(value: unknown): TenantMembershipDocument {
    const parsed = tenantMembershipSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private toRecord(value: unknown): TenantMembershipRecord {
    const document = this.parse(value);
    return {
      id: document._id,
      tenantId: document.tenantId,
      platformUserId: document.platformUserId,
      status: document.status,
      statusChangedAt: document.statusChangedAt,
      activatedAt: document.activatedAt,
      suspendedAt: document.suspendedAt,
      removedAt: document.removedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private isDuplicateKey(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
  }
}
