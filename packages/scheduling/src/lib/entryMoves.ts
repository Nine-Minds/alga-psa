import type { IScheduleEntry } from '@alga-psa/types';
import { calendarStoredDates, hasAllDayDates } from './calendarDateDisplay';

type EntryLike = Pick<IScheduleEntry, 'scheduled_start' | 'scheduled_end'> & {
  is_all_day?: boolean;
  entry_id?: string;
  original_entry_id?: string;
};

export interface DroppedRange {
  start: Date;
  end: Date;
  /** True when the grid dropped the event into its all-day row. */
  isAllDay?: boolean;
}

/**
 * The stored dates for an entry after a drag-and-drop move.
 *
 * The grid reports where the pointer landed, which is only trustworthy for a
 * same-day move of a single-day timed entry. Everything else keeps the
 * entry's own times and shifts it by whole days: date-only entries stay at
 * UTC midnight, multi-day and all-day drops ignore the drop time, and a drop
 * that changed the duration keeps the original duration.
 */
export function droppedEntryDates(event: EntryLike, drop: DroppedRange): {
  scheduled_start: Date;
  scheduled_end: Date;
} {
  const originalStart = new Date(event.scheduled_start);
  const originalEnd = new Date(event.scheduled_end);
  const duration = originalEnd.getTime() - originalStart.getTime();
  const isMultiDay = originalStart.toDateString() !== originalEnd.toDateString();

  const dropDate = new Date(drop.start);
  const originalDateOnly = new Date(originalStart.getFullYear(), originalStart.getMonth(), originalStart.getDate());
  const dropDateOnly = new Date(dropDate.getFullYear(), dropDate.getMonth(), dropDate.getDate());
  const dayDifference = Math.round((dropDateOnly.getTime() - originalDateOnly.getTime()) / 86400000);

  if (hasAllDayDates(event)) {
    const start = new Date(Date.UTC(dropDate.getFullYear(), dropDate.getMonth(), dropDate.getDate()));
    return { scheduled_start: start, scheduled_end: new Date(start.getTime() + duration) };
  }

  if (isMultiDay || drop.isAllDay) {
    const start = new Date(
      originalStart.getFullYear(),
      originalStart.getMonth(),
      originalStart.getDate() + dayDifference,
      originalStart.getHours(),
      originalStart.getMinutes(),
      originalStart.getSeconds(),
      originalStart.getMilliseconds()
    );
    return { scheduled_start: start, scheduled_end: new Date(start.getTime() + duration) };
  }

  if (dayDifference === 0) {
    const start = new Date(drop.start);
    const droppedDuration = new Date(drop.end).getTime() - start.getTime();
    const end = Math.abs(droppedDuration - duration) < 60000
      ? new Date(drop.end)
      : new Date(start.getTime() + duration);
    return { scheduled_start: start, scheduled_end: end };
  }

  const start = new Date(
    dropDate.getFullYear(),
    dropDate.getMonth(),
    dropDate.getDate(),
    originalStart.getHours(),
    originalStart.getMinutes(),
    originalStart.getSeconds()
  );
  return { scheduled_start: start, scheduled_end: new Date(start.getTime() + duration) };
}

/** The stored dates for an entry after one edge was resized on the grid. */
export function resizedEntryDates(event: EntryLike, range: { start: Date; end: Date }) {
  return calendarStoredDates({ scheduled_start: range.start, scheduled_end: range.end }, event);
}

/**
 * The update payload for a moved or resized entry: the entry with its new
 * dates, keeping the assignment and, for a recurring occurrence, the id of
 * the series it was materialized from.
 */
export function movedEntryUpdate<T extends IScheduleEntry>(
  event: T,
  dates: { scheduled_start: Date; scheduled_end: Date; is_all_day?: boolean }
): T {
  return {
    ...event,
    ...dates,
    assigned_user_ids: event.assigned_user_ids,
    ...(event.entry_id.includes('_') ? { original_entry_id: event.original_entry_id } : {}),
  };
}
