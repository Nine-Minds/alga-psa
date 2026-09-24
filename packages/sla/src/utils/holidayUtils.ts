import { toCalendarDateString } from '@alga-psa/core';

/** Normalize PostgreSQL DATE values at the boundary where holiday rows are loaded. */
export function normalizeHolidayRows<T extends { holiday_date: string }>(
  holidays: readonly (Omit<T, 'holiday_date'> & { holiday_date: string | Date })[]
): T[] {
  return holidays.flatMap((holiday) => {
    let holidayDate: string | null;
    try {
      holidayDate = toCalendarDateString(holiday.holiday_date);
    } catch {
      holidayDate = null;
    }
    // LEVERAGE: pattern holiday-date-normalize — keep DB DATE conversion local to each loader.
    // A malformed optional holiday must not prevent SLA tracking from starting.
    return holidayDate ? [{ ...holiday, holiday_date: holidayDate } as T] : [];
  });
}
