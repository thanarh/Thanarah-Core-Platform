import { AppointmentPolicyViolationError } from './appointment.errors';
import type { SchedulingPolicyRules } from './appointment-scheduling-policy.dto';
import { SCHEDULING_WEEKDAYS } from './appointment-scheduling-policy.dto';
import { SchedulingPolicyUnavailableError } from './appointment-scheduling-policy.errors';

export interface ActiveSchedulingPolicy {
  timeZone: string;
  rules: SchedulingPolicyRules;
}

export function assertBookingWithinPolicy(
  policy: ActiveSchedulingPolicy,
  input: {
    doctorId: string;
    serviceId: string | null;
    startsAt: Date;
    endsAt: Date;
  },
  now: Date = new Date(),
): void {
  const startTime = zonedDateTime(input.startsAt, policy.timeZone);
  const endTime = zonedDateTime(input.endsAt, policy.timeZone);
  const nowTime = zonedDateTime(now, policy.timeZone);

  const operatingHours = policy.rules.operatingHours;
  if (Object.keys(operatingHours).length > 0) {
    assertWithinSchedule(
      operatingHours,
      startTime,
      endTime,
      'FACILITY_OPERATING_HOURS',
    );
  }

  const provider = policy.rules.providerAvailability.find(
    ({ doctorId }) => doctorId === input.doctorId,
  );
  if (provider) {
    const exception = provider.exceptions.find(({ date }) => date === startTime.date);
    assertWithinSchedule(
      exception?.intervals ?? provider.weeklyAvailability[startTime.weekday] ?? [],
      startTime,
      endTime,
      'PROVIDER_AVAILABILITY',
    );
  }

  const durationMinutes = (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000;
  const matchingServiceRule = input.serviceId
    ? policy.rules.serviceDurationRules.find(({ serviceId }) => serviceId === input.serviceId)
    : undefined;
  if (
    policy.rules.allowedDurationsMinutes.length > 0 &&
    (!Number.isInteger(durationMinutes) ||
      !policy.rules.allowedDurationsMinutes.includes(durationMinutes))
  ) {
    throw new AppointmentPolicyViolationError('APPOINTMENT_DURATION');
  }
  if (
    matchingServiceRule &&
    (!Number.isInteger(durationMinutes) ||
      !matchingServiceRule.allowedDurationsMinutes.includes(durationMinutes))
  ) {
    throw new AppointmentPolicyViolationError('SERVICE_DURATION');
  }

  if (
    policy.rules.minimumAdvanceNoticeMinutes !== null &&
    input.startsAt.getTime() - now.getTime() <
      policy.rules.minimumAdvanceNoticeMinutes * 60_000
  ) {
    throw new AppointmentPolicyViolationError('MINIMUM_ADVANCE_NOTICE');
  }

  if (policy.rules.bookingHorizonDays !== null && input.startsAt.getTime() > now.getTime()) {
    const bookingDay = dayOrdinal(startTime.date);
    const currentDay = dayOrdinal(nowTime.date);
    if (bookingDay - currentDay > policy.rules.bookingHorizonDays) {
      throw new AppointmentPolicyViolationError('BOOKING_HORIZON');
    }
  }
}

export function assertCancellationWithinPolicy(
  policy: ActiveSchedulingPolicy,
  startsAt: Date,
  now: Date = new Date(),
): void {
  const minimum = policy.rules.minimumCancellationNoticeMinutes;
  if (
    minimum !== null &&
    startsAt.getTime() - now.getTime() < minimum * 60_000
  ) {
    throw new AppointmentPolicyViolationError('CANCELLATION_NOTICE');
  }
}

export function assertReschedulingWithinPolicy(
  policy: ActiveSchedulingPolicy,
  startsAt: Date,
  now: Date = new Date(),
): void {
  const minimum = policy.rules.minimumRescheduleNoticeMinutes;
  if (
    minimum !== null &&
    startsAt.getTime() - now.getTime() < minimum * 60_000
  ) {
    throw new AppointmentPolicyViolationError('RESCHEDULING_NOTICE');
  }
}

function assertWithinSchedule(
  schedule: Partial<Record<(typeof SCHEDULING_WEEKDAYS)[number], Array<{ start: string; end: string }>>,
  start: ZonedDateTime,
  end: ZonedDateTime,
  rule: string,
): void {
  if (!scheduleCovers(schedule[start.weekday] ?? [], start, end)) {
    throw new AppointmentPolicyViolationError(rule);
  }
}

function scheduleCovers(
  intervals: Array<{ start: string; end: string }>,
  start: ZonedDateTime,
  end: ZonedDateTime,
): boolean {
  const crossesToMidnight =
    end.date === nextDate(start.date) && end.hour === 0 && end.minute === 0;
  if (end.date !== start.date && !crossesToMidnight) return false;

  return intervals.some((interval) => {
    const intervalStart = clockMinutes(interval.start);
    const intervalEnd = clockMinutes(interval.end);
    const appointmentStart = start.hour * 60 + start.minute;
    const localEnd = end.hour * 60 + end.minute;
    const appointmentEnd =
      crossesToMidnight && intervalEnd === 1440 ? 1440 : localEnd;
    return (
      appointmentStart >= intervalStart &&
      appointmentStart < intervalEnd &&
      appointmentEnd >= intervalStart &&
      appointmentEnd <= intervalEnd
    );
  });
}

interface ZonedDateTime {
  date: string;
  weekday: (typeof SCHEDULING_WEEKDAYS)[number];
  hour: number;
  minute: number;
}

function zonedDateTime(value: Date, timeZone: string): ZonedDateTime {
  if (!Number.isFinite(value.getTime())) throw new SchedulingPolicyUnavailableError();
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
        timeZone,
        calendar: 'gregory',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(value)
        .filter(({ type }) => type !== 'literal')
        .map(({ type, value: part }) => [type, part]),
    );
  } catch {
    throw new SchedulingPolicyUnavailableError();
  }
  const weekday = parts.weekday.toLowerCase() as ZonedDateTime['weekday'];
  if (!(SCHEDULING_WEEKDAYS as readonly string[]).includes(weekday)) {
    throw new SchedulingPolicyUnavailableError();
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function clockMinutes(value: string): number {
  if (value === '24:00') return 1440;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function nextDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return `${date.getUTCFullYear().toString().padStart(4, '0')}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}-${date.getUTCDate().toString().padStart(2, '0')}`;
}

function dayOrdinal(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}
