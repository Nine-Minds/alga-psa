import { toPlainDate } from '@alga-psa/core';

/** Format a PostgreSQL DATE while preserving its calendar day at action boundaries. */
export function formatInvoiceCalendarDate(
  value: Date | Parameters<typeof toPlainDate>[0],
  locale: string,
): string {
  // Invoice calendar values reach this action as Date objects from more than
  // one query adapter: some encode midnight in the process timezone, while the
  // current pg/Knex path can encode midnight UTC. Preserve the calendar fields
  // that identify each representation before formatting in UTC.
  let calendarDate: string;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Cannot format an invalid invoice calendar date');
    }
    const isUtcMidnight = value.getUTCHours() === 0
      && value.getUTCMinutes() === 0
      && value.getUTCSeconds() === 0
      && value.getUTCMilliseconds() === 0;
    const year = isUtcMidnight ? value.getUTCFullYear() : value.getFullYear();
    const month = (isUtcMidnight ? value.getUTCMonth() : value.getMonth()) + 1;
    const day = isUtcMidnight ? value.getUTCDate() : value.getDate();
    calendarDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  } else {
    calendarDate = toPlainDate(value).toString();
  }
  const [year, month, day] = calendarDate.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
