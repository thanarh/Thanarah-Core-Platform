import { describe, expect, it, vi } from 'vitest';
import {
  schedulingPolicyInputSchema,
  schedulingPolicyRulesSchema,
} from '../src/tenant/appointment-scheduling-policy.dto';
import {
  assertBookingWithinPolicy,
  assertCancellationWithinPolicy,
  assertReschedulingWithinPolicy,
} from '../src/tenant/appointment-scheduling-policy.enforcement';
import { AppointmentPolicyViolationError } from '../src/tenant/appointment.errors';
import type { SchedulingPolicyRules } from '../src/tenant/appointment-scheduling-policy.dto';
import { FacilitySchedulingPolicyService } from '../src/tenant/appointment-scheduling-policy.service';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';

const doctorId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const tenantId = '33333333-3333-4333-8333-333333333333';
const membershipId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';

function policy(
  timeZone: string,
  rules: unknown,
): { timeZone: string; rules: SchedulingPolicyRules } {
  return {
    timeZone,
    rules: schedulingPolicyRulesSchema.parse(rules),
  };
}

describe('facility scheduling policy validation and enforcement', () => {
  it('does not invent time-zone or scheduling-rule values', () => {
    const parsed = schedulingPolicyInputSchema.parse({
      timeZone: 'Etc/UTC',
      rules: {},
    });
    expect(parsed.timeZone).toBe('UTC');
    expect(parsed.rules).toMatchObject({
      operatingHours: {},
      providerAvailability: [],
      allowedDurationsMinutes: [],
      serviceDurationRules: [],
      bookingHorizonDays: null,
      minimumAdvanceNoticeMinutes: null,
      minimumCancellationNoticeMinutes: null,
      minimumRescheduleNoticeMinutes: null,
    });
  });

  it('preserves explicit-start/end behavior when no active facility policy exists', async () => {
    const policies = { findActiveByFacility: vi.fn().mockResolvedValue(null) };
    const service = new FacilitySchedulingPolicyService(
      policies as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const context = {
      tenantId,
      membershipId,
      platformUserId: userId,
    } as TrustedTenantContext;
    const booking = {
      facilityId: '66666666-6666-4666-8666-666666666666',
      doctorId,
      serviceId: null,
      startsAt: new Date('2026-10-15T09:00:00.000Z'),
      endsAt: new Date('2026-10-15T09:30:00.000Z'),
    };

    await expect(service.assertBookingAllowed(context, booking)).resolves.toBeUndefined();
    await expect(
      service.assertCancellationAllowed(context, booking.facilityId, booking.startsAt),
    ).resolves.toBeUndefined();
    await expect(
      service.assertReschedulingAllowed(context, booking.facilityId, booking.startsAt),
    ).resolves.toBeUndefined();
    expect(policies.findActiveByFacility).toHaveBeenCalledTimes(3);
    expect(policies.findActiveByFacility).toHaveBeenCalledWith(tenantId, booking.facilityId);
  });

  it('rejects invalid IANA zones, overlapping operating intervals, and unknown storage fields', () => {
    expect(
      schedulingPolicyInputSchema.safeParse({
        timeZone: 'Mars/Olympus',
        rules: {},
      }).success,
    ).toBe(false);
    expect(
      schedulingPolicyInputSchema.safeParse({
        timeZone: 'UTC',
        rules: {
          operatingHours: {
            monday: [
              { start: '09:00', end: '12:00' },
              { start: '11:30', end: '13:00' },
            ],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      schedulingPolicyInputSchema.safeParse({
        timeZone: 'UTC',
        storageId: 'untrusted',
        rules: {},
      }).success,
    ).toBe(false);
  });

  it('enforces facility hours and service-specific duration rules', () => {
    const configured = policy('America/New_York', {
      operatingHours: { thursday: [{ start: '09:00', end: '17:00' }] },
      serviceDurationRules: [{ serviceId, allowedDurationsMinutes: [30, 60] }],
    });
    const input = {
      doctorId,
      serviceId,
      startsAt: new Date('2026-10-15T13:00:00.000Z'),
      endsAt: new Date('2026-10-15T13:30:00.000Z'),
    };
    expect(() => assertBookingWithinPolicy(configured, input)).not.toThrow();
    expect(() =>
      assertBookingWithinPolicy(configured, {
        ...input,
        endsAt: new Date('2026-10-15T13:45:00.000Z'),
      }),
    ).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({ rule: 'SERVICE_DURATION' }),
      }),
    );
    expect(() =>
      assertBookingWithinPolicy(configured, {
        ...input,
        startsAt: new Date('2026-10-15T11:00:00.000Z'),
        endsAt: new Date('2026-10-15T11:30:00.000Z'),
      }),
    ).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({ rule: 'FACILITY_OPERATING_HOURS' }),
      }),
    );
  });

  it('evaluates DST transition appointments as real instants in the configured IANA zone', () => {
    const springForward = policy('America/New_York', {
      operatingHours: { sunday: [{ start: '01:00', end: '04:00' }] },
      allowedDurationsMinutes: [60],
    });
    expect(() =>
      assertBookingWithinPolicy(springForward, {
        doctorId,
        serviceId: null,
        startsAt: new Date('2026-03-08T06:30:00.000Z'),
        endsAt: new Date('2026-03-08T07:30:00.000Z'),
      }),
    ).not.toThrow();

    const fallBack = policy('America/New_York', {
      operatingHours: { sunday: [{ start: '01:00', end: '02:00' }] },
      allowedDurationsMinutes: [60],
    });
    expect(() =>
      assertBookingWithinPolicy(fallBack, {
        doctorId,
        serviceId: null,
        startsAt: new Date('2026-11-01T05:30:00.000Z'),
        endsAt: new Date('2026-11-01T06:30:00.000Z'),
      }),
    ).not.toThrow();
  });

  it('enforces booking horizon, advance notice, cancellation notice, and rescheduling notice only when configured', () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    const configured = policy('UTC', {
      bookingHorizonDays: 2,
      minimumAdvanceNoticeMinutes: 60,
      minimumCancellationNoticeMinutes: 120,
      minimumRescheduleNoticeMinutes: 60,
    });
    const common = { doctorId, serviceId: null };
    expect(() =>
      assertBookingWithinPolicy(
        configured,
        {
          ...common,
          startsAt: new Date('2026-10-15T14:00:00.000Z'),
          endsAt: new Date('2026-10-15T14:30:00.000Z'),
        },
        now,
      ),
    ).not.toThrow();
    expect(() =>
      assertBookingWithinPolicy(
        configured,
        {
          ...common,
          startsAt: new Date('2026-10-18T12:00:00.000Z'),
          endsAt: new Date('2026-10-18T12:30:00.000Z'),
        },
        now,
      ),
    ).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({ rule: 'BOOKING_HORIZON' }),
      }),
    );
    expect(() =>
      assertBookingWithinPolicy(
        configured,
        {
          ...common,
          startsAt: new Date('2026-10-15T12:30:00.000Z'),
          endsAt: new Date('2026-10-15T13:00:00.000Z'),
        },
        now,
      ),
    ).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({ rule: 'MINIMUM_ADVANCE_NOTICE' }),
      }),
    );
    expect(() =>
      assertCancellationWithinPolicy(configured, new Date('2026-10-15T13:00:00.000Z'), now),
    ).toThrowError(AppointmentPolicyViolationError);
    expect(() =>
      assertReschedulingWithinPolicy(configured, new Date('2026-10-15T12:30:00.000Z'), now),
    ).toThrowError(AppointmentPolicyViolationError);

    const unrestricted = policy('UTC', {});
    expect(() =>
      assertBookingWithinPolicy(
        unrestricted,
        {
          ...common,
          startsAt: new Date('2026-10-15T12:00:00.000Z'),
          endsAt: new Date('2026-10-15T12:30:00.000Z'),
        },
        now,
      ),
    ).not.toThrow();
  });
});
