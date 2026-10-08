import { Inject, Injectable } from '@nestjs/common';
import type { CreatePatientInput, ListPatientsQuery, UpdatePatientInput } from './patient.dto';
import type {
  PatientDirectoryRecord,
  PatientDuplicateIdentity,
  PatientMutationResult,
  PatientRecord,
  PatientStatus,
} from './patient.model';
import { TenantContextInvalidError, TenantContextRequiredError } from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from './tenant-storage.errors';
import { TENANT_PATIENT_STORAGE } from './tenant-patient.storage';
import type { TenantPatientList, TenantPatientStorage } from './tenant-patient.storage';
import { TENANT_STORAGE_RESOLVER } from './tenant-storage.resolver';
import type { TenantStorageResolver, TenantStorageRoute } from './tenant-storage.contract';

export const PATIENT_REPOSITORY = Symbol('PATIENT_REPOSITORY');

export interface PatientRepository {
  create(context: TrustedTenantContext, input: CreatePatientInput): Promise<PatientMutationResult>;
  findPotentialDuplicates(
    context: TrustedTenantContext,
    identity: PatientDuplicateIdentity,
    exceptPatientId?: string,
  ): Promise<boolean>;
  list(
    context: TrustedTenantContext,
    query: ListPatientsQuery,
  ): Promise<{ items: PatientDirectoryRecord[]; total: number }>;
  findByPatientNumber(
    context: TrustedTenantContext,
    patientNumber: string,
  ): Promise<PatientRecord | null>;
  findByIdForTenant(context: TrustedTenantContext, id: string): Promise<PatientRecord | null>;
  update(
    context: TrustedTenantContext,
    id: string,
    input: UpdatePatientInput,
  ): Promise<PatientMutationResult>;
  changeStatusIfCurrent(
    context: TrustedTenantContext,
    id: string,
    expectedStatus: PatientStatus,
    nextStatus: PatientStatus,
    changedAt: Date,
  ): Promise<PatientMutationResult>;
}

/** Patient persistence is resolved from trusted scope before every operation. */
@Injectable()
export class TenantStoragePatientRepository implements PatientRepository {
  constructor(
    @Inject(TENANT_STORAGE_RESOLVER)
    private readonly resolver: TenantStorageResolver,
    @Inject(TENANT_PATIENT_STORAGE)
    private readonly storage: TenantPatientStorage,
  ) {}

  create(context: TrustedTenantContext, input: CreatePatientInput): Promise<PatientMutationResult> {
    return this.withRoute(context, (route) => this.storage.create(context, route, input));
  }

  findPotentialDuplicates(
    context: TrustedTenantContext,
    identity: PatientDuplicateIdentity,
    exceptPatientId?: string,
  ): Promise<boolean> {
    return this.withRoute(context, (route) =>
      this.storage.findPotentialDuplicates(context, route, identity, exceptPatientId),
    );
  }

  list(context: TrustedTenantContext, query: ListPatientsQuery): Promise<TenantPatientList> {
    return this.withRoute(context, (route) => this.storage.list(context, route, query));
  }

  findByPatientNumber(
    context: TrustedTenantContext,
    patientNumber: string,
  ): Promise<PatientRecord | null> {
    return this.withRoute(context, (route) =>
      this.storage.findByPatientNumber(context, route, patientNumber),
    );
  }

  findByIdForTenant(context: TrustedTenantContext, id: string): Promise<PatientRecord | null> {
    return this.withRoute(context, (route) => this.storage.findById(context, route, id));
  }

  update(
    context: TrustedTenantContext,
    id: string,
    input: UpdatePatientInput,
  ): Promise<PatientMutationResult> {
    return this.withRoute(context, (route) => this.storage.update(context, route, id, input));
  }

  changeStatusIfCurrent(
    context: TrustedTenantContext,
    id: string,
    expectedStatus: PatientStatus,
    nextStatus: PatientStatus,
    changedAt: Date,
  ): Promise<PatientMutationResult> {
    return this.withRoute(context, (route) =>
      this.storage.changeStatusIfCurrent(context, route, id, expectedStatus, nextStatus, changedAt),
    );
  }

  private async withRoute<T>(
    context: TrustedTenantContext,
    operation: (route: TenantStorageRoute) => Promise<T>,
  ): Promise<T> {
    try {
      const route = await this.resolver.resolve(context);
      return await operation(route);
    } catch (error) {
      if (
        error instanceof TenantContextRequiredError ||
        error instanceof TenantContextInvalidError ||
        error instanceof TenantStorageNotConfiguredError ||
        error instanceof TenantStorageUnavailableError
      ) {
        throw error;
      }
      throw new TenantStorageUnavailableError();
    }
  }
}
