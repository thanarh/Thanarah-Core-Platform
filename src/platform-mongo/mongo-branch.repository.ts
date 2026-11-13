import { Injectable } from '@nestjs/common';
import { BranchStatus, FacilityStatus, TenantStatus } from '../common/domain-enums';
import type { ClientSession, Db, TransactionOptions } from 'mongodb';
import type {
  BranchFacilityScope,
  BranchListFilter,
  BranchPersistencePort,
  BranchRecord,
  BranchStatusValue,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import { MongoTenantAuthorizationContext } from './mongo-tenant-authorization.context';
import {
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import { branchSchema, documentTimestamps, newStableId } from './platform-mongo.models';
import type { BranchDocument, FacilityDocument, TenantDocument } from './platform-mongo.models';

const TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

@Injectable()
export class MongoBranchRepository implements BranchPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  findFacilityScope(tenantId: string, facilityId: string): Promise<BranchFacilityScope | null> {
    return this.read(async (db) => {
      const facility = await db
        .collection<FacilityDocument>('facilities')
        .findOne({ _id: facilityId, tenantId });
      if (!facility) return null;
      const tenant = await db
        .collection<TenantDocument>('tenants')
        .findOne({ _id: tenantId }, { projection: { status: 1 } });
      if (!tenant) return null;
      return {
        id: facility._id,
        status: facility.status,
        tenant: { status: tenant.status },
      };
    });
  }

  createUnderActiveFacility(
    tenantId: string,
    facilityId: string,
    input: { name: string },
  ): Promise<BranchRecord | null> {
    return this.transaction(async (db, session) => {
      if (!(await this.hasActiveFacility(db, session, tenantId, facilityId))) return null;
      const now = new Date();
      const document = this.parse({
        _id: newStableId(),
        ...documentTimestamps(now),
        schemaVersion: 1,
        facilityId,
        name: input.name,
        status: BranchStatus.ACTIVE,
        statusChangedAt: now,
        suspendedAt: null,
        deactivatedAt: null,
      });
      await db.collection<BranchDocument>('branches').insertOne(document, { session });
      return this.toRecord(document);
    });
  }

  listForFacility(
    tenantId: string,
    facilityId: string,
    filter: BranchListFilter,
  ): Promise<BranchRecord[]> {
    return this.read(async (db) => {
      if (!(await this.hasActiveFacility(db, undefined, tenantId, facilityId))) return [];
      const documents = await db
        .collection<BranchDocument>('branches')
        .find({ facilityId, ...(filter.status ? { status: filter.status } : {}) })
        .sort({ createdAt: -1, _id: -1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .toArray();
      return documents.map((document) => this.toRecord(document));
    });
  }

  findByIdWithinFacility(
    tenantId: string,
    facilityId: string,
    branchId: string,
  ): Promise<BranchRecord | null> {
    return this.read(async (db) => {
      if (!(await this.hasActiveFacility(db, undefined, tenantId, facilityId))) return null;
      const document = await db
        .collection<BranchDocument>('branches')
        .findOne({ _id: branchId, facilityId });
      return document ? this.toRecord(document) : null;
    });
  }

  updateNameWithinFacility(
    tenantId: string,
    facilityId: string,
    branchId: string,
    name: string,
  ): Promise<BranchRecord | null> {
    return this.transaction(async (db, session) => {
      if (!(await this.hasActiveFacility(db, session, tenantId, facilityId))) return null;
      const document = await db
        .collection<BranchDocument>('branches')
        .findOneAndUpdate(
          { _id: branchId, facilityId },
          { $set: { name, updatedAt: new Date() } },
          { session, returnDocument: 'after' },
        );
      return document ? this.toRecord(document) : null;
    });
  }

  changeStatusIfCurrentWithinFacility(
    tenantId: string,
    facilityId: string,
    branchId: string,
    expectedStatus: BranchStatusValue,
    nextStatus: BranchStatusValue,
    changedAt: Date,
  ): Promise<BranchRecord | null> {
    return this.transaction(async (db, session) => {
      if (!(await this.hasActiveFacility(db, session, tenantId, facilityId))) return null;
      const $set: Partial<BranchDocument> = {
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
      };
      if (nextStatus === BranchStatus.SUSPENDED) $set.suspendedAt = changedAt;
      if (nextStatus === BranchStatus.DEACTIVATED) $set.deactivatedAt = changedAt;
      const document = await db
        .collection<BranchDocument>('branches')
        .findOneAndUpdate(
          { _id: branchId, facilityId, status: expectedStatus },
          { $set },
          { session, returnDocument: 'after' },
        );
      return document ? this.toRecord(document) : null;
    });
  }

  private async hasActiveFacility(
    db: Db,
    session: ClientSession | undefined,
    tenantId: string,
    facilityId: string,
  ): Promise<boolean> {
    if (session) {
      const references = new MongoTenantAuthorizationContext(db, session);
      if (
        !(await references.activeTenant(tenantId, true)) ||
        !(await references.touch('facilities', facilityId, {
          tenantId,
          status: FacilityStatus.ACTIVE,
        }))
      )
        return false;
    }
    const options = session
      ? { session, projection: { status: 1 } }
      : { projection: { status: 1 } };
    const facility = await db
      .collection<FacilityDocument>('facilities')
      .findOne({ _id: facilityId, tenantId, status: FacilityStatus.ACTIVE }, options);
    if (!facility) return false;
    const tenant = await db
      .collection<TenantDocument>('tenants')
      .findOne(
        { _id: tenantId, status: TenantStatus.ACTIVE },
        { ...(session ? { session } : {}), projection: { _id: 1 } },
      );
    return tenant !== null;
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
      if (error instanceof PlatformDocumentValidationError) throw error;
      throw new PlatformMongoUnavailableError();
    }
  }

  private parse(value: unknown): BranchDocument {
    const parsed = branchSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }

  private toRecord(document: BranchDocument): BranchRecord {
    const value = this.parse(document);
    return {
      id: value._id,
      facilityId: value.facilityId,
      name: value.name,
      status: value.status as BranchStatusValue,
      statusChangedAt: value.statusChangedAt,
      suspendedAt: value.suspendedAt,
      deactivatedAt: value.deactivatedAt,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }
}
