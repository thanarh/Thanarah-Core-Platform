import { Inject, Injectable } from '@nestjs/common';
import type { TrustedTenantContext } from './tenant-context.contract';
import type { TenantStorageRoute } from './tenant-storage.contract';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import type {
  AppointmentListFilter,
  AppointmentListResult,
  AppointmentRecord,
} from './appointment.model';
import type { AppointmentMutationPatch, AppointmentStorage } from './tenant-appointment.storage';
import { APPOINTMENT_STORAGE } from './tenant-appointment.storage';
import type {
  AppointmentSchedulingLock,
  LockedAppointmentStorage,
} from './tenant-appointment.storage';
import { TenantStorageResolverService } from './tenant-storage.resolver';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from './tenant-storage.errors';
import { AppointmentScheduleConflictError } from './appointment.errors';

@Injectable()
export class TenantAppointmentRepository {
  constructor(
    @Inject(APPOINTMENT_STORAGE) private readonly storage: AppointmentStorage,
    private readonly resolver: TenantStorageResolverService,
  ) {}

  async create(
    context: TrustedTenantContext,
    record: AppointmentRecord,
  ): Promise<AppointmentRecord> {
    return this.withSchedulingLocks(
      context,
      [
        { resourceType: 'FACILITY', resourceId: record.facilityId },
        { resourceType: 'DOCTOR', resourceId: record.doctorId },
      ],
      async (storage) => {
        if (
          await storage.hasProviderOverlap({
            doctorId: record.doctorId,
            startsAt: record.startsAt,
            endsAt: record.endsAt,
          })
        ) {
          throw new AppointmentScheduleConflictError();
        }
        return storage.create(record);
      },
    );
  }

  async list(
    context: TrustedTenantContext,
    filter: AppointmentListFilter,
  ): Promise<AppointmentListResult> {
    return this.withRoute(context, (route) => this.storage.list(context, route, filter));
  }

  async findById(context: TrustedTenantContext, id: string): Promise<AppointmentRecord | null> {
    return this.withRoute(context, (route) => this.storage.findById(context, route, id));
  }

  async hasProviderOverlap(
    context: TrustedTenantContext,
    input: { doctorId: string; startsAt: Date; endsAt: Date; excludeId?: string },
  ): Promise<boolean> {
    return this.withRoute(context, (route) =>
      this.storage.hasProviderOverlap(context, route, input),
    );
  }

  async update(
    context: TrustedTenantContext,
    id: string,
    expectedVersion: number,
    patch: AppointmentMutationPatch,
  ): Promise<AppointmentRecord | null> {
    const current = await this.findById(context, id);
    if (!current) return null;
    const locks = this.appointmentLocks(current, {
      doctorId: patch.doctorId,
      facilityId: patch.facilityId,
    });
    return this.withSchedulingLocks(context, locks, async (storage) => {
      const latest = await storage.findById(id);
      if (!latest || latest.version !== expectedVersion) return null;
      const nextDoctorId = patch.doctorId ?? latest.doctorId;
      const nextStartsAt = patch.startsAt ?? latest.startsAt;
      const nextEndsAt = patch.endsAt ?? latest.endsAt;
      if (
        patch.status !== 'CANCELLED' &&
        (patch.doctorId !== undefined ||
          patch.startsAt !== undefined ||
          patch.endsAt !== undefined ||
          patch.status === 'SCHEDULED') &&
        (await storage.hasProviderOverlap({
          doctorId: nextDoctorId,
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          excludeId: id,
        }))
      ) {
        throw new AppointmentScheduleConflictError();
      }
      return storage.update(id, expectedVersion, patch);
    });
  }

  async withSchedulingLocks<T>(
    context: TrustedTenantContext,
    locks: AppointmentSchedulingLock[],
    operation: (storage: LockedAppointmentStorage) => Promise<T>,
  ): Promise<T> {
    if (!isWellFormedTrustedTenantContext(context)) throw new TenantContextInvalidError();
    const route = await this.resolver.resolve(context);
    return this.storage.withSchedulingLocks(context, route, locks, operation);
  }

  private async withRoute<T>(
    context: TrustedTenantContext,
    operation: (route: TenantStorageRoute) => Promise<T>,
  ): Promise<T> {
    if (!isWellFormedTrustedTenantContext(context)) throw new TenantContextInvalidError();
    const route = await this.resolver.resolve(context);
    try {
      return await operation(route);
    } catch (error) {
      if (
        error instanceof TenantStorageUnavailableError ||
        error instanceof TenantStorageNotConfiguredError ||
        error instanceof TenantContextInvalidError
      ) {
        throw error;
      }
      throw new TenantStorageUnavailableError();
    }
  }

  private appointmentLocks(
    current: AppointmentRecord,
    next: { doctorId?: string; facilityId?: string },
  ): AppointmentSchedulingLock[] {
    return [
      { resourceType: 'DOCTOR', resourceId: current.doctorId },
      { resourceType: 'FACILITY', resourceId: current.facilityId },
      ...(next.doctorId && next.doctorId !== current.doctorId
        ? [{ resourceType: 'DOCTOR' as const, resourceId: next.doctorId }]
        : []),
      ...(next.facilityId && next.facilityId !== current.facilityId
        ? [{ resourceType: 'FACILITY' as const, resourceId: next.facilityId }]
        : []),
    ];
  }
}
