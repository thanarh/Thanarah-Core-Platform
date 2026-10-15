import { describe, expect, it } from 'vitest';
import type { AppointmentRecord } from '../src/tenant/appointment.model';
import { InMemoryTenantAppointmentStorage } from '../src/tenant/in-memory-tenant-appointment.storage';
import { AppointmentScheduleConflictError } from '../src/tenant/appointment.errors';
import { UnconfiguredTenantAppointmentStorage } from '../src/tenant/unconfigured-tenant-appointment.storage';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';
import type { TenantStorageRoute } from '../src/tenant/tenant-storage.contract';
import { TenantStorageNotConfiguredError } from '../src/tenant/tenant-storage.errors';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '99999999-9999-4999-8999-999999999999';
const placement = '22222222-2222-4222-8222-222222222222';
const appointmentId = '33333333-3333-4333-8333-333333333333';
const doctorId = '44444444-4444-4444-8444-444444444444';
const facilityId = '55555555-5555-4555-8555-555555555555';
const branchId = '66666666-6666-4666-8666-666666666666';

const context = (tenantId: string): TrustedTenantContext =>
  ({
    tenantId,
    membershipId: '77777777-7777-4777-8777-777777777777',
    platformUserId: '88888888-8888-4888-8888-888888888888',
  }) as TrustedTenantContext;

const route = {
  placements: [{ placementId: placement }],
} as TenantStorageRoute;

function record(overrides: Partial<AppointmentRecord> = {}): AppointmentRecord {
  const startsAt = new Date('2026-10-15T09:00:00.000Z');
  const endsAt = new Date('2026-10-15T09:30:00.000Z');
  return {
    id: appointmentId,
    patientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    doctorId,
    facilityId,
    branchId,
    serviceId: null,
    startsAt,
    endsAt,
    status: 'SCHEDULED',
    reason: null,
    createdAt: startsAt,
    updatedAt: startsAt,
    createdBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    updatedBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    cancelledAt: null,
    cancelledBy: null,
    version: 1,
    ...overrides,
  };
}

describe('tenant appointment storage adapters', () => {
  it('keeps in-memory appointments partitioned by trusted tenant context', async () => {
    const storage = new InMemoryTenantAppointmentStorage();
    const appointment = record();
    await storage.create(context(tenantA), route, appointment);

    await expect(storage.findById(context(tenantA), route, appointmentId)).resolves.toMatchObject({
      id: appointmentId,
      facilityId,
    });
    await expect(storage.findById(context(tenantB), route, appointmentId)).resolves.toBeNull();
    await expect(
      storage.list(context(tenantB), route, {
        limit: 50,
        offset: 0,
        accessScope: { unrestricted: true, facilityIds: [], branchIds: [] },
      }),
    ).resolves.toMatchObject({ items: [], total: 0 });
  });

  it('filters branch-scoped appointments and returns stable paginated ordering', async () => {
    const storage = new InMemoryTenantAppointmentStorage();
    const first = record();
    const later = record({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      startsAt: new Date('2026-10-15T10:00:00.000Z'),
      endsAt: new Date('2026-10-15T10:30:00.000Z'),
      branchId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
    await storage.create(context(tenantA), route, first);
    await storage.create(context(tenantA), route, later);

    const result = await storage.list(context(tenantA), route, {
      limit: 1,
      offset: 0,
      accessScope: { unrestricted: false, facilityIds: [], branchIds: [branchId] },
    });

    expect(result).toMatchObject({
      items: [{ id: appointmentId, branchId }],
      total: 1,
      hasNext: false,
    });
  });

  it('detects interval overlaps for the same provider, excludes cancelled records, and permits adjacency', async () => {
    const storage = new InMemoryTenantAppointmentStorage();
    const appointment = record();
    await storage.create(context(tenantA), route, appointment);

    await expect(
      storage.hasProviderOverlap(context(tenantA), route, {
        doctorId,
        startsAt: new Date('2026-10-15T09:15:00.000Z'),
        endsAt: new Date('2026-10-15T09:45:00.000Z'),
      }),
    ).resolves.toBe(true);
    await expect(
      storage.hasProviderOverlap(context(tenantA), route, {
        doctorId,
        startsAt: appointment.endsAt,
        endsAt: new Date('2026-10-15T10:00:00.000Z'),
      }),
    ).resolves.toBe(false);
    await expect(
      storage.hasProviderOverlap(context(tenantB), route, {
        doctorId,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
      }),
    ).resolves.toBe(false);

    const cancelled = await storage.update(context(tenantA), route, appointmentId, 1, {
      status: 'CANCELLED',
      cancelledAt: new Date('2026-10-14T12:00:00.000Z'),
    });
    expect(cancelled?.version).toBe(2);
    await expect(
      storage.hasProviderOverlap(context(tenantA), route, {
        doctorId,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
      }),
    ).resolves.toBe(false);
  });

  it('uses optimistic version checks to avoid overwriting a concurrent appointment mutation', async () => {
    const storage = new InMemoryTenantAppointmentStorage();
    await storage.create(context(tenantA), route, record());

    const firstUpdate = await storage.update(context(tenantA), route, appointmentId, 1, {
      reason: 'Updated',
      updatedAt: new Date('2026-10-14T12:00:00.000Z'),
    });
    const staleUpdate = await storage.update(context(tenantA), route, appointmentId, 1, {
      reason: 'Stale',
    });

    expect(firstUpdate?.version).toBe(2);
    expect(staleUpdate).toBeNull();
    await expect(storage.findById(context(tenantA), route, appointmentId)).resolves.toMatchObject({
      reason: 'Updated',
      version: 2,
    });
  });

  it('serializes competing provider overlap checks within a tenant', async () => {
    const storage = new InMemoryTenantAppointmentStorage();
    const locks = [
      { resourceType: 'DOCTOR' as const, resourceId: doctorId },
      { resourceType: 'FACILITY' as const, resourceId: facilityId },
    ];
    const startsAt = new Date('2026-10-15T09:00:00.000Z');
    const endsAt = new Date('2026-10-15T09:30:00.000Z');
    let announceAcquired!: () => void;
    let releaseFirst!: () => void;
    const acquired = new Promise<void>((resolve) => {
      announceAcquired = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = storage.withSchedulingLocks(context(tenantA), route, locks, async (locked) => {
      expect(await locked.hasProviderOverlap({ doctorId, startsAt, endsAt })).toBe(false);
      announceAcquired();
      await holdFirst;
      return locked.create(record({ startsAt, endsAt }));
    });
    await acquired;
    const second = storage.withSchedulingLocks(context(tenantA), route, locks, async (locked) => {
      if (await locked.hasProviderOverlap({ doctorId, startsAt, endsAt })) {
        throw new AppointmentScheduleConflictError();
      }
      return locked.create(
        record({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          startsAt,
          endsAt,
        }),
      );
    });

    releaseFirst();
    await expect(first).resolves.toMatchObject({ id: appointmentId });
    await expect(second).rejects.toBeInstanceOf(AppointmentScheduleConflictError);
    await expect(
      storage.list(context(tenantA), route, {
        limit: 10,
        offset: 0,
        accessScope: { unrestricted: true, facilityIds: [], branchIds: [] },
      }),
    ).resolves.toMatchObject({ total: 1 });

    await expect(
      storage.withSchedulingLocks(context(tenantB), route, locks, async (locked) =>
        locked.hasProviderOverlap({ doctorId, startsAt, endsAt }),
      ),
    ).resolves.toBe(false);
  });

  it('fails closed when tenant appointment storage is not configured', async () => {
    const storage = new UnconfiguredTenantAppointmentStorage();

    await expect(
      storage.list(context(tenantA), route, {
        limit: 10,
        offset: 0,
        accessScope: { unrestricted: true, facilityIds: [], branchIds: [] },
      }),
    ).rejects.toBeInstanceOf(TenantStorageNotConfiguredError);
  });
});
