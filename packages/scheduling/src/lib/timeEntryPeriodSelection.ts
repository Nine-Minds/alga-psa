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

export type DefaultTimeSource = 'none' | 'context' | 'timer';

export interface ResolvedEntryDefaults {
  /** Explicit defaults to hand the provider; always present so ad-hoc/schedule rows cannot override the period choice. */
  defaultStartTime: Date;
  defaultEndTime: Date;
  /** Base date used when no explicit defaults applied; always inside the period. */
  date: Date;
  /** Where the supplied timestamps came from, if any. */
  source: DefaultTimeSource;
  /** True when supplied timestamps existed but were dropped because they fell outside the period. */
  adjusted: boolean;
  suppliedStartTime?: Date;
  suppliedEndTime?: Date;
}

/**
 * Rebase a new entry's timestamps onto the selected period. Supplied
 * context/timer timestamps are kept only when BOTH endpoints land inside the
 * period; otherwise the entry starts on the period's first day at 08:00–09:00
 * in the subject user's timezone. Clear the pair together so the provider can
 * never fall back to an out-of-period date.
 */
export function resolveEntryDefaults(params: {
  context: Pick<TimeEntryWorkItemContext, 'startTime' | 'endTime' | 'elapsedTime'>;
  period: Pick<ITimePeriodView, 'start_date' | 'end_date'>;
  timeZone: string | null | undefined;
}): ResolvedEntryDefaults {
  const { context, period, timeZone } = params;

  let suppliedStartTime: Date | undefined = context.startTime;
  let suppliedEndTime: Date | undefined = context.endTime;
  let source: DefaultTimeSource = suppliedStartTime || suppliedEndTime ? 'context' : 'none';

  if (!suppliedStartTime && !suppliedEndTime && context.elapsedTime && context.elapsedTime > 0) {
    const end = new Date();
    const start = new Date(end.getTime() - context.elapsedTime * 1000);
    suppliedStartTime = start;
    suppliedEndTime = end;
    source = 'timer';
  }

  if (
    suppliedStartTime &&
    suppliedEndTime &&
    isWithinPeriod(suppliedStartTime, period, timeZone) &&
    isWithinPeriod(suppliedEndTime, period, timeZone)
  ) {
    return {
      defaultStartTime: suppliedStartTime,
      defaultEndTime: suppliedEndTime,
      date: suppliedStartTime,
      source,
      adjusted: false,
    };
  }

  const periodFirstDayStart = instantAtZonedTime(period.start_date, '08:00', timeZone);
  const periodFirstDayEnd = new Date(periodFirstDayStart.getTime() + 60 * 60 * 1000);

  return {
    defaultStartTime: periodFirstDayStart,
    defaultEndTime: periodFirstDayEnd,
    date: periodFirstDayStart,
    source,
    adjusted: source !== 'none',
    suppliedStartTime,
    suppliedEndTime,
  };
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
