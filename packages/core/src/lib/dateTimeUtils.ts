import { format, toZonedTime, fromZonedTime } from 'date-fns-tz';
import { parseISO, isToday, isYesterday } from 'date-fns';
import { Temporal } from '@js-temporal/polyfill';
import type { ISO8601String, DateValue } from '@alga-psa/types';

export function utcToLocal(utcDate: string, timeZone: string): Date {
  const date = parseISO(utcDate);
  return toZonedTime(date, timeZone);
}

export function localToUtc(localDate: Date, timeZone: string): Date {
  return fromZonedTime(localDate, timeZone);
}

export function formatDateTime(
  date: Date,
  timeZone: string,
  formatString: string = 'yyyy-MM-dd HH:mm:ss'
): string {
  return format(toZonedTime(date, timeZone), formatString, { timeZone });
}

export function formatRelativeDateTime(date: Date, timeZone: string): string {
  const zonedDate = toZonedTime(date, timeZone);
  const timeStr = format(zonedDate, 'h:mm a', { timeZone });

  if (isToday(zonedDate)) {
    return `Today, ${timeStr}`;
  }

  if (isYesterday(zonedDate)) {
    return `Yesterday, ${timeStr}`;
  }

  return format(zonedDate, 'MMM dd, yyyy, h:mm a', { timeZone });
}

export function formatDateOnly(date: Date, formatString: string = 'yyyy-MM-dd'): string {
  return format(date, formatString);
}

/**
 * Build a Date from a calendar-date value that displays the same day in every
 * timezone, by anchoring at local noon (the contracts screens' established
 * pattern for date-only values like `expiration_date`). Without the noon anchor,
 * `new Date('2026-08-31')` becomes UTC midnight and shifts back a day in
 * negative-offset timezones (and forward a day at UTC+12 and beyond). Returns
 * null for empty or unparseable input.
 */
export function toCalendarDisplayDate(
  value: string | Date | Temporal.PlainDate | null | undefined,
): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  try {
    const plainDate = toPlainDate(value);
    return new Date(plainDate.year, plainDate.month - 1, plainDate.day, 12);
  } catch {
    return null;
  }
}

/**
 * Format a calendar-date value for display without a timezone round-trip.
 * Returns null for empty or unparseable input. Use for date-only values
 * (e.g. `expiration_date`); true instants like `created_at` should keep going
 * through {@link formatDateOnly} so they render in local time.
 */
export function formatCalendarDate(
  value: string | Date | Temporal.PlainDate | null | undefined,
  formatString: string = 'yyyy-MM-dd',
): string | null {
  const displayDate = toCalendarDisplayDate(value);
  return displayDate ? formatDateOnly(displayDate, formatString) : null;
}

/**
 * Convert a DatePicker-produced local-midnight `Date` (or any date-like value)
 * to a plain calendar-date string (YYYY-MM-DD), reading LOCAL calendar
 * components. Never round-trips through `toISOString()`: a local-midnight Date
 * at UTC+2 serializes as the previous UTC day, which is how selected dates
 * drifted backwards on persist. This is the safe inverse of
 * {@link toCalendarDisplayDate} — keep the two in step.
 *
 * - `Date` → local getFullYear/getMonth/getDate. Safe both for DatePicker
 *   selections and for pg DATE columns, which node-postgres materializes as
 *   local-midnight Date objects.
 * - `YYYY-MM-DD` string → validated via `Temporal.PlainDate.from` and passed
 *   through byte-for-byte.
 * - Full ISO instant string → existing UTC calendar-date semantics (legacy
 *   callers; date-only values never take this branch).
 * - `Temporal.PlainDate` → its calendar date.
 * - `null`/`undefined`/`''` → `null`.
 *
 * Throws on invalid values; callers treat that as a validation failure.
 */
export function toCalendarDateString(
  value: Date | string | Temporal.PlainDate | null | undefined,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid date value: ${String(value)}`);
    }
    return (
      String(value.getFullYear()) +
      '-' +
      String(value.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(value.getDate()).padStart(2, '0')
    );
  }
  if (value instanceof Temporal.PlainDate) {
    return value.toString();
  }
  if (value.length === 10) {
    return Temporal.PlainDate.from(value).toString();
  }
  return toPlainDate(value).toString();
}

/**
 * Calendar date (YYYY-MM-DD) of `value` in the given IANA timezone. Derived via
 * Intl.DateTimeFormat parts so the result is the wall-clock calendar day in
 * `timeZone` regardless of the host's timezone — never routed through Date
 * reparsing or toISOString (which would re-read the host/UTC calendar). This is
 * the timezone-aware counterpart to {@link toCalendarDateString}: use it where
 * "today" must be evaluated on a tenant's calendar (expiration boundaries) and
 * the worker host's timezone is not authoritative.
 *
 * Throws on an invalid timeZone string (Intl rejects garbage); callers should
 * resolve the timezone through a validating fallback (e.g. the tenant-settings
 * read + `normalizeIanaTimeZone` pattern) and default to 'UTC' when unset.
 */
export function toCalendarDateStringInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatUtcDateNoTime(date: Date): string {
  return (
    date.getUTCFullYear() +
    '-' +
    String(date.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getUTCDate()).padStart(2, '0') +
    'T00:00:00Z'
  );
}

export function getUserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Convert a date string, Date object, or Temporal.PlainDate to a Temporal.PlainDate.
 * Handles both date-only strings and full ISO timestamps.
 */
export function toPlainDate(date: string | Date | Temporal.PlainDate | null | undefined): Temporal.PlainDate {
  if (date === null || date === undefined) {
    throw new Error('Cannot convert null or undefined to PlainDate');
  }

  if (date instanceof Temporal.PlainDate) {
    return date;
  }

  if (typeof date === 'string') {
    if (date.includes('T') || date.includes('Z')) {
      return Temporal.Instant.from(date).toZonedDateTimeISO('UTC').toPlainDate();
    }

    return Temporal.PlainDate.from(date);
  }

  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    return Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO('UTC').toPlainDate();
  }

  throw new Error(`Invalid date value: ${String(date)}`);
}

export function toISODate(date: Temporal.PlainDate): string {
  return date.toString();
}

export function toISOTimestamp(date: Temporal.PlainDate): ISO8601String {
  return `${date.toString()}T00:00:00.000Z`;
}

export function dateValueToDate(dateValue: DateValue): Date {
  if (dateValue instanceof Date) {
    return dateValue;
  }
  if (dateValue instanceof Temporal.PlainDate) {
    return new Date(`${dateValue.toString()}T00:00:00Z`);
  }
  return new Date(dateValue);
}

export function getCurrentDate(): Temporal.PlainDate {
  return Temporal.Now.plainDateISO();
}

/** Current calendar date in the viewer's resolved IANA timezone. */
export function getCurrentDateInUserTimeZone(): string {
  return Temporal.Now.zonedDateTimeISO(getUserTimeZone()).toPlainDate().toString();
}

export function parseDateSafe(dateStr: string | null | undefined): Temporal.PlainDate | null {
  if (!dateStr) return null;
  try {
    return toPlainDate(dateStr);
  } catch (error) {
    console.error('Error parsing date:', error);
    return null;
  }
}

export function minutesToHours(minutes: number | null | undefined, precision: number = 2): number | null {
  if (minutes === null || minutes === undefined) {
    return null;
  }

  return Number.parseFloat((minutes / 60).toFixed(precision));
}

export function hoursToMinutes(hours: number | null | undefined): number | null {
  if (hours === null || hours === undefined) {
    return null;
  }

  return Math.round(hours * 60);
}

export interface DurationLabels {
  hr?: string;
  hrs?: string;
  min?: string;
}

export function formatMinutesAsHoursAndMinutes(
  minutes: number | null | undefined,
  labels?: DurationLabels,
): string {
  const hrLabel = labels?.hr ?? 'hr';
  const hrsLabel = labels?.hrs ?? 'hrs';
  const minLabel = labels?.min ?? 'min';

  if (minutes === null || minutes === undefined) {
    return `0 ${hrsLabel}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);

  const hourText = hours === 1 ? hrLabel : hrsLabel;

  if (remainingMinutes === 0) {
    return `${hours} ${hourText}`;
  }
  return `${hours} ${hourText} ${remainingMinutes} ${minLabel}`;
}
