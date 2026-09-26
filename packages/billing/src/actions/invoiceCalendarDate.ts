import { dateValueToDate } from '@alga-psa/core';

/** Format an invoice SQL DATE without shifting it into the process timezone. */
export function formatInvoiceCalendarDate(
  value: Date | Parameters<typeof dateValueToDate>[0],
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(value instanceof Date ? value : dateValueToDate(value));
}
