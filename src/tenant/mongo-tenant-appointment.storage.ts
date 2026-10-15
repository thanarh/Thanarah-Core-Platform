import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Document, Filter, IndexDescription, IndexSpecification } from 'mongodb';
import type {
  AppointmentListFilter,
  AppointmentListResult,
  AppointmentRecord,
} from './appointment.model';
import type { AppointmentMutationPatch, AppointmentStorage } from './tenant-appointment.storage';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import type { TenantStorageRoute } from './tenant-storage.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from './tenant-storage.errors';
import { TenantMongoClientManager } from './tenant-mongo-client.manager';
import { TENANT_STORAGE_TARGET_RESOLVER } from './tenant-storage.registry';
import type {
  TenantStorageTargetRecord,
  TenantStorageTargetResolver,
} from './tenant-storage.registry';

const APPOINTMENT_COLLECTION_NAME = 'appointments';

const REQUIRED_APPOINTMENT_INDEXES: ReadonlyArray<{
  name: string;
  key: IndexSpecification;
}> = [
  {
    name: 'tenant_appointment_schedule_overlap_idx',
    key: { _tenantId: 1, doctorId: 1, status: 1, startsAt: 1, endsAt: 1 },
  },
  {
    name: 'tenant_appointment_starts_idx',
    key: { _tenantId: 1, startsAt: 1, _id: 1 },
  },
  {
    name: 'tenant_appointment_status_starts_idx',
    key: { _tenantId: 1, status: 1, startsAt: 1, _id: 1 },
  },
  {
    name: 'tenant_appointment_facility_starts_idx',
    key: { _tenantId: 1, facilityId: 1, startsAt: 1, _id: 1 },
  },
  {
    name: 'tenant_appointment_branch_starts_idx',
    key: { _tenantId: 1, branchId: 1, startsAt: 1, _id: 1 },
  },
  {
    name: 'tenant_appointment_patient_starts_idx',
    key: { _tenantId: 1, patientId: 1, startsAt: 1, _id: 1 },
  },
];

interface AppointmentMongoDocument extends Document, Omit<AppointmentRecord, 'id'> {
  _id: string;
  _tenantId: string;
}

@Injectable()
export class MongoTenantAppointmentStorage implements AppointmentStorage {
  constructor(
    @Inject(TENANT_STORAGE_TARGET_RESOLVER)
    private readonly targetResolver: TenantStorageTargetResolver,
    private readonly clients: TenantMongoClientManager,
  ) {}

  async create(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    record: AppointmentRecord,
  ): Promise<AppointmentRecord> {
    const collection = await this.getCollection(context, route);
    await this.assertRequiredIndexes(collection);
    const document = toMongoDocument(context.tenantId, record);
    try {
      await collection.insertOne(document);
      return toAppointmentRecord(document);
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async list(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    filter: AppointmentListFilter,
  ): Promise<AppointmentListResult> {
    const collection = await this.getCollection(context, route);
    const query = this.buildListFilter(context.tenantId, filter);
    try {
      const [documents, total] = await Promise.all([
        collection
          .find(query)
          .sort({ startsAt: 1, _id: 1 })
          .skip(filter.offset)
          .limit(filter.limit)
          .toArray(),
        collection.countDocuments(query),
      ]);
      const items = documents.map(toAppointmentRecord);
      return {
        items,
        limit: filter.limit,
        offset: filter.offset,
        total,
        hasNext: filter.offset + items.length < total,
      };
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async findById(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
  ): Promise<AppointmentRecord | null> {
    const collection = await this.getCollection(context, route);
    try {
      const document = await collection.findOne({ _tenantId: context.tenantId, _id: id });
      return document ? toAppointmentRecord(document) : null;
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async hasProviderOverlap(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    input: { doctorId: string; startsAt: Date; endsAt: Date; excludeId?: string },
  ): Promise<boolean> {
    const collection = await this.getCollection(context, route);
    try {
      const existing = await collection.findOne(
        {
          _tenantId: context.tenantId,
          doctorId: input.doctorId,
          status: 'SCHEDULED',
          startsAt: { $lt: input.endsAt },
          endsAt: { $gt: input.startsAt },
          ...(input.excludeId ? { _id: { $ne: input.excludeId } } : {}),
        },
        { projection: { _id: 1 } },
      );
      return existing !== null;
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async update(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    expectedVersion: number,
    patch: AppointmentMutationPatch,
  ): Promise<AppointmentRecord | null> {
    const collection = await this.getCollection(context, route);
    await this.assertRequiredIndexes(collection);
    try {
      const result = await collection.updateOne(
        {
          _tenantId: context.tenantId,
          _id: id,
          version: expectedVersion,
        },
        {
          $set: { ...patch, version: expectedVersion + 1 },
        },
      );
      if (result.matchedCount !== 1) return null;
      const document = await collection.findOne({ _tenantId: context.tenantId, _id: id });
      return document ? toAppointmentRecord(document) : null;
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async ensureIndexesForTarget(target: TenantStorageTargetRecord): Promise<void> {
    try {
      const database = await this.clients.getDatabase(target);
      const collection = database.collection<AppointmentMongoDocument>(APPOINTMENT_COLLECTION_NAME);
      for (const index of REQUIRED_APPOINTMENT_INDEXES) {
        await collection.createIndex(index.key, { name: index.name });
      }
      const indexes = await collection.indexes();
      if (!hasRequiredIndexes(indexes)) throw new TenantStorageUnavailableError();
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  private async assertRequiredIndexes(
    collection: Collection<AppointmentMongoDocument>,
  ): Promise<void> {
    let indexes: IndexDescription[];
    try {
      indexes = await collection.indexes();
    } catch {
      throw new TenantStorageUnavailableError();
    }
    if (!hasRequiredIndexes(indexes)) throw new TenantStorageUnavailableError();
  }

  private async getCollection(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<Collection<AppointmentMongoDocument>> {
    if (!context || !isWellFormedTrustedTenantContext(context)) {
      throw new TenantContextInvalidError();
    }
    if (!route || !Array.isArray(route.placements) || route.placements.length === 0) {
      throw new TenantStorageNotConfiguredError();
    }
    if (route.placements.length !== 1) throw new TenantStorageUnavailableError();

    const placement = route.placements[0];
    if (!placement || typeof placement.placementId !== 'string') {
      throw new TenantStorageUnavailableError();
    }

    const target = await this.targetResolver.findActivePrimaryTarget(
      context,
      placement.placementId,
    );
    if (!target) throw new TenantStorageNotConfiguredError();
    if (
      target.tenantId.toLowerCase() !== context.tenantId.toLowerCase() ||
      target.status !== 'ACTIVE' ||
      !target.isPrimary
    ) {
      throw new TenantStorageUnavailableError();
    }

    const database = await this.clients.getDatabase(target);
    return database.collection<AppointmentMongoDocument>(APPOINTMENT_COLLECTION_NAME);
  }

  private buildListFilter(
    tenantId: string,
    filter: AppointmentListFilter,
  ): Filter<AppointmentMongoDocument> {
    const clauses: Filter<AppointmentMongoDocument>[] = [{ _tenantId: tenantId }];
    if (filter.status) clauses.push({ status: filter.status });
    if (filter.doctorId) clauses.push({ doctorId: filter.doctorId });
    if (filter.facilityId) clauses.push({ facilityId: filter.facilityId });
    if (filter.branchId) clauses.push({ branchId: filter.branchId });
    if (filter.patientId) clauses.push({ patientId: filter.patientId });
    if (filter.from || filter.to) {
      clauses.push({
        ...(filter.from ? { endsAt: { $gt: filter.from } } : {}),
        ...(filter.to ? { startsAt: { $lt: filter.to } } : {}),
      });
    }
    if (!filter.accessScope.unrestricted) {
      const allowedLocations: Filter<AppointmentMongoDocument>[] = [];
      if (filter.accessScope.facilityIds.length > 0) {
        allowedLocations.push({ facilityId: { $in: [...filter.accessScope.facilityIds] } });
      }
      if (filter.accessScope.branchIds.length > 0) {
        allowedLocations.push({ branchId: { $in: [...filter.accessScope.branchIds] } });
      }
      clauses.push(
        allowedLocations.length > 0 ? { $or: allowedLocations } : { _id: { $exists: false } },
      );
    }
    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  }
}

function hasRequiredIndexes(indexes: IndexDescription[]): boolean {
  return REQUIRED_APPOINTMENT_INDEXES.every((required) =>
    indexes.some(
      (existing) =>
        existing.name === required.name &&
        existing.unique !== true &&
        existing.partialFilterExpression === undefined &&
        sameIndexKey(existing.key, required.key),
    ),
  );
}

function sameIndexKey(left: IndexSpecification, right: IndexSpecification): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value], index) => {
      const [rightKey, rightValue] = rightEntries[index];
      return key === rightKey && value === rightValue;
    })
  );
}

function toMongoDocument(tenantId: string, record: AppointmentRecord): AppointmentMongoDocument {
  return {
    _id: record.id,
    _tenantId: tenantId,
    patientId: record.patientId,
    doctorId: record.doctorId,
    facilityId: record.facilityId,
    branchId: record.branchId,
    serviceId: record.serviceId,
    startsAt: new Date(record.startsAt),
    endsAt: new Date(record.endsAt),
    status: record.status,
    reason: record.reason,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    cancelledAt: record.cancelledAt ? new Date(record.cancelledAt) : null,
    cancelledBy: record.cancelledBy,
    version: record.version,
  };
}

function toAppointmentRecord(document: AppointmentMongoDocument): AppointmentRecord {
  return {
    id: document._id,
    patientId: document.patientId,
    doctorId: document.doctorId,
    facilityId: document.facilityId,
    branchId: document.branchId,
    serviceId: document.serviceId,
    startsAt: new Date(document.startsAt),
    endsAt: new Date(document.endsAt),
    status: document.status,
    reason: document.reason,
    createdAt: new Date(document.createdAt),
    updatedAt: new Date(document.updatedAt),
    createdBy: document.createdBy,
    updatedBy: document.updatedBy,
    cancelledAt: document.cancelledAt ? new Date(document.cancelledAt) : null,
    cancelledBy: document.cancelledBy,
    version: document.version,
  };
}
