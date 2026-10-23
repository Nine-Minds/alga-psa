import { toCalendarDisplayDate } from '@alga-psa/core';

/** Formats a holiday's stored calendar date without shifting it across time zones. */
export function formatHolidayDate(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '';

  const date = toCalendarDisplayDate(value);
  return date
    ? date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : String(value);
}
