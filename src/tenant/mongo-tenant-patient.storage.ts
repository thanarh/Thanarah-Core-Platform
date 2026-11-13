import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Document, Filter, IndexDescription, IndexSpecification } from 'mongodb';
import type { CreatePatientInput, ListPatientsQuery, UpdatePatientInput } from './patient.dto';
import {
  PATIENT_DIRECTORY_SEARCH_FIELDS,
  type PatientDirectoryRecord,
  type PatientDuplicateIdentity,
  type PatientLifecycleMutationResult,
  type PatientMutationResult,
  type PatientRecord,
  type PatientStatus,
} from './patient.model';
import {
  hasPatientDuplicateIdentityChange,
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
import { TENANT_STORAGE_TARGET_RESOLVER } from './tenant-storage.registry.contract';
import type {
  TenantStorageTargetRecord,
  TenantStorageTargetResolver,
} from './tenant-storage.registry.contract';

const PATIENT_COLLECTION_NAME = 'patients';
const PATIENT_NUMBER_INDEX_NAME = 'tenant_patient_number_unique';
const PATIENT_DUPLICATE_INDEXES: PatientDuplicateUniqueIndexDefinition[] = [
  {
    name: 'tenant_patient_duplicate_phone_name_unique_idx',
    key: { _tenantId: 1, firstName: 1, middleName: 1, lastName: 1, phone: 1 },
    partialField: 'phone',
    partialType: 'string',
  },
  {
    name: 'tenant_patient_duplicate_email_name_unique_idx',
    key: { _tenantId: 1, firstName: 1, middleName: 1, lastName: 1, email: 1 },
    partialField: 'email',
    partialType: 'string',
  },
  {
    name: 'tenant_patient_duplicate_name_dob_unique_idx',
    key: { _tenantId: 1, lastName: 1, firstName: 1, dateOfBirth: 1 },
    partialField: 'dateOfBirth',
    partialType: 'date',
  },
];
const LEGACY_PATIENT_DUPLICATE_INDEX_NAMES = [
  'tenant_patient_duplicate_phone_name_idx',
  'tenant_patient_duplicate_email_name_idx',
  'tenant_patient_duplicate_name_dob_idx',
];
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

interface PatientDuplicateUniqueIndexDefinition {
  name: string;
  key: IndexSpecification;
  partialField: 'phone' | 'email' | 'dateOfBirth';
  partialType: 'string' | 'date';
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
    await this.assertRequiredPatientWriteIndexes(collection);
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
      if (isPatientDuplicateIndex(error)) {
        const existingNumber = await collection.findOne(
          { _tenantId: context.tenantId, patientNumber: input.patientNumber },
          { projection: { _id: 1 } },
        );
        return existingNumber
          ? { kind: 'patient-number-conflict' }
          : { kind: 'possible-duplicate' };
      }
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
    if (hasPatientDuplicateIdentityChange(input)) {
      await this.assertRequiredPatientWriteIndexes(collection);
    } else if (input.patientNumber !== undefined) {
      await this.assertPatientNumberIndex(collection);
    }
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
      if (isPatientDuplicateIndex(error)) {
        if (input.patientNumber !== undefined) {
          const existingNumber = await collection.findOne(
            {
              _tenantId: context.tenantId,
              patientNumber: input.patientNumber,
              _id: { $ne: id },
            },
            { projection: { _id: 1 } },
          );
          if (existingNumber) return { kind: 'patient-number-conflict' };
        }
        return { kind: 'possible-duplicate' };
      }
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
  ): Promise<PatientLifecycleMutationResult> {
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
    try {
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
      for (const definition of PATIENT_DUPLICATE_INDEXES) {
        await collection.createIndex(definition.key, {
          name: definition.name,
          unique: true,
          partialFilterExpression: {
            [definition.partialField]: { $type: definition.partialType },
          },
          collation: PATIENT_DUPLICATE_COLLATION,
        });
      }

      const indexes = await collection.indexes();
      if (!hasRequiredPatientWriteIndexes(indexes)) throw new TenantStorageUnavailableError();
      const existingNames = new Set(indexes.map((index) => index.name));
      for (const legacyName of LEGACY_PATIENT_DUPLICATE_INDEX_NAMES) {
        if (existingNames.has(legacyName)) await collection.dropIndex(legacyName);
      }
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  private async assertRequiredPatientWriteIndexes(
    collection: Collection<PatientMongoDocument>,
  ): Promise<void> {
    const indexes = await collection.indexes();
    if (!hasRequiredPatientWriteIndexes(indexes)) throw new TenantStorageUnavailableError();
  }

  private async assertPatientNumberIndex(
    collection: Collection<PatientMongoDocument>,
  ): Promise<void> {
    const indexes = await collection.indexes();
    if (!hasPatientNumberUniqueIndex(indexes)) throw new TenantStorageUnavailableError();
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

function hasRequiredPatientWriteIndexes(indexes: IndexDescription[]): boolean {
  return (
    hasPatientNumberUniqueIndex(indexes) &&
    PATIENT_DUPLICATE_INDEXES.every((definition) =>
      indexes.some((index) => isAtomicDuplicateIndex(index, definition)),
    )
  );
}

function hasPatientNumberUniqueIndex(indexes: IndexDescription[]): boolean {
  return indexes.some(
    (index) =>
      index.name === PATIENT_NUMBER_INDEX_NAME &&
      index.unique === true &&
      index.partialFilterExpression === undefined &&
      hasSimplePatientNumberCollation(index) &&
      sameIndexKey(index.key, { _tenantId: 1, patientNumber: 1 }),
  );
}

function hasSimplePatientNumberCollation(index: IndexDescription): boolean {
  // MongoDB omits collation metadata for the default simple collation.
  if (index.collation === undefined) return true;
  const collation = index.collation as Document;
  return collation.locale === 'simple' && Object.keys(collation).every((key) => key === 'locale');
}

function isAtomicDuplicateIndex(
  index: IndexDescription,
  definition: PatientDuplicateUniqueIndexDefinition,
): boolean {
  if (
    index.name !== definition.name ||
    index.unique !== true ||
    !sameIndexKey(index.key, definition.key) ||
    !hasExpectedPartialFilter(index.partialFilterExpression, definition)
  ) {
    return false;
  }

  const collation = index.collation as Document | undefined;
  return (
    collation?.locale === PATIENT_DUPLICATE_COLLATION.locale &&
    collation.strength === PATIENT_DUPLICATE_COLLATION.strength &&
    collation.caseLevel !== true &&
    collation.numericOrdering !== true &&
    collation.alternate !== 'shifted' &&
    collation.backwards !== true
  );
}

function sameIndexKey(actual: IndexSpecification, expected: IndexSpecification): boolean {
  const actualEntries = Object.entries(actual as Document);
  const expectedEntries = Object.entries(expected as Document);
  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(
      ([actualField, actualDirection], position) =>
        expectedEntries[position]?.[0] === actualField &&
        expectedEntries[position]?.[1] === actualDirection,
    )
  );
}

function hasExpectedPartialFilter(
  value: IndexDescription['partialFilterExpression'],
  definition: PatientDuplicateUniqueIndexDefinition,
): boolean {
  const partialFilter = value as Document | undefined;
  if (!partialFilter || Object.keys(partialFilter).length !== 1) return false;
  const fieldFilter = partialFilter[definition.partialField] as Document | undefined;
  if (!fieldFilter || Object.keys(fieldFilter).length !== 1) return false;
  const bsonType = fieldFilter.$type;
  const numericType = definition.partialType === 'string' ? 2 : 9;
  return bsonType === definition.partialType || bsonType === numericType;
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

function isPatientDuplicateIndex(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    code?: unknown;
    keyPattern?: Record<string, unknown>;
    message?: unknown;
  };
  if (candidate.code !== 11000) return false;
  return PATIENT_DUPLICATE_INDEXES.some(
    (definition) =>
      (candidate.keyPattern !== undefined &&
        sameIndexKey(candidate.keyPattern as IndexSpecification, definition.key)) ||
      (typeof candidate.message === 'string' && candidate.message.includes(definition.name)),
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
