import { Inject, Injectable } from '@nestjs/common';
import type { TrustedTenantContext } from './tenant-context.contract';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from './tenant-storage.errors';
import type { TenantStorageResolver, TenantStorageRoute } from './tenant-storage.contract';
import { TENANT_STORAGE_RESOLVER } from './tenant-storage.resolver';
import type {
  EncounterHistoryEvent,
  EncounterListFilter,
  EncounterListResult,
  EncounterRecord,
  EncounterStatus,
} from './encounter.model';
import { EncounterAppointmentConflictError } from './encounter.errors';
import type { EncounterMutationPatch, EncounterStorage } from './tenant-encounter.storage';
import { ENCOUNTER_STORAGE } from './tenant-encounter.storage';

export interface EncounterRepository {
  create(context: TrustedTenantContext, record: EncounterRecord): Promise<EncounterRecord>;
  list(context: TrustedTenantContext, filter: EncounterListFilter): Promise<EncounterListResult>;
  findById(context: TrustedTenantContext, id: string): Promise<EncounterRecord | null>;
  findActiveByAppointment(
    context: TrustedTenantContext,
    appointmentId: string,
  ): Promise<EncounterRecord | null>;
  update(
    context: TrustedTenantContext,
    id: string,
    expectedVersion: number,
    expectedStatus: EncounterStatus,
    patch: EncounterMutationPatch,
    event: EncounterHistoryEvent,
  ): Promise<EncounterRecord | null>;
  history(context: TrustedTenantContext, id: string): Promise<EncounterHistoryEvent[] | null>;
}

@Injectable()
export class TenantStorageEncounterRepository implements EncounterRepository {
  constructor(
    @Inject(TENANT_STORAGE_RESOLVER)
    private readonly resolver: TenantStorageResolver,
    @Inject(ENCOUNTER_STORAGE)
    private readonly storage: EncounterStorage,
  ) {}

  create(context: TrustedTenantContext, record: EncounterRecord): Promise<EncounterRecord> {
    return this.withRoute(context, (route) => this.storage.create(context, route, record));
  }

  list(context: TrustedTenantContext, filter: EncounterListFilter): Promise<EncounterListResult> {
    return this.withRoute(context, (route) => this.storage.list(context, route, filter));
  }

  findById(context: TrustedTenantContext, id: string): Promise<EncounterRecord | null> {
    return this.withRoute(context, (route) => this.storage.findById(context, route, id));
  }

  findActiveByAppointment(
    context: TrustedTenantContext,
    appointmentId: string,
  ): Promise<EncounterRecord | null> {
    return this.withRoute(context, (route) =>
      this.storage.findActiveByAppointment(context, route, appointmentId),
    );
  }

  update(
    context: TrustedTenantContext,
    id: string,
    expectedVersion: number,
    expectedStatus: EncounterStatus,
    patch: EncounterMutationPatch,
    event: EncounterHistoryEvent,
  ): Promise<EncounterRecord | null> {
    return this.withRoute(context, (route) =>
      this.storage.update(context, route, id, expectedVersion, expectedStatus, patch, event),
    );
  }

  history(context: TrustedTenantContext, id: string): Promise<EncounterHistoryEvent[] | null> {
    return this.withRoute(context, (route) => this.storage.history(context, route, id));
  }

  private async withRoute<T>(
    context: TrustedTenantContext,
    operation: (route: TenantStorageRoute) => Promise<T>,
  ): Promise<T> {
    if (!context) throw new TenantContextRequiredError();
    if (!isWellFormedTrustedTenantContext(context)) throw new TenantContextInvalidError();
    try {
      const route = await this.resolver.resolve(context);
      return await operation(route);
    } catch (error) {
      if (
        error instanceof TenantContextRequiredError ||
        error instanceof TenantContextInvalidError ||
        error instanceof TenantStorageNotConfiguredError ||
        error instanceof TenantStorageUnavailableError ||
        error instanceof EncounterAppointmentConflictError
      ) {
        throw error;
      }
      throw new TenantStorageUnavailableError();
    }
  }
}
