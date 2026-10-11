import { Temporal } from '@js-temporal/polyfill';

/**
 * Conversion between the stored time period convention and what the
 * Create/Edit Time Period dialog shows.
 *
 * Time periods are stored as half-open intervals `[start_date, end_date)`:
 * `end_date` is the first day AFTER the period. The dialog shows and accepts
 * the LAST INCLUDED day. This module is the only place that converts.
 *
 * Pure: no React, no I/O.
 */

type DateLike = Temporal.PlainDate | string;

export type DialogPeriodError = 'startDateRequired' | 'startAfterEnd' | 'overlap';

function toPlain(value: DateLike): Temporal.PlainDate {
  if (value instanceof Temporal.PlainDate) return value;
  // Accepts both YYYY-MM-DD and full ISO timestamps.
  return Temporal.PlainDate.from(value.slice(0, 10));
}

/** Stored exclusive end -> last day included in the period. */
export function exclusiveEndToLastIncludedDay(end: DateLike): Temporal.PlainDate {
  return toPlain(end).subtract({ days: 1 });
}

/** Last day included in the period -> stored exclusive end. */
export function lastIncludedDayToExclusiveEnd(day: Temporal.PlainDate): Temporal.PlainDate {
  return day.add({ days: 1 });
}

/** Formats a stored exclusive end (YYYY-MM-DD or ISO timestamp) as the last included day (YYYY-MM-DD). */
export function formatPeriodLastDay(end: string): string {
  return exclusiveEndToLastIncludedDay(end).toString();
}

/** Edit load and suggester prefill: stored period -> dialog values. */
export function toDialogDates(period: { start_date: DateLike; end_date: DateLike }): {
  startDate: Temporal.PlainDate;
  lastDay: Temporal.PlainDate;
} {
  return {
    startDate: toPlain(period.start_date),
    lastDay: exclusiveEndToLastIncludedDay(period.end_date),
  };
}

/** Save payload: dialog values -> stored period (string dates). */
export function toStoredPeriod(dialog: {
  startDate: Temporal.PlainDate;
  lastDay: Temporal.PlainDate;
}): { start_date: string; end_date: string } {
  return {
    start_date: dialog.startDate.toString(),
    end_date: lastIncludedDayToExclusiveEnd(dialog.lastDay).toString(),
  };
}

/**
 * Validates dialog values against existing (stored, exclusive-end) periods.
 * A one-day period (startDate == lastDay) is valid. Periods that touch
 * (new start == existing exclusive end) are allowed.
 */
export function validateDialogPeriod(
  dialog: { startDate: Temporal.PlainDate | null; lastDay: Temporal.PlainDate | null },
  existing: ReadonlyArray<{ period_id?: string; start_date: DateLike; end_date?: DateLike | null }>,
  excludeId?: string
): DialogPeriodError | null {
  const { startDate, lastDay } = dialog;
  if (!startDate) return 'startDateRequired';
  if (lastDay && Temporal.PlainDate.compare(startDate, lastDay) > 0) return 'startAfterEnd';

  const newEnd = lastDay ? lastIncludedDayToExclusiveEnd(lastDay) : startDate;

  const overlaps = existing.some((period) => {
    if (excludeId && period.period_id === excludeId) return false;
    try {
      const existingStart = toPlain(period.start_date);
      const existingEnd = period.end_date ? toPlain(period.end_date) : existingStart;
      // Half-open overlap: existing.start < new.end AND existing.end > new.start
      return (
        Temporal.PlainDate.compare(existingStart, newEnd) < 0 &&
        Temporal.PlainDate.compare(existingEnd, startDate) > 0
      );
    } catch {
      return false; // Skip unparseable periods
    }
  });

  return overlaps ? 'overlap' : null;
}
