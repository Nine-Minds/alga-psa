import { Temporal } from '@js-temporal/polyfill';
import { parseISO } from 'date-fns';
import type { BillingCycleType } from 'server/src/interfaces/billing.interfaces';
import type { ISO8601String } from 'server/src/types/types.d';

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
        throw new Error(`${billingCycle} anchor must include monthOfYear`);
      }
      if (!Number.isInteger(monthOfYear) || monthOfYear < 1 || monthOfYear > 12) {
        throw new Error(`${billingCycle} anchor monthOfYear must be in range 1..12`);
      }
      if (dayOfMonth === null || dayOfMonth === undefined) {
        throw new Error(`${billingCycle} anchor must include dayOfMonth`);
      }
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
        throw new Error(`${billingCycle} anchor dayOfMonth must be in range 1..28`);
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
  const dayOfMonth = input.dayOfMonth ?? defaults.dayOfMonth;
  const monthOfYear = input.monthOfYear ?? defaults.monthOfYear;
  const dayOfWeek = input.dayOfWeek ?? defaults.dayOfWeek;
  const referenceDate = input.referenceDate ?? defaults.referenceDate;

  switch (billingCycle) {
    case 'weekly':
      return {
        dayOfMonth: null,
        monthOfYear: null,
        dayOfWeek: dayOfWeek ?? null,
        referenceDate: null
      };
    case 'bi-weekly':
      return {
        dayOfMonth: null,
        monthOfYear: null,
        dayOfWeek: null,
        referenceDate: referenceDate ? ensureUtcMidnightIsoDate(referenceDate) : null
      };
    case 'monthly':
      return {
        dayOfMonth: dayOfMonth ?? 1,
        monthOfYear: null,
        dayOfWeek: null,
        referenceDate: null
      };
    case 'quarterly':
    case 'semi-annually':
    case 'annually':
      return {
        dayOfMonth: dayOfMonth ?? 1,
        monthOfYear: monthOfYear ?? 1,
        dayOfWeek: null,
        referenceDate: null
      };
  }
}

export type BillingPeriodRange = {
  periodStartDate: ISO8601String;
  periodEndDate: ISO8601String;
};

export function getBillingPeriodForDate(
  referenceDate: ISO8601String,
  billingCycle: BillingCycleType,
  anchor: NormalizedBillingCycleAnchorSettings
): BillingPeriodRange {
  const datePlain = toPlainDate(referenceDate);

  if ((billingCycle === 'weekly' && !anchor.dayOfWeek) || (billingCycle === 'bi-weekly' && !anchor.referenceDate)) {
    // Rolling behavior: "current period" begins at the reference date itself.
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

  // For rolling schedules, we treat `fromDate` as a boundary and advance by the cycle length.
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

      // Find the latest boundary <= date in the current year, else fall back to last boundary in previous year.
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
        // Should be unreachable because baseMonth/baseDay are valid.
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
        return fromDate.add({ days: 7 });
      }
      const rawDelta = (anchor.dayOfWeek - fromDate.dayOfWeek + 7) % 7;
      const delta = rawDelta === 0 ? 7 : rawDelta;
      return fromDate.add({ days: delta });
    }
    case 'bi-weekly': {
      if (!anchor.referenceDate) {
        return fromDate.add({ days: 14 });
      }
      const ref = toPlainDate(anchor.referenceDate);
      const diff = epochDay(fromDate) - epochDay(ref);
      const steps = Math.floor(diff / 14) + 1; // strictly after
      return ref.add({ days: steps * 14 });
    }
    case 'monthly': {
      const day = anchor.dayOfMonth ?? 1;
      const boundaryThisMonth = Temporal.PlainDate.from({ year: fromDate.year, month: fromDate.month, day });
      if (Temporal.PlainDate.compare(boundaryThisMonth, fromDate) > 0) {
        return boundaryThisMonth;
      }
      const nextMonth = fromDate.add({ months: 1 });
      return Temporal.PlainDate.from({ year: nextMonth.year, month: nextMonth.month, day });
    }
    case 'quarterly':
    case 'semi-annually':
    case 'annually': {
      const monthsPerCycle = monthsPerCycleFor(billingCycle);
      const baseMonth = anchor.monthOfYear ?? 1;
      const baseDay = anchor.dayOfMonth ?? 1;

      const candidates = listBoundariesInYear(fromDate.year, baseMonth, baseDay, monthsPerCycle);
      for (const boundary of candidates) {
        if (Temporal.PlainDate.compare(boundary, fromDate) > 0) {
          return boundary;
        }
      }
      // First boundary in next year.
      return Temporal.PlainDate.from({ year: fromDate.year + 1, month: baseMonth, day: baseDay });
    }
  }
}

function monthsPerCycleFor(billingCycle: 'quarterly' | 'semi-annually' | 'annually'): number {
  switch (billingCycle) {
    case 'quarterly':
      return 3;
    case 'semi-annually':
      return 6;
    case 'annually':
      return 12;
  }
}

function listBoundariesInYear(
  year: number,
  baseMonth: number,
  baseDay: number,
  monthsPerCycle: number
): Temporal.PlainDate[] {
  const boundaries: Temporal.PlainDate[] = [];
  for (let month = baseMonth; month <= 12; month += monthsPerCycle) {
    boundaries.push(Temporal.PlainDate.from({ year, month, day: baseDay }));
  }
  return boundaries;
}

function latestBoundaryInYearAtOrBefore(params: {
  year: number;
  date: Temporal.PlainDate;
  baseMonth: number;
  baseDay: number;
  monthsPerCycle: number;
}): Temporal.PlainDate | null {
  const boundaries = listBoundariesInYear(params.year, params.baseMonth, params.baseDay, params.monthsPerCycle);
  let latest: Temporal.PlainDate | null = null;
  for (const boundary of boundaries) {
    if (Temporal.PlainDate.compare(boundary, params.date) <= 0) {
      latest = boundary;
    }
  }
  return latest;
}

function addCycle(from: Temporal.PlainDate, billingCycle: BillingCycleType): Temporal.PlainDate {
  switch (billingCycle) {
    case 'weekly':
      return from.add({ days: 7 });
    case 'bi-weekly':
      return from.add({ days: 14 });
    case 'monthly':
      return from.add({ months: 1 });
    case 'quarterly':
      return from.add({ months: 3 });
    case 'semi-annually':
      return from.add({ months: 6 });
    case 'annually':
      return from.add({ years: 1 });
  }
}

function toPlainDate(isoDate: ISO8601String): Temporal.PlainDate {
  return Temporal.PlainDate.from(isoDate.slice(0, 10));
}

function toUtcMidnightIso(date: Temporal.PlainDate): ISO8601String {
  return `${date.toString()}T00:00:00Z` as ISO8601String;
}

function epochDay(date: Temporal.PlainDate): number {
  // 1970-01-01 = 0.
  const epoch = Temporal.PlainDate.from('1970-01-01');
  return epoch.until(date, { largestUnit: 'days' }).days;
}

