(function (root) {
  'use strict';

  const formatterCache = new Map();

  function localDateTimeToIso(value, timeZone) {
    const parts = parseLocalDateTime(value);
    const matches = possibleInstants(parts, timeZone);
    if (matches.length === 0) {
      throw new RangeError('هذا الوقت المحلي غير موجود بسبب تغيير التوقيت في المنطقة المختارة.');
    }
    if (matches.length > 1) {
      throw new RangeError('هذا الوقت المحلي يتكرر بسبب تغيير التوقيت. اختر وقتًا آخر لتحديد لحظة واضحة.');
    }
    return new Date(matches[0]).toISOString();
  }

  function instantToLocalInput(value, timeZone) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime()) || !timeZone) return '';
    const parts = partsAt(instant, timeZone);
    return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}T${pad(parts.hour, 2)}:${pad(parts.minute, 2)}`;
  }

  function parseLocalDateTime(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(String(value || ''));
    if (!match) throw new RangeError('أدخل تاريخًا ووقتًا محليين صالحين.');
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, 0, 0);
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day ||
      date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute
    ) {
      throw new RangeError('أدخل تاريخًا ووقتًا محليين صالحين.');
    }
    return { year, month, day, hour, minute, second: 0 };
  }

  function possibleInstants(localParts, timeZone) {
    if (!timeZone) throw new RangeError('لم تتوفر منطقة زمنية صالحة للمنشأة أو الجهاز.');
    const localEpoch = utcEpoch(localParts);
    const offsets = new Set();
    for (let hours = -48; hours <= 48; hours += 3) {
      const instant = localEpoch + hours * 60 * 60 * 1000;
      offsets.add(utcEpoch(partsAt(new Date(instant), timeZone)) - instant);
    }
    return [...offsets]
      .map((offset) => localEpoch - offset)
      .filter((instant) => sameParts(partsAt(new Date(instant), timeZone), localParts))
      .sort((left, right) => left - right);
  }

  function partsAt(date, timeZone) {
    const values = new Map(
      getFormatter(timeZone)
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    return {
      year: values.get('year'),
      month: values.get('month'),
      day: values.get('day'),
      hour: values.get('hour'),
      minute: values.get('minute'),
      second: values.get('second'),
    };
  }

  function sameParts(left, right) {
    return (
      left.year === right.year &&
      left.month === right.month &&
      left.day === right.day &&
      left.hour === right.hour &&
      left.minute === right.minute &&
      left.second === right.second
    );
  }

  function utcEpoch(parts) {
    const date = new Date(0);
    date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
    return date.getTime();
  }

  function getFormatter(timeZone) {
    if (formatterCache.has(timeZone)) return formatterCache.get(timeZone);
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

  function pad(value, size) {
    return String(value).padStart(size, '0');
  }

  root.ThanarahTimezone = { localDateTimeToIso, instantToLocalInput };
})(typeof window === 'undefined' ? globalThis : window);
