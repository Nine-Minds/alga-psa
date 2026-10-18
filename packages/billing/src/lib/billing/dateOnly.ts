/**
 * Small pure helpers for `YYYY-MM-DD` calendar dates.
 *
 * Kept dependency-free so both the contract-line window validator (which also
 * reads the database) and the discount authoring rules can share one definition
 * of "is this a real calendar date".
 */

/** True when `value` is a real `YYYY-MM-DD` calendar date. */
export function isValidDateOnly(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Adds whole days to a valid `YYYY-MM-DD` date, returning `YYYY-MM-DD`. */
export function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Normalizes a date-ish value (Date, ISO timestamp, date-only) to a valid
 * `YYYY-MM-DD`, or null when it is not a real calendar date.
 */
export function toDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  return isValidDateOnly(match[1]) ? match[1] : null;
}
