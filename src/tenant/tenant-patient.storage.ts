import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CreatePatientInput, ListPatientsQuery, UpdatePatientInput } from './patient.dto';
import {
  PATIENT_DIRECTORY_SEARCH_FIELDS,
  type PatientDirectoryRecord,
  type PatientDuplicateIdentity,
  type PatientMutationResult,
  type PatientRecord,
  type PatientStatus,
} from './patient.model';
import { hasPotentialPatientDuplicate } from './patient-duplicate';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from './tenant-storage.errors';
import type { TenantStorageRoute } from './tenant-storage.contract';

export const TENANT_PATIENT_STORAGE = Symbol('TENANT_PATIENT_STORAGE');

export interface TenantPatientList {
  items: PatientDirectoryRecord[];
  total: number;
}

/** Logical tenant-storage operations. Physical placement remains infrastructure-owned. */
export interface TenantPatientStorage {
  create(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    input: CreatePatientInput,
  ): Promise<PatientMutationResult>;
  findPotentialDuplicates(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    identity: PatientDuplicateIdentity,
    exceptPatientId?: string,
  ): Promise<boolean>;
  list(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    query: ListPatientsQuery,
  ): Promise<TenantPatientList>;
  findByPatientNumber(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    patientNumber: string,
  ): Promise<PatientRecord | null>;
  findById(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
  ): Promise<PatientRecord | null>;
  update(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    input: UpdatePatientInput,
  ): Promise<PatientMutationResult>;
  changeStatusIfCurrent(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    expectedStatus: PatientStatus,
    nextStatus: PatientStatus,
    changedAt: Date,
  ): Promise<PatientMutationResult>;
}

/**
 * Development-only, process-local adapter. Records are partitioned by the
 * trusted logical tenant and are intentionally not durable or production-ready.
 */
@Injectable()
export class InMemoryTenantPatientStorage implements TenantPatientStorage {
  private readonly patientsByTenant = new Map<string, Map<string, PatientRecord>>();

  async create(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    input: CreatePatientInput,
  ): Promise<PatientMutationResult> {
    this.assertScope(context, route);
    const patients = this.partition(context, true);
    if (!patients) throw new TenantStorageUnavailableError();
    if (this.hasPatientNumber(patients, input.patientNumber)) {
      return { kind: 'patient-number-conflict' };
    }

    const now = new Date();
    const record: PatientRecord = {
      id: randomUUID(),
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
    patients.set(record.id, record);
    return { kind: 'changed', record: cloneRecord(record) };
  }

  async findPotentialDuplicates(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    identity: PatientDuplicateIdentity,
    exceptPatientId?: string,
  ): Promise<boolean> {
    this.assertScope(context, route);
    const patients = this.partition(context, false);
    if (!patients) return false;

    for (const patient of patients.values()) {
      if (patient.id !== exceptPatientId && hasPotentialPatientDuplicate(identity, patient)) {
        return true;
      }
    }
    return false;
  }

  async list(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    query: ListPatientsQuery,
  ): Promise<TenantPatientList> {
    this.assertScope(context, route);
    const patients = this.partition(context, false);
    const filtered = [...(patients?.values() ?? [])]
      .filter((patient) => !query.status || patient.status === query.status)
      .filter((patient) => !query.patientNumber || patient.patientNumber === query.patientNumber)
      .filter((patient) => matchesSearch(patient, query.search))
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      );

    return {
      items: filtered.slice(query.offset, query.offset + query.limit).map(toPatientDirectoryRecord),
      total: filtered.length,
    };
  }

  async findByPatientNumber(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    patientNumber: string,
  ): Promise<PatientRecord | null> {
    this.assertScope(context, route);
    const record = [...(this.partition(context, false)?.values() ?? [])].find(
      (patient) => patient.patientNumber === patientNumber,
    );
    return record ? cloneRecord(record) : null;
  }

  async findById(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
  ): Promise<PatientRecord | null> {
    this.assertScope(context, route);
    const record = this.partition(context, false)?.get(id);
    return record ? cloneRecord(record) : null;
  }

  async update(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    input: UpdatePatientInput,
  ): Promise<PatientMutationResult> {
    this.assertScope(context, route);
    const patients = this.partition(context, false);
    const current = patients?.get(id);
    if (!patients || !current) return { kind: 'not-found' };
    if (
      input.patientNumber !== undefined &&
      input.patientNumber !== current.patientNumber &&
      this.hasPatientNumber(patients, input.patientNumber, id)
    ) {
      return { kind: 'patient-number-conflict' };
    }

    const definedFields = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as Partial<PatientRecord>;
    const updated: PatientRecord = {
      ...current,
      ...definedFields,
      dateOfBirth:
        input.dateOfBirth === undefined
          ? cloneDate(current.dateOfBirth)
          : cloneDate(input.dateOfBirth),
      updatedAt: new Date(),
    };
    patients.set(id, updated);
    return { kind: 'changed', record: cloneRecord(updated) };
  }

  async changeStatusIfCurrent(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    expectedStatus: PatientStatus,
    nextStatus: PatientStatus,
    changedAt: Date,
  ): Promise<PatientMutationResult> {
    this.assertScope(context, route);
    const patients = this.partition(context, false);
    const current = patients?.get(id);
    if (!patients || !current || current.status !== expectedStatus) {
      return { kind: 'not-changed' };
    }
    const updated = {
      ...current,
      status: nextStatus,
      updatedAt: new Date(changedAt),
    };
    patients.set(id, updated);
    return { kind: 'changed', record: cloneRecord(updated) };
  }

  private assertScope(context: TrustedTenantContext, route: TenantStorageRoute): void {
    if (!context || !isWellFormedTrustedTenantContext(context)) {
      throw new TenantContextInvalidError();
    }
    if (!route || !Array.isArray(route.placements) || route.placements.length === 0) {
      throw new TenantStorageNotConfiguredError();
    }
  }

  private partition(
    context: TrustedTenantContext,
    create: boolean,
  ): Map<string, PatientRecord> | undefined {
    const tenantKey = context.tenantId.toLowerCase();
    let patients = this.patientsByTenant.get(tenantKey);
    if (!patients && create) {
      patients = new Map<string, PatientRecord>();
      this.patientsByTenant.set(tenantKey, patients);
    }
    return patients;
  }

  private hasPatientNumber(
    patients: Map<string, PatientRecord>,
    patientNumber: string,
    exceptId?: string,
  ): boolean {
    for (const patient of patients.values()) {
      if (patient.id !== exceptId && patient.patientNumber === patientNumber) return true;
    }
    return false;
  }
}

/** Defense-in-depth adapter used outside development; it never falls back to Prisma. */
@Injectable()
export class UnconfiguredTenantPatientStorage implements TenantPatientStorage {
  async create(): Promise<PatientMutationResult> {
    throw new TenantStorageUnavailableError();
  }

  async findPotentialDuplicates(): Promise<boolean> {
    throw new TenantStorageUnavailableError();
  }

  async list(): Promise<TenantPatientList> {
    throw new TenantStorageUnavailableError();
  }

  async findByPatientNumber(): Promise<PatientRecord | null> {
    throw new TenantStorageUnavailableError();
  }

  async findById(): Promise<PatientRecord | null> {
    throw new TenantStorageUnavailableError();
  }

  async update(): Promise<PatientMutationResult> {
    throw new TenantStorageUnavailableError();
  }

  async changeStatusIfCurrent(): Promise<PatientMutationResult> {
    throw new TenantStorageUnavailableError();
  }
}

function cloneDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value.getTime());
}

function cloneRecord(record: PatientRecord): PatientRecord {
  return {
    ...record,
    dateOfBirth: cloneDate(record.dateOfBirth),
    createdAt: new Date(record.createdAt.getTime()),
    updatedAt: new Date(record.updatedAt.getTime()),
  };
}

function matchesSearch(patient: PatientRecord, search: string | undefined): boolean {
  if (!search) return true;
  const normalizedSearch = search.toLowerCase();
  return PATIENT_DIRECTORY_SEARCH_FIELDS.some((field) => {
    const value = patient[field];
    return typeof value === 'string' && value.toLowerCase().includes(normalizedSearch);
  });
}

function toPatientDirectoryRecord(patient: PatientRecord): PatientDirectoryRecord {
  return {
    id: patient.id,
    patientNumber: patient.patientNumber,
    firstName: patient.firstName,
    middleName: patient.middleName,
    lastName: patient.lastName,
    preferredName: patient.preferredName,
    phone: patient.phone,
    email: patient.email,
    status: patient.status,
  };
}
