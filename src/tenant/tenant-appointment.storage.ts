import type { TrustedTenantContext } from './tenant-context.contract';
import type { TenantStorageRoute } from './tenant-storage.contract';
import type {
  AppointmentListFilter,
  AppointmentListResult,
  AppointmentRecord,
} from './appointment.model';

export interface AppointmentStorage {
  create(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    record: AppointmentRecord,
  ): Promise<AppointmentRecord>;
  list(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    filter: AppointmentListFilter,
  ): Promise<AppointmentListResult>;
  findById(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
  ): Promise<AppointmentRecord | null>;
  hasProviderOverlap(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    input: {
      doctorId: string;
      startsAt: Date;
      endsAt: Date;
      excludeId?: string;
    },
  ): Promise<boolean>;
  update(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    expectedVersion: number,
    patch: AppointmentMutationPatch,
  ): Promise<AppointmentRecord | null>;
  withSchedulingLocks<T>(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    locks: AppointmentSchedulingLock[],
    operation: (storage: LockedAppointmentStorage) => Promise<T>,
  ): Promise<T>;
}

export interface AppointmentSchedulingLock {
  resourceType: 'DOCTOR' | 'FACILITY' | 'IDEMPOTENCY';
  resourceId: string;
}

export interface LockedAppointmentStorage {
  create(record: AppointmentRecord): Promise<AppointmentRecord>;
  findById(id: string): Promise<AppointmentRecord | null>;
  hasProviderOverlap(input: {
    doctorId: string;
    startsAt: Date;
    endsAt: Date;
    excludeId?: string;
  }): Promise<boolean>;
  update(
    id: string,
    expectedVersion: number,
    patch: AppointmentMutationPatch,
  ): Promise<AppointmentRecord | null>;
}

export type AppointmentMutationPatch = Partial<
  Pick<
    AppointmentRecord,
    | 'patientId'
    | 'doctorId'
    | 'facilityId'
    | 'branchId'
    | 'serviceId'
    | 'startsAt'
    | 'endsAt'
    | 'status'
    | 'reason'
    | 'updatedAt'
    | 'updatedBy'
    | 'cancelledAt'
    | 'cancelledBy'
  >
>;

export const APPOINTMENT_STORAGE = Symbol('APPOINTMENT_STORAGE');
export const APPOINTMENT_REPOSITORY = Symbol('APPOINTMENT_REPOSITORY');
