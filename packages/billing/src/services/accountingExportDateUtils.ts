/**
 * Accounting service periods are calendar dates, even though legacy columns
 * store them as timestamptz. Normalize every representation to UTC midnight so
 * tenant-local midnight offsets do not create false projection drift.
 */
export function normalizeAccountingExportCalendarDate(
  value: unknown
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const datePrefix = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/)?.[1];
    if (datePrefix) {
      return `${datePrefix}T00:00:00.000Z`;
    }
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
}
