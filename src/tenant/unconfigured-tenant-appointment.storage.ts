import { Injectable } from '@nestjs/common';
import type { TrustedTenantContext } from './tenant-context.contract';
import type { TenantStorageRoute } from './tenant-storage.contract';
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
import { TenantStorageNotConfiguredError } from './tenant-storage.errors';

@Injectable()
export class UnconfiguredTenantAppointmentStorage implements AppointmentStorage {
  async create(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _record: AppointmentRecord,
  ): Promise<AppointmentRecord> {
    throw new TenantStorageNotConfiguredError();
  }

  async list(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _filter: AppointmentListFilter,
  ): Promise<AppointmentListResult> {
    throw new TenantStorageNotConfiguredError();
  }

  async findById(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _id: string,
  ): Promise<AppointmentRecord | null> {
    throw new TenantStorageNotConfiguredError();
  }

  async hasProviderOverlap(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _input: { doctorId: string; startsAt: Date; endsAt: Date; excludeId?: string },
  ): Promise<boolean> {
    throw new TenantStorageNotConfiguredError();
  }

  async update(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _id: string,
    _expectedVersion: number,
    _patch: AppointmentMutationPatch,
  ): Promise<AppointmentRecord | null> {
    throw new TenantStorageNotConfiguredError();
  }

  async withSchedulingLocks<T>(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _locks: AppointmentSchedulingLock[],
    _operation: (storage: LockedAppointmentStorage) => Promise<T>,
  ): Promise<T> {
    throw new TenantStorageNotConfiguredError();
  }
}
