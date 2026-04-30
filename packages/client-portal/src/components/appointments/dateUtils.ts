import { fromZonedTime } from 'date-fns-tz';

/** Safely convert a PG DATE (Date object or ISO-ish string) to YYYY-MM-DD. */
export function normalizeDateValue(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'string') return value.slice(0, 10);
  return null;
}

/** Safely convert a PG TIME ("HH:MM:SS") to HH:MM. */
export function normalizeTimeValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 5);
  return null;
}

/**
 * Combine a PG DATE + PG TIME stored in `timezone` into a `Date` in browser TZ.
 * Returns null if any part is missing or unparseable.
 */
export function toBrowserDate(
  date: unknown,
  time: unknown,
  timezone?: string | null,
): Date | null {
  const d = normalizeDateValue(date);
  const t = normalizeTimeValue(time);
  if (!d || !t) return null;
  try {
    const dt = fromZonedTime(`${d}T${t}:00`, timezone || 'UTC');
    return isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
}
