export interface AppointmentDateRange {
  from?: Date;
  to?: Date;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function localDateRangeToUtc(
  fromDate: string | undefined,
  toDate: string | undefined,
  timeZone: string,
): AppointmentDateRange {
  assertTimeZone(timeZone);
  return {
    ...(fromDate ? { from: startOfLocalDate(fromDate, timeZone) } : {}),
    ...(toDate ? { to: startOfLocalDate(addLocalDateDays(toDate, 1), timeZone) } : {}),
  };
}

/** Resolves a calendar-day boundary in an IANA zone, including midnight DST gaps. */
export function startOfLocalDate(value: string, timeZone: string): Date {
  const date = parseLocalDate(value);
  assertTimeZone(timeZone);
  const desired = { ...date, hour: 0, minute: 0, second: 0 };
  for (let minute = 0; minute <= 180; minute += 1) {
    const normalized = addLocalMinutes(desired, minute);
    const matches = possibleInstants(normalized, timeZone);
    if (matches.length) return new Date(Math.min(...matches));
  }
  throw new RangeError('The local calendar date has no resolvable start in this time zone.');
}

function parseLocalDate(value: string): Omit<LocalDateParts, 'hour' | 'minute' | 'second'> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new RangeError('A valid YYYY-MM-DD calendar date is required.');
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError('A valid YYYY-MM-DD calendar date is required.');
  }
  return { year, month, day };
}

function addLocalDateDays(value: string, days: number): string {
  const { year, month, day } = parseLocalDate(value);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day + days);
  date.setUTCHours(0, 0, 0, 0);
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function addLocalMinutes(parts: LocalDateParts, minutes: number): LocalDateParts {
  const date = new Date(utcEpoch({ ...parts, hour: 0, minute: minutes, second: 0 }));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function possibleInstants(parts: LocalDateParts, timeZone: string): number[] {
  const localEpoch = utcEpoch(parts);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 3) {
    const instant = localEpoch + hours * 60 * 60 * 1000;
    offsets.add(utcEpoch(partsAt(new Date(instant), timeZone)) - instant);
  }
  return [...offsets]
    .map((offset) => localEpoch - offset)
    .filter((instant) => sameParts(partsAt(new Date(instant), timeZone), parts))
    .sort((left, right) => left - right);
}

function partsAt(date: Date, timeZone: string): LocalDateParts {
  const values = new Map(
    getFormatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.get('year')!,
    month: values.get('month')!,
    day: values.get('day')!,
    hour: values.get('hour')!,
    minute: values.get('minute')!,
    second: values.get('second')!,
  };
}

function sameParts(left: LocalDateParts, right: LocalDateParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function utcEpoch(parts: LocalDateParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function assertTimeZone(timeZone: string): void {
  if (typeof timeZone !== 'string' || !timeZone.trim()) {
    throw new RangeError('An IANA time-zone identifier is required.');
  }
  getFormatter(timeZone);
}
