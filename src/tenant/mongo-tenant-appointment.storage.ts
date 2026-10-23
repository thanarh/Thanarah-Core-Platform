import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Document, Filter, IndexDescription, IndexSpecification } from 'mongodb';
import { randomUUID } from 'node:crypto';
import type {
  AppointmentListFilter,
  AppointmentListResult,
  AppointmentRecord,
} from './appointment.model';
import type { AppointmentMutationPatch, AppointmentStorage } from './tenant-appointment.storage';
import type {
  AppointmentSchedulingLock,
  LockedAppointmentStorage,
} from './tenant-appointment.storage';
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
import { AppointmentScheduleLockConflictError } from './appointment.errors';
import { TenantMongoClientManager } from './tenant-mongo-client.manager';
import { TENANT_STORAGE_TARGET_RESOLVER } from './tenant-storage.registry';
import type {
  TenantStorageTargetRecord,
  TenantStorageTargetResolver,
} from './tenant-storage.registry';

const APPOINTMENT_COLLECTION_NAME = 'appointments';
const PATIENT_COLLECTION_NAME = 'patients';
const SCHEDULE_LOCK_COLLECTION_NAME = 'appointment_schedule_locks';

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
  {
    name: 'tenant_appointment_service_starts_idx',
    key: { _tenantId: 1, serviceId: 1, startsAt: 1, _id: 1 },
  },
];

const REQUIRED_SCHEDULE_LOCK_INDEX = {
  name: 'tenant_appointment_schedule_lock_unique',
  key: { _tenantId: 1, resourceType: 1, resourceId: 1 },
} satisfies { name: string; key: IndexSpecification };

interface AppointmentMongoDocument extends Document, Omit<AppointmentRecord, 'id'> {
  _id: string;
  _tenantId: string;
}

interface ScheduleLockMongoDocument extends Document {
  _tenantId: string;
  resourceType: AppointmentSchedulingLock['resourceType'];
  resourceId: string;
  ownerToken: string;
  acquiredAt: Date;
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
    const baseQuery = this.buildListFilter(context.tenantId, filter);
    try {
      if (filter.search && !isUuid(filter.search) && filter.searchPatientRecords) {
        const escapedSearch = new RegExp(escapeRegex(filter.search), 'i');
        const patientSearchPipeline: Document[] = [
          { $match: baseQuery },
          {
            $lookup: {
              from: PATIENT_COLLECTION_NAME,
              let: { patientId: '$patientId', tenantId: '$_tenantId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$_id', '$$patientId'] },
                        { $eq: ['$_tenantId', '$$tenantId'] },
                      ],
                    },
                  },
                },
                {
                  $project: {
                    patientNumber: 1,
                    firstName: 1,
                    middleName: 1,
                    lastName: 1,
                    preferredName: 1,
                    phone: 1,
                    email: 1,
                    searchName: {
                      $trim: {
                        input: {
                          $concat: [
                            { $ifNull: ['$preferredName', '$firstName'] },
                            ' ',
                            { $ifNull: ['$middleName', ''] },
                            ' ',
                            { $ifNull: ['$lastName', ''] },
                          ],
                        },
                      },
                    },
                  },
                },
              ],
              as: '_patientSearch',
            },
          },
          {
            $match: {
              $or: [
                { '_patientSearch.patientNumber': escapedSearch },
                { '_patientSearch.firstName': escapedSearch },
                { '_patientSearch.middleName': escapedSearch },
                { '_patientSearch.lastName': escapedSearch },
                { '_patientSearch.preferredName': escapedSearch },
                { '_patientSearch.searchName': escapedSearch },
                { '_patientSearch.phone': escapedSearch },
                { '_patientSearch.email': escapedSearch },
              ],
            },
          },
          { $sort: { startsAt: 1, _id: 1 } },
          {
            $facet: {
              items: [
                { $skip: filter.offset },
                { $limit: filter.limit },
                { $unset: '_patientSearch' },
              ],
              count: [{ $count: 'value' }],
            },
          },
        ];
        const [result] = await collection
          .aggregate<{
            items: AppointmentMongoDocument[];
            count: Array<{ value: number }>;
          }>(patientSearchPipeline)
          .toArray();
        const items = (result?.items ?? []).map(toAppointmentRecord);
        const total = result?.count[0]?.value ?? 0;
        return {
          items,
          limit: filter.limit,
          offset: filter.offset,
          total,
          hasNext: filter.offset + items.length < total,
        };
      }
      if (filter.search && !isUuid(filter.search)) {
        return {
          items: [],
          limit: filter.limit,
          offset: filter.offset,
          total: 0,
          hasNext: false,
        };
      }

      const query = this.withAppointmentIdSearch(baseQuery, filter);
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

  async withSchedulingLocks<T>(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    locks: AppointmentSchedulingLock[],
    operation: (storage: LockedAppointmentStorage) => Promise<T>,
  ): Promise<T> {
    const database = await this.getDatabase(context, route);
    const appointments = database.collection<AppointmentMongoDocument>(APPOINTMENT_COLLECTION_NAME);
    const lockCollection = database.collection<ScheduleLockMongoDocument>(
      SCHEDULE_LOCK_COLLECTION_NAME,
    );
    await this.assertRequiredIndexes(appointments);
    await this.assertRequiredScheduleLockIndex(lockCollection);
    const lockKeys = normalizeLocks(locks);
    const acquired: Array<{
      resourceType: AppointmentSchedulingLock['resourceType'];
      resourceId: string;
      ownerToken: string;
    }> = [];
    try {
      for (const lock of lockKeys) {
        const ownerToken = randomUUID();
        // Track the owner before sending the write: a write-concern/network
        // error can arrive after MongoDB has persisted the lock.
        acquired.push({ ...lock, ownerToken });
        try {
          await lockCollection.insertOne({
            _tenantId: context.tenantId,
            resourceType: lock.resourceType,
            resourceId: lock.resourceId,
            ownerToken,
            acquiredAt: new Date(),
          });
        } catch (error) {
          if (isDuplicateKeyError(error)) throw new AppointmentScheduleLockConflictError();
          throw error;
        }
      }
    } catch (error) {
      const releaseFailed = await this.releaseScheduleLocks(
        context.tenantId,
        lockCollection,
        acquired,
      );
      if (releaseFailed) throw new TenantStorageUnavailableError();
      if (error instanceof AppointmentScheduleLockConflictError) throw error;
      throw new TenantStorageUnavailableError();
    }

    const lockedStorage: LockedAppointmentStorage = {
      create: async (record) => {
        try {
          const document = toMongoDocument(context.tenantId, record);
          await appointments.insertOne(document);
          return toAppointmentRecord(document);
        } catch {
          throw new TenantStorageUnavailableError();
        }
      },
      findById: async (id) => {
        try {
          const document = await appointments.findOne({ _tenantId: context.tenantId, _id: id });
          return document ? toAppointmentRecord(document) : null;
        } catch {
          throw new TenantStorageUnavailableError();
        }
      },
      hasProviderOverlap: async (input) => {
        try {
          const existing = await appointments.findOne(
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
      },
      update: async (id, expectedVersion, patch) => {
        try {
          const result = await appointments.updateOne(
            {
              _tenantId: context.tenantId,
              _id: id,
              version: expectedVersion,
            },
            { $set: { ...patch, version: expectedVersion + 1 } },
          );
          if (result.matchedCount !== 1) return null;
          const document = await appointments.findOne({ _tenantId: context.tenantId, _id: id });
          return document ? toAppointmentRecord(document) : null;
        } catch {
          throw new TenantStorageUnavailableError();
        }
      },
    };

    let result!: T;
    let operationFailed = false;
    let operationError: unknown;
    try {
      result = await operation(lockedStorage);
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }

    const releaseFailed = await this.releaseScheduleLocks(
      context.tenantId,
      lockCollection,
      acquired,
    );
    if (releaseFailed) throw new TenantStorageUnavailableError();
    if (operationFailed) throw operationError;
    return result;
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
      const lockCollection = database.collection<ScheduleLockMongoDocument>(
        SCHEDULE_LOCK_COLLECTION_NAME,
      );
      await lockCollection.createIndex(REQUIRED_SCHEDULE_LOCK_INDEX.key, {
        name: REQUIRED_SCHEDULE_LOCK_INDEX.name,
        unique: true,
      });
      if (!(await this.hasRequiredScheduleLockIndex(lockCollection))) {
        throw new TenantStorageUnavailableError();
      }
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

  private async assertRequiredScheduleLockIndex(
    collection: Collection<ScheduleLockMongoDocument>,
  ): Promise<void> {
    if (!(await this.hasRequiredScheduleLockIndex(collection))) {
      throw new TenantStorageUnavailableError();
    }
  }

  private async hasRequiredScheduleLockIndex(
    collection: Collection<ScheduleLockMongoDocument>,
  ): Promise<boolean> {
    let indexes: IndexDescription[];
    try {
      indexes = await collection.indexes();
    } catch {
      throw new TenantStorageUnavailableError();
    }
    return indexes.some(
      (existing) =>
        existing.name === REQUIRED_SCHEDULE_LOCK_INDEX.name &&
        existing.unique === true &&
        existing.partialFilterExpression === undefined &&
        sameIndexKey(existing.key, REQUIRED_SCHEDULE_LOCK_INDEX.key),
    );
  }

  private async releaseScheduleLocks(
    tenantId: string,
    collection: Collection<ScheduleLockMongoDocument>,
    locks: Array<{
      resourceType: AppointmentSchedulingLock['resourceType'];
      resourceId: string;
      ownerToken: string;
    }>,
  ): Promise<boolean> {
    let failed = false;
    for (const lock of [...locks].reverse()) {
      try {
        const result = await collection.deleteOne({
          _tenantId: tenantId,
          resourceType: lock.resourceType,
          resourceId: lock.resourceId,
          ownerToken: lock.ownerToken,
        });
        if (result.deletedCount !== 1) failed = true;
      } catch {
        failed = true;
      }
    }
    return failed;
  }

  private async getCollection(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<Collection<AppointmentMongoDocument>> {
    const database = await this.getDatabase(context, route);
    return database.collection<AppointmentMongoDocument>(APPOINTMENT_COLLECTION_NAME);
  }

  private async getDatabase(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<NonNullable<Awaited<ReturnType<TenantMongoClientManager['getDatabase']>>>> {
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

    return this.clients.getDatabase(target);
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
    if (filter.serviceId) clauses.push({ serviceId: filter.serviceId });
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

  private withAppointmentIdSearch(
    baseQuery: Filter<AppointmentMongoDocument>,
    filter: AppointmentListFilter,
  ): Filter<AppointmentMongoDocument> {
    if (!filter.search || !isUuid(filter.search)) return baseQuery;
    const id = filter.search.toLowerCase();
    const searchableIds: Filter<AppointmentMongoDocument>[] = [
      { _id: id },
      { doctorId: id },
      { facilityId: id },
      { branchId: id },
      { serviceId: id },
      ...(filter.searchPatientRecords ? [{ patientId: id }] : []),
    ];
    return { $and: [baseQuery, { $or: searchableIds }] };
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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

function normalizeLocks(locks: AppointmentSchedulingLock[]): AppointmentSchedulingLock[] {
  const unique = new Map<string, AppointmentSchedulingLock>();
  for (const lock of locks) {
    if (
      !lock ||
      !['DOCTOR', 'FACILITY', 'IDEMPOTENCY'].includes(lock.resourceType) ||
      typeof lock.resourceId !== 'string' ||
      lock.resourceId.length === 0
    ) {
      throw new TenantContextInvalidError();
    }
    unique.set(`${lock.resourceType}:${lock.resourceId}`, lock);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.resourceType.localeCompare(right.resourceType) ||
      left.resourceId.localeCompare(right.resourceId),
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
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
