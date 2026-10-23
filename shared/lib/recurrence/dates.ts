/**
 * Calendar-date helpers. Dates are `YYYY-MM-DD` strings; arithmetic goes through UTC midnight so the
 * host timezone can never shift a date.
 */

export function parseDateString(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid date "${date}": expected YYYY-MM-DD`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function dateStringToUtcMs(date: string): number {
  const { year, month, day } = parseDateString(date);
  return Date.UTC(year, month - 1, day);
}

export function utcMsToDateString(ms: number): string {
  const d = new Date(ms);
  return (
    String(d.getUTCFullYear()).padStart(4, '0') +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0')
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: string, days: number): string {
  return utcMsToDateString(dateStringToUtcMs(date) + days * DAY_MS);
}

export function compareDates(a: string, b: string): number {
  // YYYY-MM-DD strings sort lexicographically
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 0 = Sunday … 6 = Saturday, matching `business_hours_entries.day_of_week`. */
export function dayOfWeek(date: string): number {
  return new Date(dateStringToUtcMs(date)).getUTCDay();
}
