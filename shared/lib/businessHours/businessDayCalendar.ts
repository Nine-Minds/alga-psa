/**
 * Business-day classification — extracted from the workflow business-day scheduling so workflows and
 * recurring tickets share one definition of "is this a business day".
 *
 * Classification order (unchanged from the original workflow logic):
 *   1. a holiday (one-time date match, or month/day match for recurring holidays) → non-business
 *   2. a 24x7 schedule → business
 *   3. otherwise the enabled `business_hours_entries` row for that weekday → business
 *
 * This file is pure (no DB access). The tenant loader lives in `loadBusinessDayCalendar.ts`.
 */
import { toCalendarDateString } from '@alga-psa/core';

export type DayClassification = 'business' | 'non_business';

export interface BusinessDayEntryInput {
  /** 0 = Sunday … 6 = Saturday */
  day_of_week: number;
  is_enabled: boolean;
}

export interface BusinessDayHolidayInput {
  holiday_date: string | Date;
  is_recurring: boolean;
}

/** The data needed to classify a day. Row types from the DB satisfy this structurally. */
export interface BusinessDayCalendarSpec {
  is24x7: boolean;
  entries: readonly BusinessDayEntryInput[];
  holidays: readonly BusinessDayHolidayInput[];
}

export interface LocalDateInfo {
  /** `YYYY-MM-DD` */
  localDate: string;
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** Calendar date and weekday of `instant` as seen in `timezone` (host timezone is never used). */
export function toLocalDateInfo(instant: Date, timezone: string): LocalDateInfo {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(instant);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  const weekday = (parts.find((part) => part.type === 'weekday')?.value ?? 'Sun').toLowerCase().slice(0, 3);
  return {
    localDate: `${year}-${month}-${day}`,
    dayOfWeek: WEEKDAY_TO_INDEX[weekday] ?? 0,
  };
}

/** Weekday (0 = Sunday) of a calendar date. Pure date arithmetic, host-timezone independent. */
export function dayOfWeekForDate(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function normalizeHolidayDate(value: string | Date): string {
  try {
    return toCalendarDateString(value) ?? '';
  } catch {
    return '';
  }
}

export function isHolidayForLocalDate(holidays: readonly BusinessDayHolidayInput[], localDate: string): boolean {
  const monthDay = localDate.slice(5);
  return holidays.some((holiday) => {
    const holidayDate = normalizeHolidayDate(holiday.holiday_date);
    return holiday.is_recurring ? holidayDate.slice(5) === monthDay : holidayDate === localDate;
  });
}

/** Classifies a local calendar date. */
export function classifyLocalDate(
  info: LocalDateInfo,
  spec: BusinessDayCalendarSpec
): DayClassification {
  if (isHolidayForLocalDate(spec.holidays, info.localDate)) {
    return 'non_business';
  }
  if (spec.is24x7) {
    return 'business';
  }
  const entry = spec.entries.find((candidate) => candidate.day_of_week === info.dayOfWeek);
  if (!entry || !entry.is_enabled) {
    return 'non_business';
  }
  return 'business';
}

/** Classifies the local day on which `instant` falls in `classificationTimezone`. */
export function classifyInstant(
  instant: Date,
  classificationTimezone: string,
  spec: BusinessDayCalendarSpec
): DayClassification {
  return classifyLocalDate(toLocalDateInfo(instant, classificationTimezone), spec);
}

/** Where a calendar's rules came from — surfaced in the recurring-ticket editor. */
export type BusinessDayCalendarSource = 'default_schedule' | 'fallback';

export interface BusinessDayCalendar {
  source: BusinessDayCalendarSource;
  /** Name of the default business-hours schedule; null for the fallback calendar. */
  scheduleName: string | null;
  timezone: string | null;
  isBusinessDay(localDate: string): boolean;
}

/** Calendar over a `YYYY-MM-DD` date, built from a schedule's rows. */
export function createBusinessDayCalendar(
  spec: BusinessDayCalendarSpec,
  meta: { source: BusinessDayCalendarSource; scheduleName: string | null; timezone: string | null }
): BusinessDayCalendar {
  return {
    ...meta,
    isBusinessDay(localDate: string): boolean {
      return (
        classifyLocalDate({ localDate, dayOfWeek: dayOfWeekForDate(localDate) }, spec) === 'business'
      );
    },
  };
}

/** Monday–Friday enabled, Saturday/Sunday not. */
export const MONDAY_TO_FRIDAY_ENTRIES: readonly BusinessDayEntryInput[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day_of_week: day,
  is_enabled: day >= 1 && day <= 5,
}));

/**
 * Fallback for tenants without a default business-hours schedule: Mon–Fri plus whatever tenant-wide
 * holidays exist. Only the recurring-ticket caller uses this; the workflow caller keeps its
 * "schedule required" validation.
 */
export function buildFallbackBusinessDayCalendar(
  holidays: readonly BusinessDayHolidayInput[] = []
): BusinessDayCalendar {
  return createBusinessDayCalendar(
    { is24x7: false, entries: MONDAY_TO_FRIDAY_ENTRIES, holidays },
    { source: 'fallback', scheduleName: null, timezone: null }
  );
}
