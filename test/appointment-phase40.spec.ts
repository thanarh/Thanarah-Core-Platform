import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  appointmentEffectiveTimeZonesQuerySchema,
  listAppointmentsQuerySchema,
} from '../src/tenant/appointment.dto';
import { localDateRangeToUtc } from '../src/tenant/appointment-timezone';

const facilityId = '55555555-5555-4555-8555-555555555555';

describe('appointment search and timezone contracts', () => {
  it('normalizes bounded search and supports combined service/status filters', () => {
    const result = listAppointmentsQuerySchema.parse({
      search: '  Aisha   Noor ',
      facilityId,
      serviceId: '77777777-7777-4777-8777-777777777777',
      status: 'SCHEDULED',
      limit: '20',
      offset: '40',
    });

    expect(result).toMatchObject({
      search: 'Aisha Noor',
      facilityId,
      serviceId: '77777777-7777-4777-8777-777777777777',
      status: 'SCHEDULED',
      limit: 20,
      offset: 40,
    });
  });

  it('requires a facility and active-timezone date semantics for local calendar dates', () => {
    expect(listAppointmentsQuerySchema.safeParse({ fromDate: '2026-10-15' }).success).toBe(false);
    expect(
      listAppointmentsQuerySchema.safeParse({
        facilityId,
        fromDate: '2026-10-15',
        from: '2026-10-15T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      listAppointmentsQuerySchema.safeParse({
        facilityId,
        fromDate: '2026-02-30',
      }).success,
    ).toBe(false);
    expect(
      listAppointmentsQuerySchema.safeParse({
        facilityId,
        fromDate: '2026-10-16',
        toDate: '2026-10-15',
      }).success,
    ).toBe(false);
  });

  it('bounds timezone-only facility lookups and removes duplicate IDs', () => {
    expect(
      appointmentEffectiveTimeZonesQuerySchema.parse({
        facilityIds: `${facilityId}, ${facilityId}`,
      }),
    ).toEqual({ facilityIds: [facilityId] });
    expect(
      appointmentEffectiveTimeZonesQuerySchema.safeParse({
        facilityIds: Array.from({ length: 21 }, (_, index) => {
          const suffix = (index + 1).toString(16).padStart(12, '0');
          return `55555555-5555-4555-8555-${suffix}`;
        }).join(','),
      }).success,
    ).toBe(false);
  });

  it('converts local date ranges over real 23-hour and 25-hour DST days', () => {
    const spring = localDateRangeToUtc('2026-03-08', '2026-03-08', 'America/New_York');
    const fall = localDateRangeToUtc('2026-11-01', '2026-11-01', 'America/New_York');

    expect(spring.from?.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(spring.to?.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect((spring.to!.getTime() - spring.from!.getTime()) / 3_600_000).toBe(23);
    expect(fall.from?.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(fall.to?.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect((fall.to!.getTime() - fall.from!.getTime()) / 3_600_000).toBe(25);
  });

  it('converts local datetimes without inheriting the server or browser timezone', () => {
    expect(localDateRangeToUtc('2026-10-15', '2026-10-15', 'Asia/Riyadh').from?.toISOString()).toBe(
      '2026-10-14T21:00:00.000Z',
    );

    const window: Record<string, unknown> = {};
    const source = readFileSync('public/appointments/timezone.js', 'utf8');
    runInNewContext(source, { window, Intl, Date, Map, Set, RangeError, String, Number, Object });
    const clientTimezone = window.ThanarahTimezone as {
      localDateTimeToIso(value: string, timeZone: string): string;
      instantToLocalInput(value: string, timeZone: string): string;
    };

    expect(clientTimezone.localDateTimeToIso('2026-03-08T03:30', 'America/New_York')).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    expect(clientTimezone.instantToLocalInput('2026-10-14T21:00:00.000Z', 'Asia/Riyadh')).toBe(
      '2026-10-15T00:00',
    );
  });

  it('rejects nonexistent and ambiguous daylight-saving local appointment times', () => {
    const window: Record<string, unknown> = {};
    const source = readFileSync('public/appointments/timezone.js', 'utf8');
    runInNewContext(source, { window, Intl, Date, Map, Set, RangeError, String, Number, Object });
    const clientTimezone = window.ThanarahTimezone as {
      localDateTimeToIso(value: string, timeZone: string): string;
    };

    expect(() => clientTimezone.localDateTimeToIso('2026-03-08T02:30', 'America/New_York')).toThrow(
      'غير موجود',
    );
    expect(() => clientTimezone.localDateTimeToIso('2026-11-01T01:30', 'America/New_York')).toThrow(
      'يتكرر',
    );
  });
});
