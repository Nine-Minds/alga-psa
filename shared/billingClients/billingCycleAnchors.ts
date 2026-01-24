import { Temporal } from '@js-temporal/polyfill';
import { parseISO } from 'date-fns';
import type { BillingCycleType, ISO8601String } from '@alga-psa/types';

export type BillingCycleAnchorSettingsInput = {
  dayOfMonth?: number | null;
  monthOfYear?: number | null;
  dayOfWeek?: number | null; // ISO 1=Mon..7=Sun
  referenceDate?: ISO8601String | null; // UTC-midnight, establishes bi-weekly parity
};

export type NormalizedBillingCycleAnchorSettings = {
  dayOfMonth: number | null;
  monthOfYear: number | null;
  dayOfWeek: number | null;
  referenceDate: ISO8601String | null;
};

export function ensureUtcMidnightIsoDate(input: string): ISO8601String {
  if (typeof input !== 'string') {
    throw new Error('Date must be a string');
  }
  const parsed = parseISO(input);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCHours() !== 0 ||
    parsed.getUTCMinutes() !== 0 ||
    parsed.getUTCSeconds() !== 0 ||
    parsed.getUTCMilliseconds() !== 0
  ) {
    throw new Error(`Date must be UTC midnight. Got: ${input}`);
  }

  // Normalize to a consistent `YYYY-MM-DDT00:00:00Z` format.
  const iso = parsed.toISOString();
  const datePart = iso.split('T')[0];
  return `${datePart}T00:00:00Z` as ISO8601String;
}

export function getAnchorDefaultsForCycle(
  billingCycle: BillingCycleType
): NormalizedBillingCycleAnchorSettings {
  switch (billingCycle) {
    case 'weekly':
    case 'bi-weekly':
      // Preserve historical "rolling" behavior unless an admin explicitly anchors.
      return { dayOfMonth: null, monthOfYear: null, dayOfWeek: null, referenceDate: null };
    case 'monthly':
      return { dayOfMonth: 1, monthOfYear: null, dayOfWeek: null, referenceDate: null };
    case 'quarterly':
    case 'semi-annually':
    case 'annually':
      return { dayOfMonth: 1, monthOfYear: 1, dayOfWeek: null, referenceDate: null };
    default:
      return { dayOfMonth: 1, monthOfYear: null, dayOfWeek: null, referenceDate: null };
  }
}

export function validateAnchorSettingsForCycle(
  billingCycle: BillingCycleType,
  input: BillingCycleAnchorSettingsInput
): void {
  const defaults = getAnchorDefaultsForCycle(billingCycle);
  const dayOfMonth = input.dayOfMonth ?? defaults.dayOfMonth;
  const monthOfYear = input.monthOfYear ?? defaults.monthOfYear;
  const dayOfWeek = input.dayOfWeek ?? defaults.dayOfWeek;
  const referenceDate = input.referenceDate ?? defaults.referenceDate;

  switch (billingCycle) {
    case 'weekly': {
      if (dayOfWeek === null || dayOfWeek === undefined) {
        // Allow clearing weekly anchor back to rolling schedule.
        return;
      }
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
        throw new Error('Weekly anchor must include dayOfWeek in range 1..7');
      }
      return;
    }
    case 'bi-weekly': {
      if (referenceDate === null || referenceDate === undefined) {
        // Allow clearing back to rolling schedule.
        return;
      }
      ensureUtcMidnightIsoDate(referenceDate);
      return;
    }
    case 'monthly': {
      if (dayOfMonth === null || dayOfMonth === undefined) {
        throw new Error('Monthly anchor must include dayOfMonth');
      }
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
        throw new Error('Monthly anchor dayOfMonth must be in range 1..28');
      }
      return;
    }
    case 'quarterly':
    case 'semi-annually':
    case 'annually': {
      if (monthOfYear === null || monthOfYear === undefined) {
        throw new Error('Anchored cycles must include monthOfYear');
      }
      if (!Number.isInteger(monthOfYear) || monthOfYear < 1 || monthOfYear > 12) {
        throw new Error('monthOfYear must be in range 1..12');
      }
      if (dayOfMonth === null || dayOfMonth === undefined) {
        throw new Error('Anchored cycles must include dayOfMonth');
      }
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
        throw new Error('dayOfMonth must be in range 1..28');
      }
      return;
    }
  }
}

export function normalizeAnchorSettingsForCycle(
  billingCycle: BillingCycleType,
  input: BillingCycleAnchorSettingsInput
): NormalizedBillingCycleAnchorSettings {
  const defaults = getAnchorDefaultsForCycle(billingCycle);
  const normalized: NormalizedBillingCycleAnchorSettings = {
    dayOfMonth: input.dayOfMonth ?? defaults.dayOfMonth,
    monthOfYear: input.monthOfYear ?? defaults.monthOfYear,
    dayOfWeek: input.dayOfWeek ?? defaults.dayOfWeek,
    referenceDate: input.referenceDate ?? defaults.referenceDate,
  };

  validateAnchorSettingsForCycle(billingCycle, normalized);

  if (normalized.referenceDate) {
    normalized.referenceDate = ensureUtcMidnightIsoDate(normalized.referenceDate);
  }

  return normalized;
}

function toPlainDate(date: ISO8601String): Temporal.PlainDate {
  const d = ensureUtcMidnightIsoDate(date);
  return Temporal.PlainDate.from(d.slice(0, 10));
}

function toUtcMidnightIso(date: Temporal.PlainDate): ISO8601String {
  return `${date.toString()}T00:00:00Z` as ISO8601String;
}

function epochDay(date: Temporal.PlainDate): number {
  return date.toZonedDateTime({ timeZone: 'UTC', plainTime: '00:00' }).epochSeconds / 86400;
}

function monthsPerCycleFor(cycle: BillingCycleType): number {
  switch (cycle) {
    case 'quarterly':
      return 3;
    case 'semi-annually':
      return 6;
    case 'annually':
      return 12;
    default:
      return 1;
  }
}

function addCycle(date: Temporal.PlainDate, cycle: BillingCycleType): Temporal.PlainDate {
  switch (cycle) {
    case 'weekly':
      return date.add({ days: 7 });
    case 'bi-weekly':
      return date.add({ days: 14 });
    case 'monthly':
      return date.add({ months: 1 });
    case 'quarterly':
      return date.add({ months: 3 });
    case 'semi-annually':
      return date.add({ months: 6 });
    case 'annually':
      return date.add({ years: 1 });
  }
}

function latestBoundaryInYearAtOrBefore(params: {
  year: number;
  date: Temporal.PlainDate;
  baseMonth: number;
  baseDay: number;
  monthsPerCycle: number;
}): Temporal.PlainDate | null {
  const { year, date, baseMonth, baseDay, monthsPerCycle } = params;
  const boundaries: Temporal.PlainDate[] = [];

  for (let month = baseMonth; month <= 12; month += monthsPerCycle) {
    boundaries.push(Temporal.PlainDate.from({ year, month, day: baseDay }));
  }

  const eligible = boundaries.filter((b) => Temporal.PlainDate.compare(b, date) <= 0);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => Temporal.PlainDate.compare(a, b));
  return eligible[eligible.length - 1];
}

export function getBillingPeriodForDate(
  date: ISO8601String,
  billingCycle: BillingCycleType,
  anchor: NormalizedBillingCycleAnchorSettings
): { periodStartDate: ISO8601String; periodEndDate: ISO8601String } {
  const datePlain = toPlainDate(date);

  // For rolling schedules, we interpret the current "period" as starting at the provided date.
  if ((billingCycle === 'weekly' && !anchor.dayOfWeek) || (billingCycle === 'bi-weekly' && !anchor.referenceDate)) {
    const start = datePlain;
    const end = addCycle(start, billingCycle);
    return { periodStartDate: toUtcMidnightIso(start), periodEndDate: toUtcMidnightIso(end) };
  }

  const start = getPreviousBillingBoundaryAtOrBefore(datePlain, billingCycle, anchor);
  const end = getNextBillingBoundaryAfterPlain(start, billingCycle, anchor);
  return { periodStartDate: toUtcMidnightIso(start), periodEndDate: toUtcMidnightIso(end) };
}

export function getNextBillingBoundaryAfter(
  fromDate: ISO8601String,
  billingCycle: BillingCycleType,
  anchor: NormalizedBillingCycleAnchorSettings
): ISO8601String {
  const fromPlain = toPlainDate(fromDate);

  // For rolling schedules, treat `fromDate` as a boundary and advance by the cycle length.
  if ((billingCycle === 'weekly' && !anchor.dayOfWeek) || (billingCycle === 'bi-weekly' && !anchor.referenceDate)) {
    return toUtcMidnightIso(addCycle(fromPlain, billingCycle));
  }

  return toUtcMidnightIso(getNextBillingBoundaryAfterPlain(fromPlain, billingCycle, anchor));
}

function getPreviousBillingBoundaryAtOrBefore(
  date: Temporal.PlainDate,
  billingCycle: BillingCycleType,
  anchor: NormalizedBillingCycleAnchorSettings
): Temporal.PlainDate {
  switch (billingCycle) {
    case 'weekly': {
      if (!anchor.dayOfWeek) {
        return date;
      }
      const delta = (date.dayOfWeek - anchor.dayOfWeek + 7) % 7;
      return date.subtract({ days: delta });
    }
    case 'bi-weekly': {
      if (!anchor.referenceDate) {
        return date;
      }
      const ref = toPlainDate(anchor.referenceDate);
      const diff = epochDay(date) - epochDay(ref);
      const steps = Math.floor(diff / 14);
      return ref.add({ days: steps * 14 });
    }
    case 'monthly': {
      const day = anchor.dayOfMonth ?? 1;
      if (date.day >= day) {
        return Temporal.PlainDate.from({ year: date.year, month: date.month, day });
      }
      const prevMonth = date.subtract({ months: 1 });
      return Temporal.PlainDate.from({ year: prevMonth.year, month: prevMonth.month, day });
    }
    case 'quarterly':
    case 'semi-annually':
    case 'annually': {
      const monthsPerCycle = monthsPerCycleFor(billingCycle);
      const baseMonth = anchor.monthOfYear ?? 1;
      const baseDay = anchor.dayOfMonth ?? 1;

      const inYear = latestBoundaryInYearAtOrBefore({ year: date.year, date, baseMonth, baseDay, monthsPerCycle });
      if (inYear) return inYear;

      const previousYear = date.subtract({ years: 1 });
      const prevYearLast = latestBoundaryInYearAtOrBefore({
        year: previousYear.year,
        date: Temporal.PlainDate.from({ year: previousYear.year, month: 12, day: 28 }),
        baseMonth,
        baseDay,
        monthsPerCycle
      });
      if (!prevYearLast) {
        return Temporal.PlainDate.from({ year: previousYear.year, month: baseMonth, day: baseDay });
      }
      return prevYearLast;
    }
  }
}

function getNextBillingBoundaryAfterPlain(
  fromDate: Temporal.PlainDate,
  billingCycle: BillingCycleType,
  anchor: NormalizedBillingCycleAnchorSettings
): Temporal.PlainDate {
  switch (billingCycle) {
    case 'weekly': {
      if (!anchor.dayOfWeek) {
        return addCycle(fromDate, billingCycle);
      }
      const dayOfWeek = anchor.dayOfWeek;
      const next = fromDate.add({ days: 1 });
      const delta = (dayOfWeek - next.dayOfWeek + 7) % 7;
      return next.add({ days: delta });
    }
    case 'bi-weekly': {
      if (!anchor.referenceDate) {
        return addCycle(fromDate, billingCycle);
      }
      return fromDate.add({ days: 14 });
    }
    case 'monthly': {
      const day = anchor.dayOfMonth ?? 1;
      const nextMonth = fromDate.add({ months: 1 });
      return Temporal.PlainDate.from({ year: nextMonth.year, month: nextMonth.month, day });
    }
    case 'quarterly':
    case 'semi-annually':
    case 'annually': {
      const monthsPerCycle = monthsPerCycleFor(billingCycle);
      const baseDay = anchor.dayOfMonth ?? 1;
      const baseMonth = anchor.monthOfYear ?? 1;

      const current = fromDate;
      const step = current.add({ months: monthsPerCycle });

      // Ensure the boundary aligns to the baseMonth within the year for multi-month cycles.
      const monthIndex = (step.month - baseMonth + 12) % monthsPerCycle;
      const aligned = step.subtract({ months: monthIndex });
      return Temporal.PlainDate.from({ year: aligned.year, month: aligned.month, day: baseDay });
    }
  }
}
