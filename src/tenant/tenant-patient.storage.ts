import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CreatePatientInput, ListPatientsQuery, UpdatePatientInput } from './patient.dto';
import {
  PATIENT_DIRECTORY_SEARCH_FIELDS,
  type PatientDirectoryRecord,
  type PatientDuplicateIdentity,
  type PatientLifecycleMutationResult,
  type PatientMutationResult,
  type PatientPortalClaim,
  type PatientRecord,
  type PatientStatus,
} from './patient.model';
import {
  hasPatientDuplicateIdentityChange,
  hasPotentialPatientDuplicate,
} from './patient-duplicate';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import type { TrustedPatientPortalContext } from './tenant-context.contract';
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
  ): Promise<PatientLifecycleMutationResult>;
  findPortalCandidates(
    context: TrustedPatientPortalContext,
    route: TenantStorageRoute,
    email: string,
  ): Promise<PatientRecord[]>;
  startPortalClaim(
    context: TrustedPatientPortalContext,
    route: TenantStorageRoute,
    patientId: string,
    email: string,
    claim: PatientPortalClaim,
  ): Promise<PatientPortalClaim | 'already-linked' | 'conflict' | 'not-found' | 'rate-limited'>;
  verifyPortalClaim(
    context: TrustedPatientPortalContext,
    route: TenantStorageRoute,
    patientId: string,
    operationId: string,
    codeDigest: string,
    now: Date,
  ): Promise<'linked' | 'already-linked' | 'invalid' | 'expired' | 'locked' | 'not-found'>;
  findPatientByPortalUser(
    context: TrustedPatientPortalContext,
    route: TenantStorageRoute,
  ): Promise<PatientRecord | null>;
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
    const identity: PatientDuplicateIdentity = {
      firstName: input.firstName,
      middleName: input.middleName ?? null,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
    };
    if ([...patients.values()].some((patient) => hasPotentialPatientDuplicate(identity, patient))) {
      return { kind: 'possible-duplicate' };
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
      portalAccountUserId: null,
      portalLinkedAt: null,
      portalClaim: null,
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
      ...(input.email !== undefined || input.phone !== undefined
        ? {
            portalAccountUserId: null,
            portalLinkedAt: null,
            portalClaim: null,
          }
        : {}),
      dateOfBirth:
        input.dateOfBirth === undefined
          ? cloneDate(current.dateOfBirth)
          : cloneDate(input.dateOfBirth),
      updatedAt: new Date(),
    };
    if (
      hasPatientDuplicateIdentityChange(input) &&
      [...patients.values()].some(
        (patient) => patient.id !== id && hasPotentialPatientDuplicate(updated, patient),
      )
    ) {
      return { kind: 'possible-duplicate' };
    }
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
  ): Promise<PatientLifecycleMutationResult> {
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

  async findPortalCandidates(
    context: TrustedPatientPortalContext,
    route: TenantStorageRoute,
    email: string,
  ): Promise<PatientRecord[]> {
    this.assertPortalScope(context, route);
    return [...(this.patientsByTenant.get(context.tenantId.toLowerCase())?.values() ?? [])]
      .filter((patient) => patient.email === email)
      .slice(0, 2)
      .map(cloneRecord);
  }

  async startPortalClaim(
    context: TrustedPatientPortalContext,
    route: TenantStorageRoute,
    patientId: string,
    email: string,
    claim: PatientPortalClaim,
  ): Promise<PatientPortalClaim | 'already-linked' | 'conflict' | 'not-found' | 'rate-limited'> {
    this.assertPortalScope(context, route);
    const patients = this.patientsByTenant.get(context.tenantId.toLowerCase());
    const patient = patients?.get(patientId);
    if (!patients || !patient || patient.email !== email || patient.status !== 'ACTIVE') {
      return 'not-found';
    }
    if (patient.portalAccountUserId === context.platformUserId) return 'already-linked';
    if (patient.portalAccountUserId) return 'conflict';
    if (
      [...patients.values()].some(
        (candidate) =>
          candidate.id !== patientId && candidate.portalAccountUserId === context.platformUserId,
      )
    ) {
      return 'conflict';
    }
    if (
      patient.portalClaim &&
      patient.portalClaim.expiresAt > claim.createdAt &&
      patient.portalClaim.accountUserId !== context.platformUserId
    ) {
      return 'conflict';
    }
    if (
      patient.portalClaim?.expiresAt &&
      patient.portalClaim.expiresAt > claim.createdAt &&
      patient.portalClaim.accountUserId === context.platformUserId &&
      patient.portalClaim.operationId === claim.operationId
    ) {
      return structuredClone(patient.portalClaim);
    }
    if (
      patient.portalClaim?.accountUserId === context.platformUserId &&
      patient.portalClaim.createdAt.getTime() > claim.createdAt.getTime() - 60_000 &&
      patient.portalClaim.expiresAt > claim.createdAt
    ) {
      return 'rate-limited';
    }
    patients.set(patientId, { ...patient, portalClaim: structuredClone(claim) });
    return structuredClone(claim);
  }

  async verifyPortalClaim(
    context: TrustedPatientPortalContext,
    route: TenantStorageRoute,
    patientId: string,
    operationId: string,
    codeDigest: string,
    now: Date,
  ): Promise<'linked' | 'already-linked' | 'invalid' | 'expired' | 'locked' | 'not-found'> {
    this.assertPortalScope(context, route);
    const patients = this.patientsByTenant.get(context.tenantId.toLowerCase());
    const patient = patients?.get(patientId);
    if (!patients || !patient || patient.status !== 'ACTIVE') return 'not-found';
    if (patient.portalAccountUserId === context.platformUserId) return 'already-linked';
    if (patient.portalAccountUserId) return 'not-found';
    const claim = patient.portalClaim;
    if (
      !claim ||
      claim.accountUserId !== context.platformUserId ||
      claim.operationId !== operationId
    ) {
      return 'not-found';
    }
    if (claim.expiresAt <= now) return 'expired';
    if (claim.attempts >= 5) return 'locked';
    if (claim.codeDigest !== codeDigest) {
      patients.set(patientId, {
        ...patient,
        portalClaim: { ...claim, attempts: claim.attempts + 1 },
      });
      return claim.attempts + 1 >= 5 ? 'locked' : 'invalid';
    }
    if (
      [...patients.values()].some(
        (candidate) =>
          candidate.id !== patientId && candidate.portalAccountUserId === context.platformUserId,
      )
    ) {
      return 'not-found';
    }
    patients.set(patientId, {
      ...patient,
      portalAccountUserId: context.platformUserId,
      portalLinkedAt: new Date(now),
      portalClaim: null,
    });
    return 'linked';
  }

  async findPatientByPortalUser(
    context: TrustedPatientPortalContext,
    route: TenantStorageRoute,
  ): Promise<PatientRecord | null> {
    this.assertPortalScope(context, route);
    const patient = [
      ...(this.patientsByTenant.get(context.tenantId.toLowerCase())?.values() ?? []),
    ].find(
      (candidate) =>
        candidate.portalAccountUserId === context.platformUserId && candidate.status === 'ACTIVE',
    );
    return patient ? cloneRecord(patient) : null;
  }

  private assertScope(context: TrustedTenantContext, route: TenantStorageRoute): void {
    if (!context || !isWellFormedTrustedTenantContext(context)) {
      throw new TenantContextInvalidError();
    }
    if (!route || !Array.isArray(route.placements) || route.placements.length === 0) {
      throw new TenantStorageNotConfiguredError();
    }
  }

  private assertPortalScope(context: TrustedPatientPortalContext, route: TenantStorageRoute): void {
    if (
      !context ||
      !/^[0-9a-f-]{36}$/iu.test(context.tenantId) ||
      !/^[0-9a-f-]{36}$/iu.test(context.platformUserId)
    ) {
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

  async changeStatusIfCurrent(): Promise<PatientLifecycleMutationResult> {
    throw new TenantStorageUnavailableError();
  }

  async findPortalCandidates(): Promise<PatientRecord[]> {
    throw new TenantStorageUnavailableError();
  }

  async startPortalClaim(): Promise<
    PatientPortalClaim | 'already-linked' | 'conflict' | 'not-found' | 'rate-limited'
  > {
    throw new TenantStorageUnavailableError();
  }

  async verifyPortalClaim(): Promise<
    'linked' | 'already-linked' | 'invalid' | 'expired' | 'locked' | 'not-found'
  > {
    throw new TenantStorageUnavailableError();
  }

  async findPatientByPortalUser(): Promise<PatientRecord | null> {
    throw new TenantStorageUnavailableError();
  }
}

function cloneDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value.getTime());
}

function cloneRecord(record: PatientRecord): PatientRecord {
  return {
    ...record,
    portalLinkedAt: cloneDate(record.portalLinkedAt ?? null),
    portalClaim: record.portalClaim
      ? {
          ...record.portalClaim,
          createdAt: new Date(record.portalClaim.createdAt),
          expiresAt: new Date(record.portalClaim.expiresAt),
          consentAcceptedAt: new Date(record.portalClaim.consentAcceptedAt),
        }
      : null,
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
