/**
 * Shared recurring coverage/day-count arithmetic.
 *
 * One implementation is used by both the recurring quantity compute path and
 * the mid-period true-up: the amount is rounded once with the engine's existing
 * coverage convention (`Math.ceil` of the partial amount). Keeping the date
 * helpers and the rounding rule here means the true-up cannot drift from the
 * charge it complements.
 *
 * Date convention: canonical service periods are half-open `[start, end)`.
 * Persisted invoice-detail rows use the legacy *inclusive* last covered day, so
 * an inclusive end is mapped to the following calendar day before it is used as
 * an exclusive end.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True when `value` is a real `YYYY-MM-DD` calendar date. Rejects impossible
 * dates such as 2026-02-30 or 2026-13-01 rather than silently rolling them.
 */
export function isValidDateOnly(value: string | null | undefined): boolean {
  if (!value) return false;
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/** Add calendar days to a real `YYYY-MM-DD` date, returning `YYYY-MM-DD`. */
export function addDaysOnly(day: string, days: number): string {
  if (!isValidDateOnly(day)) {
    throw new Error('A valid calendar date (YYYY-MM-DD) is required.');
  }
  const [year, month, date] = day.split('-').map((part) => Number(part));
  const base = Date.UTC(year, month - 1, date);
  const next = new Date(base + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

/**
 * Convert a legacy inclusive detail end (the last covered day) to the half-open
 * exclusive end (the following day). Returns null for an unparseable value so
 * callers fail loudly rather than silently mis-prorating.
 */
export function inclusiveEndToExclusiveEnd(
  inclusiveEnd: string | null | undefined,
): string | null {
  if (!isValidDateOnly(inclusiveEnd)) return null;
  return addDaysOnly(inclusiveEnd as string, 1);
}

/** Whole calendar days between two real `YYYY-MM-DD` dates (`to − from`). */
export function daysBetweenOnly(from: string, to: string): number {
  if (!isValidDateOnly(from) || !isValidDateOnly(to)) {
    throw new Error('A valid calendar date (YYYY-MM-DD) is required.');
  }
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * The recurring coverage rounding rule: `ceil(ceil(base) × coverageRatio)` with
 * the ratio bounded to `[0, 1]`. Sign is preserved so credits round identically.
 * A zero base or zero ratio is exactly zero.
 */
export function prorateRecurringCoverageByRatio(
  baseMinorUnits: number,
  coverageRatio: number,
): number {
  if (!Number.isFinite(baseMinorUnits) || baseMinorUnits === 0) return 0;
  if (!Number.isFinite(coverageRatio) || coverageRatio <= 0) return 0;
  const ratio = Math.min(1, coverageRatio);
  const sign = baseMinorUnits < 0 ? -1 : 1;
  return sign * Math.ceil(Math.ceil(Math.abs(baseMinorUnits)) * ratio);
}

/**
 * Same rounding rule expressed from covered/full days. Validates the day inputs
 * and that the covered window fits inside the full period.
 */
export function prorateRecurringCoverageByDays(
  baseMinorUnits: number,
  coveredDays: number,
  fullPeriodDays: number,
): number {
  if (!Number.isFinite(fullPeriodDays) || fullPeriodDays <= 0) {
    throw new Error('fullPeriodDays must be greater than zero');
  }
  if (!Number.isFinite(coveredDays) || coveredDays < 0) {
    throw new Error('coveredDays must not be negative');
  }
  if (coveredDays > fullPeriodDays) {
    throw new Error('coveredDays must not exceed fullPeriodDays');
  }
  return prorateRecurringCoverageByRatio(baseMinorUnits, coveredDays / fullPeriodDays);
}
