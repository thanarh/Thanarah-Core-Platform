import { Injectable } from '@nestjs/common';
import type { ClientSession, Db, TransactionOptions } from 'mongodb';
import type {
  CreateTenantStaffResult,
  StaffStatusValue,
  TenantStaffListFilter,
  TenantStaffPersistencePort,
  TenantStaffRecord,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import { documentTimestamps, newStableId, tenantStaffSchema } from './platform-mongo.models';
import type {
  PlatformUserDocument,
  TenantDocument,
  TenantMembershipDocument,
  TenantStaffDocument,
} from './platform-mongo.models';

const TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

@Injectable()
export class MongoTenantStaffRepository implements TenantStaffPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  createForActiveMembership(
    tenantId: string,
    membershipId: string,
    input: { displayName?: string; jobTitle?: string },
  ): Promise<CreateTenantStaffResult> {
    return this.transaction<CreateTenantStaffResult>(async (db, session) => {
      await db
        .collection<{ _id: string; version: number; schemaVersion: number }>(
          'tenant_membership_locks',
        )
        .updateOne(
          { _id: tenantId },
          { $inc: { version: 1 }, $setOnInsert: { schemaVersion: 1 } },
          { session, upsert: true },
        );
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: tenantId, status: 'ACTIVE' }, { session, projection: { _id: 1 } });
      if (!tenant) return { kind: 'tenant-unavailable' };

      const membership = await db
        .collection<TenantMembershipDocument>('tenant_memberships')
        .findOne(
          { _id: membershipId, tenantId, status: 'ACTIVE' },
          { session, projection: { _id: 1, platformUserId: 1 } },
        );
      if (!membership) return { kind: 'membership-ineligible' };
      const user = await db
        .collection<PlatformUserDocument>('platform_users')
        .findOne(
          { _id: membership.platformUserId, status: 'ACTIVE' },
          { session, projection: { _id: 1, fullName: 1 } },
        );
      if (!user) return { kind: 'membership-ineligible' };

      const now = new Date();
      const parsed = this.parse({
        _id: newStableId(),
        ...documentTimestamps(now),
        schemaVersion: 1,
        tenantId,
        userId: membership.platformUserId,
        membershipId,
        displayName: input.displayName ?? user.fullName,
        jobTitle: input.jobTitle ?? null,
        status: 'ACTIVE',
        statusChangedAt: now,
        suspendedAt: null,
        deactivatedAt: null,
      });
      try {
        await db.collection<TenantStaffDocument>('tenant_staff').insertOne(parsed, { session });
      } catch (error) {
        if (this.isDuplicateKey(error)) throw new PlatformDocumentConflictError();
        throw error;
      }
      return { kind: 'created', staff: this.toRecord(parsed) };
    }).catch((error: unknown): CreateTenantStaffResult => {
      if (error instanceof PlatformDocumentConflictError) return { kind: 'already-exists' };
      throw error;
    });
  }

  listForTenant(tenantId: string, filter: TenantStaffListFilter): Promise<TenantStaffRecord[]> {
    return this.read(async (db) => {
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: tenantId, status: 'ACTIVE' }, { projection: { _id: 1 } });
      if (!tenant) return [];
      const documents = await db
        .collection<TenantStaffDocument>('tenant_staff')
        .find({ tenantId, ...(filter.status ? { status: filter.status } : {}) })
        .sort({ createdAt: -1, _id: -1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .toArray();
      return documents.map((document) => this.toRecord(document));
    });
  }

  findByIdForTenant(tenantId: string, id: string): Promise<TenantStaffRecord | null> {
    return this.read(async (db) => {
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: tenantId, status: 'ACTIVE' }, { projection: { _id: 1 } });
      if (!tenant) return null;
      const staff = await db.collection<TenantStaffDocument>('tenant_staff').findOne({
        _id: id,
        tenantId,
      });
      return staff ? this.toRecord(staff) : null;
    });
  }

  updateForTenant(
    tenantId: string,
    id: string,
    input: { displayName?: string; jobTitle?: string | null },
  ): Promise<TenantStaffRecord | null> {
    return this.write(async (db) => {
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: tenantId, status: 'ACTIVE' }, { projection: { _id: 1 } });
      if (!tenant) return null;
      const updated = await db
        .collection<TenantStaffDocument>('tenant_staff')
        .findOneAndUpdate(
          { _id: id, tenantId },
          { $set: { ...input, updatedAt: new Date() } },
          { returnDocument: 'after' },
        );
      return updated ? this.toRecord(updated) : null;
    });
  }

  changeStatusIfCurrentForTenant(
    tenantId: string,
    id: string,
    expectedStatus: StaffStatusValue,
    nextStatus: StaffStatusValue,
    changedAt: Date,
  ): Promise<TenantStaffRecord | null> {
    return this.write(async (db) => {
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: tenantId, status: 'ACTIVE' }, { projection: { _id: 1 } });
      if (!tenant) return null;
      const $set: Partial<TenantStaffDocument> = {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
      };
      if (nextStatus === 'SUSPENDED') $set.suspendedAt = changedAt;
      if (nextStatus === 'DEACTIVATED') $set.deactivatedAt = changedAt;
      const updated = await db
        .collection<TenantStaffDocument>('tenant_staff')
        .findOneAndUpdate(
          { _id: id, tenantId, status: expectedStatus },
          { $set },
          { returnDocument: 'after' },
        );
      return updated ? this.toRecord(updated) : null;
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

  private async write<T>(operation: (db: Db) => Promise<T>): Promise<T> {
    return this.read(operation);
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

  private parse(value: unknown): TenantStaffDocument {
    const parsed = tenantStaffSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private toRecord(value: unknown): TenantStaffRecord {
    const staff = this.parse(value);
    return {
      id: staff._id,
      tenantId: staff.tenantId,
      userId: staff.userId,
      membershipId: staff.membershipId,
      displayName: staff.displayName,
      jobTitle: staff.jobTitle,
      status: staff.status,
      statusChangedAt: staff.statusChangedAt,
      suspendedAt: staff.suspendedAt,
      deactivatedAt: staff.deactivatedAt,
      createdAt: staff.createdAt,
      updatedAt: staff.updatedAt,
    };
  }

  private isDuplicateKey(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
  }
}
