import { Temporal } from '@js-temporal/polyfill';
import type { ITimePeriodView, TimeEntryWorkItemContext } from '@alga-psa/types';

/**
 * Only these sheet statuses accept new or changed time. Anything else
 * (SUBMITTED, APPROVED, an unknown future status) is locked. Mirrors the
 * server-side guard in saveTimeEntry and TimeSheet's isEditable rule.
 */
const EDITABLE_SHEET_STATUSES: ReadonlySet<string> = new Set(['DRAFT', 'CHANGES_REQUESTED']);

export function isEditableSheetStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && EDITABLE_SHEET_STATUSES.has(status);
}

function normalizeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) {
    return 'UTC';
  }
  try {
    Temporal.TimeZone.from(timeZone);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function toInstant(value: string | Date): Temporal.Instant {
  if (value instanceof Date) {
    return Temporal.Instant.from(value.toISOString());
  }
  return Temporal.Instant.from(value);
}

/** The calendar date an instant falls on in the subject user's timezone. */
export function workDateInTimeZone(value: string | Date, timeZone: string | null | undefined): string {
  return toInstant(value).toZonedDateTimeISO(normalizeTimeZone(timeZone)).toPlainDate().toString();
}

/** The instant for a plain wall-clock time (HH:mm) on a date in a timezone. */
export function instantAtZonedTime(
  plainDate: string,
  time: string,
  timeZone: string | null | undefined,
): Date {
  const date = Temporal.PlainDate.from(plainDate.slice(0, 10));
  const zoned = date.toZonedDateTime({
    timeZone: normalizeTimeZone(timeZone),
    plainTime: Temporal.PlainTime.from(time),
  });
  return new Date(zoned.toInstant().epochMilliseconds);
}

/**
 * Periods are half-open [start_date, end_date). Membership is evaluated with
 * the subject user's timezone, never the browser's, so the date the server will
 * compute for the entry matches what the picker believes.
 */
export function isWithinPeriod(
  value: string | Date,
  period: Pick<ITimePeriodView, 'start_date' | 'end_date'>,
  timeZone: string | null | undefined,
): boolean {
  const workDate = workDateInTimeZone(value, timeZone);
  const start = period.start_date.slice(0, 10);
  const end = period.end_date.slice(0, 10);
  return workDate >= start && workDate < end;
}

/** A period the subject user could file time against, with that user's sheet status. */
export type CatalogPeriod = Pick<ITimePeriodView, 'period_id' | 'start_date' | 'end_date'> & {
  timeSheetStatus?: string | null;
};

/** The period covering a calendar date (half-open [start_date, end_date)), if any. */
export function periodForWorkDate<P extends CatalogPeriod>(periods: readonly P[], workDate: string): P | null {
  const day = workDate.slice(0, 10);
  return (
    periods.find((period) => day >= period.start_date.slice(0, 10) && day < period.end_date.slice(0, 10)) ?? null
  );
}

/** True when a calendar date falls in a period whose sheet still accepts time. */
export function isEditableWorkDate(periods: readonly CatalogPeriod[], workDate: string): boolean {
  const period = periodForWorkDate(periods, workDate);
  return Boolean(period && isEditableSheetStatus(period.timeSheetStatus));
}

/** First and last calendar days across the editable periods, or null when none accept time. */
export function editableDateRange(
  periods: readonly CatalogPeriod[],
): { firstDay: string; lastDay: string } | null {
  const editable = periods.filter((period) => isEditableSheetStatus(period.timeSheetStatus));
  if (!editable.length) {
    return null;
  }
  const firstDay = editable.map((period) => period.start_date.slice(0, 10)).sort()[0];
  const lastDay = editable
    .map((period) => periodLastInclusiveDay(period.end_date))
    .sort()
    .reverse()[0];
  return { firstDay, lastDay };
}

/**
 * The editable day nearest `today`: today itself, else the latest editable day
 * before it, else the earliest one after it. Null when nothing accepts time.
 */
export function nearestEditableWorkDate(periods: readonly CatalogPeriod[], today: string): string | null {
  if (isEditableWorkDate(periods, today)) {
    return today;
  }
  const editable = periods.filter((period) => isEditableSheetStatus(period.timeSheetStatus));
  const lastDays = editable.map((period) => periodLastInclusiveDay(period.end_date));
  const before = lastDays.filter((day) => day < today).sort().reverse()[0];
  if (before) {
    return before;
  }
  const after = editable
    .map((period) => period.start_date.slice(0, 10))
    .filter((day) => day > today)
    .sort()[0];
  return after ?? null;
}

export type DefaultTimeSource = 'none' | 'context' | 'timer';

/** Why the default date is not simply the supplied times or today. */
export type DefaultDateMove =
  | { kind: 'none' }
  /** Supplied context/timer times fell on a day that cannot take time. */
  | { kind: 'supplied'; date: string }
  /** Today's sheet is locked (status given) or no period covers today (status null). */
  | { kind: 'today'; date: string; todayStatus: string | null };

export interface ResolvedEntryDefaults {
  /** Explicit defaults to hand the provider, so ad-hoc/schedule rows cannot land on a locked day. */
  defaultStartTime: Date;
  defaultEndTime: Date;
  /** Base date for the form; always on an editable day. */
  date: Date;
  /** Where the supplied timestamps came from, if any. */
  source: DefaultTimeSource;
  /** Set when the default had to move off the supplied times or off today. */
  moved: DefaultDateMove;
}

/**
 * Defaults for a new entry against the subject user's period catalog.
 * Supplied context/timer timestamps are kept only when BOTH endpoints fall on
 * the same editable period. Otherwise the entry starts at 08:00–09:00 in the
 * subject timezone on today, or on the nearest editable day when today cannot
 * take time. Returns null when no period accepts time at all.
 */
export function resolveEntryDefaults(params: {
  context: Pick<TimeEntryWorkItemContext, 'startTime' | 'endTime' | 'elapsedTime'>;
  periods: readonly CatalogPeriod[];
  timeZone: string | null | undefined;
  now?: Date;
}): ResolvedEntryDefaults | null {
  const { context, periods, timeZone } = params;
  const now = params.now ?? new Date();

  let suppliedStartTime: Date | undefined = context.startTime;
  let suppliedEndTime: Date | undefined = context.endTime;
  let source: DefaultTimeSource = suppliedStartTime || suppliedEndTime ? 'context' : 'none';

  if (!suppliedStartTime && !suppliedEndTime && context.elapsedTime && context.elapsedTime > 0) {
    suppliedEndTime = now;
    suppliedStartTime = new Date(now.getTime() - context.elapsedTime * 1000);
    source = 'timer';
  }

  if (suppliedStartTime && suppliedEndTime) {
    const startPeriod = periodForWorkDate(periods, workDateInTimeZone(suppliedStartTime, timeZone));
    const endPeriod = periodForWorkDate(periods, workDateInTimeZone(suppliedEndTime, timeZone));
    if (startPeriod && startPeriod === endPeriod && isEditableSheetStatus(startPeriod.timeSheetStatus)) {
      return {
        defaultStartTime: suppliedStartTime,
        defaultEndTime: suppliedEndTime,
        date: suppliedStartTime,
        source,
        moved: { kind: 'none' },
      };
    }
  }

  const today = workDateInTimeZone(now, timeZone);
  const day = nearestEditableWorkDate(periods, today);
  if (!day) {
    return null;
  }

  const defaultStartTime = instantAtZonedTime(day, '08:00', timeZone);
  const defaultEndTime = new Date(defaultStartTime.getTime() + 60 * 60 * 1000);
  let moved: DefaultDateMove = { kind: 'none' };
  if (source !== 'none') {
    moved = { kind: 'supplied', date: day };
  } else if (day !== today) {
    moved = { kind: 'today', date: day, todayStatus: periodForWorkDate(periods, today)?.timeSheetStatus ?? null };
  }

  return { defaultStartTime, defaultEndTime, date: defaultStartTime, source, moved };
}

/** The last day a period covers, derived from the exclusive `end_date`. */
export function periodLastInclusiveDay(endDateExclusive: string): string {
  return Temporal.PlainDate.from(endDateExclusive.slice(0, 10)).subtract({ days: 1 }).toString();
}

/** A date-only ISO string rendered as a local (not UTC-shifted) Date at midnight. */
export function dateOnlyToLocalDate(dateOnly: string): Date {
  return new Date(`${dateOnly.slice(0, 10)}T00:00:00`);
}

/** A Date (local-midnight marker or any instant) as a YYYY-MM-DD calendar date. */
export function dateToPlainDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** Wall-clock time of an instant in a timezone, as HH:mm. */
export function formatZonedTime(value: string | Date, timeZone: string | null | undefined): string {
  const zoned = toInstant(value).toZonedDateTimeISO(normalizeTimeZone(timeZone));
  return `${String(zoned.hour).padStart(2, '0')}:${String(zoned.minute).padStart(2, '0')}`;
}

/** Wall-clock time of an instant in a timezone, as HH:mm:ss. */
export function formatZonedTimeSeconds(value: string | Date, timeZone: string | null | undefined): string {
  const zoned = toInstant(value).toZonedDateTimeISO(normalizeTimeZone(timeZone));
  return `${String(zoned.hour).padStart(2, '0')}:${String(zoned.minute).padStart(2, '0')}:${String(
    zoned.second,
  ).padStart(2, '0')}`;
}

/** The last minute (23:59) of a calendar date in a timezone. */
export function endOfZonedDay(dateOnly: string, timeZone: string | null | undefined): Date {
  return instantAtZonedTime(dateOnly, '23:59:00', timeZone);
}
