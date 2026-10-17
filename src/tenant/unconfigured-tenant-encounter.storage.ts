import { Injectable } from '@nestjs/common';
import type { TrustedTenantContext } from './tenant-context.contract';
import type { TenantStorageRoute } from './tenant-storage.contract';
import type {
  EncounterHistoryEvent,
  EncounterListFilter,
  EncounterListResult,
  EncounterRecord,
  EncounterStatus,
} from './encounter.model';
import type { EncounterMutationPatch, EncounterStorage } from './tenant-encounter.storage';
import { TenantStorageNotConfiguredError } from './tenant-storage.errors';

@Injectable()
export class UnconfiguredTenantEncounterStorage implements EncounterStorage {
  async create(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _record: EncounterRecord,
  ): Promise<EncounterRecord> {
    throw new TenantStorageNotConfiguredError();
  }

  async list(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _filter: EncounterListFilter,
  ): Promise<EncounterListResult> {
    throw new TenantStorageNotConfiguredError();
  }

  async findById(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _id: string,
  ): Promise<EncounterRecord | null> {
    throw new TenantStorageNotConfiguredError();
  }

  async findActiveByAppointment(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _appointmentId: string,
  ): Promise<EncounterRecord | null> {
    throw new TenantStorageNotConfiguredError();
  }

  async update(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _id: string,
    _expectedVersion: number,
    _expectedStatus: EncounterStatus,
    _patch: EncounterMutationPatch,
    _event: EncounterHistoryEvent,
  ): Promise<EncounterRecord | null> {
    throw new TenantStorageNotConfiguredError();
  }

  async history(
    _context: TrustedTenantContext,
    _route: TenantStorageRoute,
    _id: string,
  ): Promise<EncounterHistoryEvent[] | null> {
    throw new TenantStorageNotConfiguredError();
  }
}
