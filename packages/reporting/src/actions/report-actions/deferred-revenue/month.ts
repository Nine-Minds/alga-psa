/**
 * Month math for the deferred-revenue rollforward.
 *
 * The report reconstructs any historical calendar month from the ledgers, so
 * all boundaries are computed in UTC and compared as YYYY-MM-DD strings.
 */

export interface MonthRange {
  /** 'YYYY-MM' */
  month: string;
  /** 'YYYY-MM-DD' — first calendar day of the month (inclusive). */
  start: string;
  /** 'YYYY-MM-DD' — first calendar day of the next month (exclusive). */
  endExclusive: string;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export function isValidMonth(month: string): boolean {
  if (!MONTH_RE.test(month)) return false;
  const [year, monthIndex] = month.split('-').map(Number);
  return monthIndex >= 1 && monthIndex <= 12 && year >= 1970 && year <= 2100;
}

export function monthRange(month: string): MonthRange {
  if (!isValidMonth(month)) {
    throw new Error(`Validation Error: month must be in YYYY-MM format (got ${month})`);
  }
  const [year, monthIndex] = month.split('-').map(Number);
  const start = `${month}-01`;
  const endDate = new Date(Date.UTC(year, monthIndex, 1)); // next month, day 1
  const endExclusive = endDate.toISOString().slice(0, 10);
  return { month, start, endExclusive };
}

export function nextMonth(month: string): string {
  return monthRange(month).endExclusive.slice(0, 7);
}

export function previousMonth(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  const prev = new Date(Date.UTC(year, monthIndex - 2, 1));
  return prev.toISOString().slice(0, 7);
}

/** Calendar month key ('YYYY-MM') for a YYYY-MM-DD or ISO date string. */
export function monthKeyOf(dateString: string): string {
  const dateOnly = dateString.slice(0, 10);
  if (dateOnly.length !== 10) {
    return dateOnly.slice(0, 7);
  }
  return dateOnly.slice(0, 7);
}

export function defaultReportMonth(now: Date = new Date()): string {
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return previous.toISOString().slice(0, 7);
}
