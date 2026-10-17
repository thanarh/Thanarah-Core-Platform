import type { TrustedTenantContext } from './tenant-context.contract';
import type { TenantStorageRoute } from './tenant-storage.contract';
import type {
  EncounterHistoryEvent,
  EncounterListFilter,
  EncounterListResult,
  EncounterRecord,
  EncounterStatus,
} from './encounter.model';

export interface EncounterMutationPatch {
  clinical?: EncounterRecord['clinical'];
  status?: EncounterStatus;
  updatedAt: Date;
  updatedBy: string;
  completedAt?: Date | null;
  completedBy?: string | null;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
}

export interface EncounterStorage {
  create(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    record: EncounterRecord,
  ): Promise<EncounterRecord>;
  list(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    filter: EncounterListFilter,
  ): Promise<EncounterListResult>;
  findById(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
  ): Promise<EncounterRecord | null>;
  findActiveByAppointment(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    appointmentId: string,
  ): Promise<EncounterRecord | null>;
  update(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    expectedVersion: number,
    expectedStatus: EncounterStatus,
    patch: EncounterMutationPatch,
    event: EncounterHistoryEvent,
  ): Promise<EncounterRecord | null>;
  history(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
  ): Promise<EncounterHistoryEvent[] | null>;
}

export const ENCOUNTER_STORAGE = Symbol('ENCOUNTER_STORAGE');
export const ENCOUNTER_REPOSITORY = Symbol('ENCOUNTER_REPOSITORY');
