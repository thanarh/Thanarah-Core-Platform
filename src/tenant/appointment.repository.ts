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
import { TenantStorageResolverService } from './tenant-storage.resolver';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from './tenant-storage.errors';

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
    return this.withRoute(context, (route) => this.storage.create(context, route, record));
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
    return this.withRoute(context, (route) =>
      this.storage.update(context, route, id, expectedVersion, patch),
    );
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
}
