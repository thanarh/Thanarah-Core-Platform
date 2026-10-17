import { Inject, Injectable } from '@nestjs/common';
import type {
  Collection,
  Document,
  Filter,
  IndexDescription,
  IndexSpecification,
  UpdateFilter,
} from 'mongodb';
import type {
  EncounterHistoryEvent,
  EncounterListFilter,
  EncounterListResult,
  EncounterRecord,
} from './encounter.model';
import { EncounterAppointmentConflictError } from './encounter.errors';
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
import type { EncounterMutationPatch, EncounterStorage } from './tenant-encounter.storage';
import { TenantMongoClientManager } from './tenant-mongo-client.manager';
import { TENANT_STORAGE_TARGET_RESOLVER } from './tenant-storage.registry';
import type {
  TenantStorageTargetRecord,
  TenantStorageTargetResolver,
} from './tenant-storage.registry';

const ENCOUNTER_COLLECTION_NAME = 'encounters';

const ACTIVE_APPOINTMENT_INDEX_NAME = 'tenant_encounter_active_appointment_unique_idx';

const REQUIRED_ENCOUNTER_INDEXES: ReadonlyArray<{
  name: string;
  key: IndexSpecification;
  unique?: boolean;
  partialFilterExpression?: Document;
}> = [
  {
    name: 'tenant_encounter_id_unique_idx',
    key: { _tenantId: 1, _id: 1 },
    unique: true,
  },
  {
    name: ACTIVE_APPOINTMENT_INDEX_NAME,
    key: { _tenantId: 1, appointmentId: 1 },
    unique: true,
    partialFilterExpression: {
      appointmentId: { $type: 'string' },
      status: { $in: ['DRAFT', 'COMPLETED'] },
    },
  },
  {
    name: 'tenant_encounter_appointment_date_idx',
    key: { _tenantId: 1, appointmentId: 1, encounterAt: -1, _id: -1 },
  },
  {
    name: 'tenant_encounter_patient_date_idx',
    key: { _tenantId: 1, patientId: 1, encounterAt: -1, _id: -1 },
  },
  {
    name: 'tenant_encounter_doctor_date_idx',
    key: { _tenantId: 1, doctorId: 1, encounterAt: -1, _id: -1 },
  },
  {
    name: 'tenant_encounter_facility_date_idx',
    key: { _tenantId: 1, facilityId: 1, encounterAt: -1, _id: -1 },
  },
  {
    name: 'tenant_encounter_branch_date_idx',
    key: { _tenantId: 1, facilityId: 1, branchId: 1, encounterAt: -1, _id: -1 },
  },
  {
    name: 'tenant_encounter_status_date_idx',
    key: { _tenantId: 1, status: 1, encounterAt: -1, _id: -1 },
  },
];

interface EncounterMongoDocument extends Document {
  _id: string;
  _tenantId: string;
  appointmentId: string | null;
  patientId: string;
  doctorId: string;
  facilityId: string;
  branchId: string | null;
  encounterAt: Date;
  status: EncounterRecord['status'];
  clinical: EncounterRecord['clinical'];
  diagnoses: EncounterRecord['diagnoses'];
  serviceRecords: EncounterRecord['serviceRecords'];
  amendments: EncounterRecord['amendments'];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  completedAt: Date | null;
  completedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  history: EncounterHistoryEvent[];
}

@Injectable()
export class MongoTenantEncounterStorage implements EncounterStorage {
  constructor(
    @Inject(TENANT_STORAGE_TARGET_RESOLVER)
    private readonly targetResolver: TenantStorageTargetResolver,
    private readonly clients: TenantMongoClientManager,
  ) {}

  async create(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    record: EncounterRecord,
  ): Promise<EncounterRecord> {
    const collection = await this.getCollection(context, route);
    await this.assertRequiredIndexes(collection);
    const document = toMongoDocument(context.tenantId, record);
    try {
      await collection.insertOne(document);
      return toEncounterRecord(document);
    } catch (error) {
      if (isAppointmentUniqueViolation(error)) throw new EncounterAppointmentConflictError();
      throw new TenantStorageUnavailableError();
    }
  }

  async list(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    filter: EncounterListFilter,
  ): Promise<EncounterListResult> {
    const collection = await this.getCollection(context, route);
    await this.assertRequiredIndexes(collection);
    const query = buildFilter(context.tenantId, filter);
    try {
      const [documents, total] = await Promise.all([
        collection
          .find(query, { projection: { _tenantId: 0, history: 0 } })
          .sort({ encounterAt: -1, _id: -1 })
          .skip(filter.offset)
          .limit(filter.limit)
          .toArray(),
        collection.countDocuments(query),
      ]);
      const items = documents.map((document) =>
        toEncounterRecord({ ...document, history: [] } as EncounterMongoDocument),
      );
      return {
        items,
        total,
        limit: filter.limit,
        offset: filter.offset,
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
  ): Promise<EncounterRecord | null> {
    const collection = await this.getCollection(context, route);
    await this.assertRequiredIndexes(collection);
    try {
      const document = await collection.findOne({ _tenantId: context.tenantId, _id: id });
      return document ? toEncounterRecord(document) : null;
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async findActiveByAppointment(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    appointmentId: string,
  ): Promise<EncounterRecord | null> {
    const collection = await this.getCollection(context, route);
    await this.assertRequiredIndexes(collection);
    try {
      const document = await collection.findOne({
        _tenantId: context.tenantId,
        appointmentId,
        status: { $in: ['DRAFT', 'COMPLETED'] },
      });
      return document ? toEncounterRecord(document) : null;
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async update(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    expectedVersion: number,
    expectedStatus: EncounterRecord['status'],
    patch: EncounterMutationPatch,
    event: EncounterHistoryEvent,
  ): Promise<EncounterRecord | null> {
    const collection = await this.getCollection(context, route);
    await this.assertRequiredIndexes(collection);
    try {
      const update = {
        $set: { ...patch, version: expectedVersion + 1 },
        $push: { history: { $each: [event] } },
      } as unknown as UpdateFilter<EncounterMongoDocument>;
      const updated = await collection.findOneAndUpdate(
        {
          _tenantId: context.tenantId,
          _id: id,
          version: expectedVersion,
          status: expectedStatus,
        },
        update,
        { returnDocument: 'after' },
      );
      return updated ? toEncounterRecord(updated) : null;
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async history(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
  ): Promise<EncounterHistoryEvent[] | null> {
    const collection = await this.getCollection(context, route);
    await this.assertRequiredIndexes(collection);
    try {
      const document = await collection.findOne(
        { _tenantId: context.tenantId, _id: id },
        { projection: { _id: 1, _tenantId: 1, history: 1 } },
      );
      return document
        ? (document.history ?? []).map((event: EncounterHistoryEvent) => ({
            ...event,
            occurredAt: new Date(event.occurredAt),
            changedFields: [...event.changedFields],
          }))
        : null;
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async ensureIndexesForTarget(target: TenantStorageTargetRecord): Promise<void> {
    try {
      const database = await this.clients.getDatabase(target);
      const collection = database.collection<EncounterMongoDocument>(ENCOUNTER_COLLECTION_NAME);
      for (const index of REQUIRED_ENCOUNTER_INDEXES) {
        await collection.createIndex(index.key, {
          name: index.name,
          ...(index.unique ? { unique: true } : {}),
          ...(index.partialFilterExpression
            ? { partialFilterExpression: index.partialFilterExpression }
            : {}),
        });
      }
      await this.assertRequiredIndexes(collection);
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  private async assertRequiredIndexes(
    collection: Collection<EncounterMongoDocument>,
  ): Promise<void> {
    try {
      const indexes = await collection.indexes();
      if (!hasRequiredEncounterIndexes(indexes)) throw new TenantStorageUnavailableError();
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  private async getCollection(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<Collection<EncounterMongoDocument>> {
    const database = await this.getDatabase(context, route);
    return database.collection<EncounterMongoDocument>(ENCOUNTER_COLLECTION_NAME);
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
}

function buildFilter(
  tenantId: string,
  filter: EncounterListFilter,
): Filter<EncounterMongoDocument> {
  const clauses: Filter<EncounterMongoDocument>[] = [{ _tenantId: tenantId }];
  if (filter.search) {
    clauses.push({
      $or: [
        { _id: filter.search },
        { appointmentId: filter.search },
        { patientId: filter.search },
        { doctorId: filter.search },
      ],
    });
  }
  if (filter.appointmentId) clauses.push({ appointmentId: filter.appointmentId });
  if (filter.patientId) clauses.push({ patientId: filter.patientId });
  if (filter.doctorId) clauses.push({ doctorId: filter.doctorId });
  if (filter.facilityId) clauses.push({ facilityId: filter.facilityId });
  if (filter.branchId) clauses.push({ branchId: filter.branchId });
  if (filter.status) clauses.push({ status: filter.status });
  if (filter.from || filter.to) {
    clauses.push({
      encounterAt: {
        ...(filter.from ? { $gte: filter.from } : {}),
        ...(filter.to ? { $lt: filter.to } : {}),
      },
    });
  }
  if (!filter.accessScope.unrestricted) {
    const scopeFilters: Filter<EncounterMongoDocument>[] = [];
    if (filter.accessScope.facilityIds.length) {
      scopeFilters.push({ facilityId: { $in: filter.accessScope.facilityIds } });
    }
    if (filter.accessScope.branchIds.length) {
      scopeFilters.push({ branchId: { $in: filter.accessScope.branchIds } });
    }
    clauses.push(scopeFilters.length ? { $or: scopeFilters } : { _id: { $exists: false } });
  }
  return clauses.length === 1 ? clauses[0]! : { $and: clauses };
}

function toMongoDocument(tenantId: string, record: EncounterRecord): EncounterMongoDocument {
  const { id, ...fields } = record;
  return { _id: id, _tenantId: tenantId.toLowerCase(), ...fields } as EncounterMongoDocument;
}

function toEncounterRecord(document: EncounterMongoDocument): EncounterRecord {
  return {
    id: document._id,
    appointmentId: document.appointmentId,
    patientId: document.patientId,
    doctorId: document.doctorId,
    facilityId: document.facilityId,
    branchId: document.branchId,
    encounterAt: new Date(document.encounterAt),
    status: document.status,
    clinical: document.clinical ?? {},
    diagnoses: (document.diagnoses ?? []).map((diagnosis) => ({
      ...diagnosis,
      onsetAt: diagnosis.onsetAt ? new Date(diagnosis.onsetAt) : null,
      recordedAt: new Date(diagnosis.recordedAt),
      updatedAt: new Date(diagnosis.updatedAt),
    })),
    serviceRecords: (document.serviceRecords ?? []).map((service) => ({
      ...service,
      startedAt: service.startedAt ? new Date(service.startedAt) : null,
      completedAt: service.completedAt ? new Date(service.completedAt) : null,
      cancelledAt: service.cancelledAt ? new Date(service.cancelledAt) : null,
      createdAt: new Date(service.createdAt),
      updatedAt: new Date(service.updatedAt),
    })),
    amendments: (document.amendments ?? []).map((amendment) => ({
      ...amendment,
      createdAt: new Date(amendment.createdAt),
      finalizedAt: amendment.finalizedAt ? new Date(amendment.finalizedAt) : null,
      diagnoses: (amendment.diagnoses ?? []).map((diagnosis) => ({
        ...diagnosis,
        onsetAt: diagnosis.onsetAt ? new Date(diagnosis.onsetAt) : null,
        recordedAt: new Date(diagnosis.recordedAt),
        updatedAt: new Date(diagnosis.updatedAt),
      })),
      serviceRecords: (amendment.serviceRecords ?? []).map((service) => ({
        ...service,
        startedAt: service.startedAt ? new Date(service.startedAt) : null,
        completedAt: service.completedAt ? new Date(service.completedAt) : null,
        cancelledAt: service.cancelledAt ? new Date(service.cancelledAt) : null,
        createdAt: new Date(service.createdAt),
        updatedAt: new Date(service.updatedAt),
      })),
    })),
    version: document.version,
    createdAt: new Date(document.createdAt),
    updatedAt: new Date(document.updatedAt),
    createdBy: document.createdBy,
    updatedBy: document.updatedBy,
    completedAt: document.completedAt ? new Date(document.completedAt) : null,
    completedBy: document.completedBy,
    cancelledAt: document.cancelledAt ? new Date(document.cancelledAt) : null,
    cancelledBy: document.cancelledBy,
    cancellationReason: document.cancellationReason,
    history: (document.history ?? []).map((event: EncounterHistoryEvent) => ({
      ...event,
      occurredAt: new Date(event.occurredAt),
      changedFields: [...event.changedFields],
    })),
  };
}

function hasRequiredEncounterIndexes(indexes: IndexDescription[]): boolean {
  return REQUIRED_ENCOUNTER_INDEXES.every((required) => {
    const index = indexes.find((candidate) => candidate.name === required.name);
    return (
      !!index &&
      sameIndexKey(index.key, required.key) &&
      !!index.unique === !!required.unique &&
      stableStringify(index.partialFilterExpression ?? null) ===
        stableStringify(required.partialFilterExpression ?? null)
    );
  });
}

function sameIndexKey(left: IndexDescription['key'], right: IndexSpecification): boolean {
  return JSON.stringify(Object.entries(left)) === JSON.stringify(Object.entries(right));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isAppointmentUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
    message?: string;
  };
  return (
    candidate.code === 11000 &&
    (candidate.keyPattern?.appointmentId === 1 ||
      candidate.message?.includes(ACTIVE_APPOINTMENT_INDEX_NAME) === true)
  );
}
