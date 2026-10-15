import { Injectable } from '@nestjs/common';
import type { TrustedTenantContext } from './tenant-context.contract';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
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

@Injectable()
export class InMemoryTenantAppointmentStorage implements AppointmentStorage {
  private readonly records = new Map<string, Map<string, AppointmentRecord>>();
  private readonly lockQueues = new Map<string, Promise<void>>();

  async create(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    record: AppointmentRecord,
  ): Promise<AppointmentRecord> {
    this.assertScope(context, route);
    const tenantRecords = this.tenantRecords(context.tenantId);
    if (tenantRecords.has(record.id)) throw new Error('Appointment identifier collision');
    tenantRecords.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  async list(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    filter: AppointmentListFilter,
  ): Promise<AppointmentListResult> {
    this.assertScope(context, route);
    const filtered = [...this.tenantRecords(context.tenantId).values()]
      .filter((record) => matchesFilter(record, filter))
      .sort(
        (left, right) =>
          left.startsAt.getTime() - right.startsAt.getTime() || left.id.localeCompare(right.id),
      );
    const total = filtered.length;
    const items = filtered.slice(filter.offset, filter.offset + filter.limit).map(cloneRecord);
    return {
      items,
      limit: filter.limit,
      offset: filter.offset,
      total,
      hasNext: filter.offset + items.length < total,
    };
  }

  async findById(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
  ): Promise<AppointmentRecord | null> {
    this.assertScope(context, route);
    const record = this.tenantRecords(context.tenantId).get(id);
    return record ? cloneRecord(record) : null;
  }

  async hasProviderOverlap(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    input: { doctorId: string; startsAt: Date; endsAt: Date; excludeId?: string },
  ): Promise<boolean> {
    this.assertScope(context, route);
    return [...this.tenantRecords(context.tenantId).values()].some(
      (record) =>
        record.id !== input.excludeId &&
        record.doctorId === input.doctorId &&
        record.status === 'SCHEDULED' &&
        record.startsAt < input.endsAt &&
        record.endsAt > input.startsAt,
    );
  }

  async update(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    expectedVersion: number,
    patch: AppointmentMutationPatch,
  ): Promise<AppointmentRecord | null> {
    this.assertScope(context, route);
    const tenantRecords = this.tenantRecords(context.tenantId);
    const current = tenantRecords.get(id);
    if (!current || current.version !== expectedVersion) return null;
    const updated = cloneRecord({
      ...current,
      ...patch,
      version: current.version + 1,
    });
    tenantRecords.set(id, updated);
    return cloneRecord(updated);
  }

  async withSchedulingLocks<T>(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    locks: AppointmentSchedulingLock[],
    operation: (storage: LockedAppointmentStorage) => Promise<T>,
  ): Promise<T> {
    this.assertScope(context, route);
    const keys = normalizeLockKeys(context.tenantId, locks);
    const releases: Array<() => void> = [];
    try {
      for (const key of keys) releases.push(await this.acquireLock(key));
      return await operation({
        create: (record) => this.create(context, route, record),
        findById: (id) => this.findById(context, route, id),
        hasProviderOverlap: (input) => this.hasProviderOverlap(context, route, input),
        update: (id, version, patch) => this.update(context, route, id, version, patch),
      });
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  private tenantRecords(tenantId: string): Map<string, AppointmentRecord> {
    let records = this.records.get(tenantId);
    if (!records) {
      records = new Map<string, AppointmentRecord>();
      this.records.set(tenantId, records);
    }
    return records;
  }

  private assertScope(context: TrustedTenantContext, route: TenantStorageRoute): void {
    if (!isWellFormedTrustedTenantContext(context)) throw new TenantContextInvalidError();
    if (!route || route.placements.length === 0) throw new TenantContextInvalidError();
  }

  private async acquireLock(key: string): Promise<() => void> {
    const previous = this.lockQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.lockQueues.set(key, current);
    await previous;
    return () => {
      release();
      if (this.lockQueues.get(key) === current) this.lockQueues.delete(key);
    };
  }
}

function normalizeLockKeys(tenantId: string, locks: AppointmentSchedulingLock[]): string[] {
  return [
    ...new Set(
      locks.map(({ resourceType, resourceId }) => {
        if (
          (resourceType !== 'DOCTOR' &&
            resourceType !== 'FACILITY' &&
            resourceType !== 'IDEMPOTENCY') ||
          typeof resourceId !== 'string' ||
          resourceId.length === 0
        ) {
          throw new TenantContextInvalidError();
        }
        return `${tenantId}:${resourceType}:${resourceId}`;
      }),
    ),
  ].sort();
}

function matchesFilter(record: AppointmentRecord, filter: AppointmentListFilter): boolean {
  if (filter.status && record.status !== filter.status) return false;
  if (filter.doctorId && record.doctorId !== filter.doctorId) return false;
  if (filter.facilityId && record.facilityId !== filter.facilityId) return false;
  if (filter.branchId && record.branchId !== filter.branchId) return false;
  if (filter.patientId && record.patientId !== filter.patientId) return false;
  if (filter.from && record.endsAt <= filter.from) return false;
  if (filter.to && record.startsAt >= filter.to) return false;
  if (
    !filter.accessScope.unrestricted &&
    !filter.accessScope.facilityIds.includes(record.facilityId) &&
    !(record.branchId && filter.accessScope.branchIds.includes(record.branchId))
  ) {
    return false;
  }
  return true;
}

function cloneRecord(record: AppointmentRecord): AppointmentRecord {
  return {
    ...record,
    startsAt: new Date(record.startsAt),
    endsAt: new Date(record.endsAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    cancelledAt: record.cancelledAt ? new Date(record.cancelledAt) : null,
  };
}
