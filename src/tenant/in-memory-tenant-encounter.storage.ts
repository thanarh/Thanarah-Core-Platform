import { Injectable } from '@nestjs/common';
import type {
  EncounterHistoryEvent,
  EncounterListFilter,
  EncounterListResult,
  EncounterRecord,
} from './encounter.model';
import { EncounterAppointmentConflictError } from './encounter.errors';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import type { TenantStorageRoute } from './tenant-storage.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from './tenant-storage.errors';
import type { EncounterMutationPatch, EncounterStorage } from './tenant-encounter.storage';

@Injectable()
export class InMemoryTenantEncounterStorage implements EncounterStorage {
  private readonly recordsByTenant = new Map<string, Map<string, EncounterRecord>>();

  async create(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    record: EncounterRecord,
  ): Promise<EncounterRecord> {
    const records = this.records(context, route);
    if (
      record.appointmentId &&
      [...records.values()].some(
        (item) => item.appointmentId === record.appointmentId && item.status !== 'CANCELLED',
      )
    ) {
      throw new EncounterAppointmentConflictError();
    }
    records.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async list(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    filter: EncounterListFilter,
  ): Promise<EncounterListResult> {
    const matched = [...this.records(context, route).values()]
      .filter((record) => matchesFilter(record, filter))
      .sort(
        (left, right) =>
          right.encounterAt.getTime() - left.encounterAt.getTime() ||
          right.id.localeCompare(left.id),
      );
    const items = matched
      .slice(filter.offset, filter.offset + filter.limit)
      .map((record) => ({ ...structuredClone(record), history: [] }));
    return {
      items,
      total: matched.length,
      limit: filter.limit,
      offset: filter.offset,
      hasNext: filter.offset + items.length < matched.length,
    };
  }

  async findById(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
  ): Promise<EncounterRecord | null> {
    const record = this.records(context, route).get(id);
    return record ? structuredClone(record) : null;
  }

  async findActiveByAppointment(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    appointmentId: string,
  ): Promise<EncounterRecord | null> {
    const record = [...this.records(context, route).values()].find(
      (item) => item.appointmentId === appointmentId && item.status !== 'CANCELLED',
    );
    return record ? structuredClone(record) : null;
  }

  async update(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
    expectedVersion: number,
    expectedStatus: EncounterRecord['status'],
    patch: EncounterMutationPatch,
    event: EncounterHistoryEvent,
  ): Promise<EncounterRecord | null> {
    const records = this.records(context, route);
    const current = records.get(id);
    if (!current || current.version !== expectedVersion || current.status !== expectedStatus) {
      return null;
    }
    const updated: EncounterRecord = {
      ...current,
      ...patch,
      version: current.version + 1,
      history: [...current.history, structuredClone(event)],
    };
    records.set(id, updated);
    return structuredClone(updated);
  }

  async history(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    id: string,
  ): Promise<EncounterHistoryEvent[] | null> {
    const record = this.records(context, route).get(id);
    return record ? structuredClone(record.history) : null;
  }

  private records(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Map<string, EncounterRecord> {
    if (!context || !isWellFormedTrustedTenantContext(context)) {
      throw new TenantContextInvalidError();
    }
    if (!route || !Array.isArray(route.placements) || route.placements.length === 0) {
      throw new TenantStorageNotConfiguredError();
    }
    if (route.placements.length !== 1) throw new TenantStorageUnavailableError();
    const key = `${context.tenantId.toLowerCase()}:${route.placements[0].placementId}`;
    let records = this.recordsByTenant.get(key);
    if (!records) {
      records = new Map();
      this.recordsByTenant.set(key, records);
    }
    return records;
  }
}

function matchesFilter(record: EncounterRecord, filter: EncounterListFilter): boolean {
  const scope = filter.accessScope;
  const inScope =
    scope.unrestricted ||
    scope.facilityIds.includes(record.facilityId) ||
    (record.branchId !== null && scope.branchIds.includes(record.branchId));
  if (!inScope) return false;
  if (
    filter.search &&
    ![record.id, record.appointmentId, record.patientId, record.doctorId].includes(filter.search)
  ) {
    return false;
  }
  if (filter.appointmentId && record.appointmentId !== filter.appointmentId) return false;
  if (filter.patientId && record.patientId !== filter.patientId) return false;
  if (filter.doctorId && record.doctorId !== filter.doctorId) return false;
  if (filter.facilityId && record.facilityId !== filter.facilityId) return false;
  if (filter.branchId && record.branchId !== filter.branchId) return false;
  if (filter.status && record.status !== filter.status) return false;
  if (filter.from && record.encounterAt < filter.from) return false;
  if (filter.to && record.encounterAt >= filter.to) return false;
  return true;
}
