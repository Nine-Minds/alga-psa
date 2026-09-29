const DATE_ONLY_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/;

function formatLocalDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Calendar date as 'yyyy-MM-dd' for the clients.client_since DATE column; empty
 * clears it. pg hands DATE columns back as local-midnight Dates, so local parts
 * name the stored day — handing the Date itself to a writer lets the database
 * session timezone cast it to the day before. Returns undefined for anything
 * that is not a date, leaving each caller to decide how loudly to fail.
 */
export function toClientSinceDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : formatLocalDate(value);
  }
  if (typeof value !== 'string') return undefined;

  const match = DATE_ONLY_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const dateOnly = match[1];
  const parsed = new Date(`${dateOnly}T00:00:00`);
  // Rejects the calendar-shaped impossibilities (2015-02-30) that the parser
  // would otherwise roll forward into March.
  return Number.isNaN(parsed.getTime()) || formatLocalDate(parsed) !== dateOnly ? undefined : dateOnly;
}

export const CLIENT_SINCE_FORMAT_MESSAGE = 'Client since must be a date in YYYY-MM-DD form';

/**
 * The 'yyyy-MM-dd' a date picker should show for a client_since that came back
 * from a server action. Only a date-only string names a calendar day in the
 * browser: a Date built from a DATE column carries the server's midnight, which
 * a browser west of the server reads as the day before, so it is refused here.
 */
export function clientSinceInputValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = DATE_ONLY_PATTERN.exec(value.trim());
  return match ? match[1] : '';
}

/**
 * Normalizes client_since on a row leaving a server action. The driver builds
 * the Date at the server's midnight, and the browser would read that Date with
 * its own timezone — a day early whenever the server runs ahead of the user
 * (containers default to UTC, most users are west of it). Past this boundary
 * the calendar date only ever travels as 'yyyy-MM-dd'.
 */
export function withClientSinceDateString<T extends Record<string, any>>(row: T): T {
  if (!row || !('client_since' in row)) return row;
  return { ...row, client_since: toClientSinceDate(row.client_since) ?? null };
}
