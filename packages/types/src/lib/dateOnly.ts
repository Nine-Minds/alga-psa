/** Normalize a Postgres date Date or ISO datetime to its calendar date. */
export function normalizeDateOnly(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid date-only value');
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(value);
  if (!match) throw new Error(`Invalid date-only value: ${value}`);
  return match[1];
}

/**
 * Non-throwing variant of `normalizeDateOnly`: returns null for null/undefined, empty, invalid or
 * unparseable input (and for non-string/non-Date values). `Date` values (e.g. pg DATE columns,
 * which node-postgres returns at local midnight) keep their local calendar date.
 */
export function tryNormalizeDateOnly(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : normalizeDateOnly(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return normalizeDateOnly(trimmed);
  } catch {
    return null;
  }
}
