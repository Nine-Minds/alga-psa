type ScheduleDates = { scheduled_start: Date | string; scheduled_end: Date | string };
const localMidnight = (date: Date) => date.getHours() === 0 && date.getMinutes() === 0
  && date.getSeconds() === 0 && date.getMilliseconds() === 0;

/** Existing date-only imports use exclusive UTC-midnight boundaries. */
export function hasAllDayDates(entry: ScheduleDates): boolean {
  const start = new Date(entry.scheduled_start);
  const end = new Date(entry.scheduled_end);
  const midnight = (date: Date) => date.getUTCHours() === 0 && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  return midnight(start) && midnight(end) && end.getTime() - start.getTime() >= 86400000;
}

export function calendarDisplayDates(entry: ScheduleDates): ScheduleDates & { scheduled_start: Date; scheduled_end: Date } {
  const display = (value: Date | string) => {
    const date = new Date(value);
    return hasAllDayDates(entry)
      ? new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
      : date;
  };
  return { scheduled_start: display(entry.scheduled_start), scheduled_end: display(entry.scheduled_end) };
}

export function calendarStoredDates(entry: ScheduleDates, original?: ScheduleDates | null) {
  const start = new Date(entry.scheduled_start);
  const end = new Date(entry.scheduled_end);
  // Changing either time explicitly turns the edited event into a timed event.
  const dateOnly = original && hasAllDayDates(original) && localMidnight(start) && localMidnight(end);
  const store = (date: Date) => dateOnly
    ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) : date;
  return { scheduled_start: store(start), scheduled_end: store(end) };
}

export function moveCalendarStart(date: Date, current: ScheduleDates, original: ScheduleDates | null | undefined, duration: number) {
  const start = new Date(current.scheduled_start);
  const end = new Date(current.scheduled_end);
  if (original && hasAllDayDates(original) && [date, start, end].every(localMidnight)) {
    const days = (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
      - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }
  return new Date(date.getTime() + duration);
}
