/**
 * Defaults shared by every surface that schedules work for a work item
 * (ticket page "schedule time", the agent calendar drawer). One place for
 * "how long is a booking by default" and "what does a date-only click mean".
 */

export const WORK_ITEM_ENTRY_DEFAULT_DURATION_MS = 60 * 60 * 1000;
export const WORK_ITEM_ENTRY_DEFAULT_START_HOUR = 8;

const QUARTER_HOUR_MINUTES = 15;

/** The next quarter-hour boundary strictly after `now`, seconds cleared. */
export function nextQuarterHour(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setSeconds(0, 0);
  const minutes = start.getMinutes();
  start.setMinutes(minutes - (minutes % QUARTER_HOUR_MINUTES) + QUARTER_HOUR_MINUTES);
  return start;
}

/** Default booking when the user picked no time: next quarter hour, default duration. */
export function defaultWorkItemSlot(now: Date = new Date()): { start: Date; end: Date } {
  const start = nextQuarterHour(now);
  return { start, end: new Date(start.getTime() + WORK_ITEM_ENTRY_DEFAULT_DURATION_MS) };
}

export interface CalendarSelection {
  start: Date | string;
  end: Date | string;
  /** react-big-calendar's SlotInfo.action: 'click' is a single cell, 'select' a drag. */
  action?: 'select' | 'click' | 'doubleClick';
}

/**
 * Turns a calendar selection into a concrete start/end.
 *
 * Month view only knows the date, so it is pinned to `startHour` with the
 * default duration. A single click in a timed view is one grid step, which is
 * rarely the intended length, so it also gets the default duration; a dragged
 * range is kept as drawn.
 */
export function slotFromCalendarSelection(
  selection: CalendarSelection,
  view: string,
  options: { durationMs: number; startHour?: number }
): { start: Date; end: Date } {
  const start = new Date(selection.start);
  const startHour = options.startHour ?? WORK_ITEM_ENTRY_DEFAULT_START_HOUR;

  if (view === 'month') {
    start.setHours(startHour, 0, 0, 0);
    return { start, end: new Date(start.getTime() + options.durationMs) };
  }

  if (selection.action === 'click') {
    return { start, end: new Date(start.getTime() + options.durationMs) };
  }

  return { start, end: new Date(selection.end) };
}
