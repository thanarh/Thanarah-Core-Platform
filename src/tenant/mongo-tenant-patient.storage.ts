import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Document, Filter } from 'mongodb';
import type { CreatePatientInput, ListPatientsQuery, UpdatePatientInput } from './patient.dto';
import {
  PATIENT_DIRECTORY_SEARCH_FIELDS,
  type PatientDirectoryRecord,
  type PatientDuplicateIdentity,
  type PatientMutationResult,
  type PatientRecord,
  type PatientStatus,
} from './patient.model';
import {
  normalizePatientDuplicateIdentity,
  PATIENT_DUPLICATE_COLLATION,
} from './patient-duplicate';
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
import type { TenantPatientList, TenantPatientStorage } from './tenant-patient.storage';
import { TenantMongoClientManager } from './tenant-mongo-client.manager';
import { TENANT_STORAGE_TARGET_RESOLVER } from './tenant-storage.registry';
import type {
  TenantStorageTargetRecord,
  TenantStorageTargetResolver,
} from './tenant-storage.registry';

const PATIENT_COLLECTION_NAME = 'patients';
const PATIENT_NUMBER_INDEX_NAME = 'tenant_patient_number_unique';
const PATIENT_DIRECTORY_PROJECTION = {
  _id: 1,
  patientNumber: 1,
  firstName: 1,
  middleName: 1,
  lastName: 1,
  preferredName: 1,
  phone: 1,
  email: 1,
  status: 1,
} as const;

interface PatientMongoDocument extends Document, Omit<PatientRecord, 'id'> {
  _id: string;
  _tenantId: string;
}

@Injectable()
export class MongoTenantPatientStorage implements TenantPatientStorage {
  constructor(
    @Inject(TENANT_STORAGE_TARGET_RESOLVER)
    private readonly targetResolver: TenantStorageTargetResolver,
    private readonly clients: TenantMongoClientManager,
  ) {}

  async create(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    input: CreatePatientInput,
  ): Promise<PatientMutationResult> {
    const collection = await this.getCollection(context, route);
    const now = new Date();
    const document: PatientMongoDocument = {
      _id: randomUUID(),
      _tenantId: context.tenantId,
      patientNumber: input.patientNumber,
      firstName: input.firstName,
      middleName: input.middleName ?? null,
      lastName: input.lastName,
      preferredName: input.preferredName ?? null,
      dateOfBirth: cloneDate(input.dateOfBirth ?? null),
      gender: input.gender ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      nationalId: input.nationalId ?? null,
      address: input.address ?? null,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    try {
      await collection.insertOne(document);
      return { kind: 'changed', record: toPatientRecord(document) };
    } catch (error) {
      if (isPatientNumberDuplicate(error)) return { kind: 'patient-number-conflict' };
      throw error;
    }
  }

  async findPotentialDuplicates(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    identity: PatientDuplicateIdentity,
    exceptPatientId?: string,
  ): Promise<boolean> {
    const collection = await this.getCollection(context, route);
    const normalized = normalizePatientDuplicateIdentity(identity);
    const rules: Filter<PatientMongoDocument>[] = [];

    if (normalized.phone !== null) {
      rules.push({
        phone: normalized.phone,
        firstName: normalized.firstName,
        middleName: normalized.middleName,
        lastName: normalized.lastName,
      });
    }
    if (normalized.email !== null) {
      rules.push({
        email: normalized.email,
        firstName: normalized.firstName,
        middleName: normalized.middleName,
        lastName: normalized.lastName,
      });
    }
    if (normalized.dateOfBirth !== null) {
      rules.push({
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        dateOfBirth: {
          $gte: normalized.dateOfBirth,
          $lt: new Date(normalized.dateOfBirth.getTime() + 24 * 60 * 60 * 1000),
        },
      });
    }
    if (rules.length === 0) return false;

    const filter: Filter<PatientMongoDocument> = {
      _tenantId: context.tenantId,
      ...(exceptPatientId ? { _id: { $ne: exceptPatientId } } : {}),
      $or: rules,
    };
    const existing = await collection.findOne(filter, {
      projection: { _id: 1 },
      collation: PATIENT_DUPLICATE_COLLATION,
    });
    return existing !== null;
  }

  async list(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    query: ListPatientsQuery,
  ): Promise<TenantPatientList> {
    const collection = await this.getCollection(context, route);
    const filter: Filter<PatientMongoDocument> = {
      _tenantId: context.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.patientNumber ? { patientNumber: query.patientNumber } : {}),
      ...(query.search
        ? {
            $or: PATIENT_DIRECTORY_SEARCH_FIELDS.map((field) => ({
              [field]: { $regex: escapeRegex(query.search!), $options: 'i' },
            })),
          }
        : {}),
    };
    const [documents, total] = await Promise.all([
      collection
        .find(filter, { projection: PATIENT_DIRECTORY_PROJECTION })
        .sort({ createdAt: -1, _id: -1 })
        .skip(query.offset)
        .limit(query.limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);

    return { items: documents.map(toPatientDirectoryRecord), total };
  }

  async findByPatientNumber(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    patientNumber: string,
  ): Promise<PatientRecord | null> {
    const collection = await this.getCollection(context, route);
    const document = await collection.findOne({
      _tenantId: context.tenantId,
      patientNumber,
    });
    return document ? toPatientRecord(document) : null;
  }

  async findById(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
  ): Promise<PatientRecord | null> {
    const collection = await this.getCollection(context, route);
    const document = await collection.findOne({ _id: id, _tenantId: context.tenantId });
    return document ? toPatientRecord(document) : null;
  }

  async update(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    input: UpdatePatientInput,
  ): Promise<PatientMutationResult> {
    const collection = await this.getCollection(context, route);
    const fields = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as Partial<Omit<PatientMongoDocument, '_id' | '_tenantId' | 'createdAt' | 'status'>>;

    try {
      const result = await collection.updateOne(
        { _id: id, _tenantId: context.tenantId },
        { $set: { ...fields, updatedAt: new Date() } },
      );
      if (result.matchedCount === 0) return { kind: 'not-found' };

      const updated = await collection.findOne({ _id: id, _tenantId: context.tenantId });
      return updated
        ? { kind: 'changed', record: toPatientRecord(updated) }
        : { kind: 'not-found' };
    } catch (error) {
      if (isPatientNumberDuplicate(error)) return { kind: 'patient-number-conflict' };
      throw error;
    }
  }

  async changeStatusIfCurrent(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    expectedStatus: PatientStatus,
    nextStatus: PatientStatus,
    changedAt: Date,
  ): Promise<PatientMutationResult> {
    const collection = await this.getCollection(context, route);
    const result = await collection.updateOne(
      { _id: id, _tenantId: context.tenantId, status: expectedStatus },
      { $set: { status: nextStatus, updatedAt: new Date(changedAt) } },
    );
    if (result.matchedCount === 0) return { kind: 'not-changed' };

    const updated = await collection.findOne({ _id: id, _tenantId: context.tenantId });
    return updated
      ? { kind: 'changed', record: toPatientRecord(updated) }
      : { kind: 'not-changed' };
  }

  /**
   * Explicit operator action after provisioning an existing tenant database.
   * Never called at application startup or as part of a Patient request.
   */
  async ensureIndexesForTarget(target: TenantStorageTargetRecord): Promise<void> {
    const database = await this.clients.getDatabase(target);
    const collection = database.collection<PatientMongoDocument>(PATIENT_COLLECTION_NAME);
    await collection.createIndex(
      { _tenantId: 1, patientNumber: 1 },
      { unique: true, name: PATIENT_NUMBER_INDEX_NAME },
    );
    await collection.createIndex(
      { _tenantId: 1, status: 1, createdAt: -1, _id: -1 },
      { name: 'tenant_patient_status_created_idx' },
    );
    await collection.createIndex(
      { _tenantId: 1, createdAt: -1, _id: -1 },
      { name: 'tenant_patient_created_idx' },
    );
    await collection.createIndex(
      { _tenantId: 1, phone: 1, firstName: 1, middleName: 1, lastName: 1 },
      {
        name: 'tenant_patient_duplicate_phone_name_idx',
        collation: PATIENT_DUPLICATE_COLLATION,
      },
    );
    await collection.createIndex(
      { _tenantId: 1, email: 1, firstName: 1, middleName: 1, lastName: 1 },
      {
        name: 'tenant_patient_duplicate_email_name_idx',
        collation: PATIENT_DUPLICATE_COLLATION,
      },
    );
    await collection.createIndex(
      { _tenantId: 1, firstName: 1, lastName: 1, dateOfBirth: 1 },
      {
        name: 'tenant_patient_duplicate_name_dob_idx',
        collation: PATIENT_DUPLICATE_COLLATION,
      },
    );
  }

  private async getCollection(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<Collection<PatientMongoDocument>> {
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
    return database.collection<PatientMongoDocument>(PATIENT_COLLECTION_NAME);
  }
}

function isPatientNumberDuplicate(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    code?: unknown;
    keyPattern?: Record<string, unknown>;
    message?: unknown;
  };
  if (candidate.code !== 11000) return false;
  if (candidate.keyPattern?._tenantId === 1 && candidate.keyPattern.patientNumber === 1) {
    return true;
  }
  return (
    typeof candidate.message === 'string' && candidate.message.includes(PATIENT_NUMBER_INDEX_NAME)
  );
}

function toPatientRecord(document: PatientMongoDocument): PatientRecord {
  return {
    id: document._id,
    patientNumber: document.patientNumber,
    firstName: document.firstName,
    middleName: document.middleName,
    lastName: document.lastName,
    preferredName: document.preferredName,
    dateOfBirth: cloneDate(document.dateOfBirth),
    gender: document.gender,
    phone: document.phone,
    email: document.email,
    nationalId: document.nationalId,
    address: document.address,
    status: document.status,
    createdAt: new Date(document.createdAt),
    updatedAt: new Date(document.updatedAt),
  };
}

function toPatientDirectoryRecord(document: PatientMongoDocument): PatientDirectoryRecord {
  return {
    id: document._id,
    patientNumber: document.patientNumber,
    firstName: document.firstName,
    middleName: document.middleName,
    lastName: document.lastName,
    preferredName: document.preferredName,
    phone: document.phone,
    email: document.email,
    status: document.status,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function cloneDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value.getTime());
}
