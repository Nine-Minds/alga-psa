import { toPlainDate } from './dateTimeUtils';

/**
 * Format a date-only value (PostgreSQL DATE, `YYYY-MM-DD`, or a Date that
 * represents one) as a long calendar date in the given locale, preserving the
 * calendar day. No timezone conversion is applied on purpose: these fields have
 * no time of day, and converting would shift the day.
 */
export function formatLocalizedCalendarDate(
  value: Date | Parameters<typeof toPlainDate>[0],
  locale: string,
): string {
  // Calendar values reach callers as Date objects from more than one query
  // adapter: some encode midnight in the process timezone, while the current
  // pg/Knex path can encode midnight UTC. Preserve the calendar fields that
  // identify each representation before formatting in UTC.
  let calendarDate: string;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Cannot format an invalid calendar date');
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
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
