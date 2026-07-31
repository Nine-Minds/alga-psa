// Bridges between the string values that <input type="date"|"datetime-local"> used to hold
// and the Date values the shared DatePicker / DateTimePicker components work with.
// All parse/format is local-time, avoiding the UTC day-shift footgun of `new Date('yyyy-MM-dd')`
// (date-only strings parse as UTC per the ES spec, so re-serializing can jump a day).

/** Parse a `yyyy-MM-dd` string into a local-time Date for DatePicker. */
export function dateFromString(value: string | null | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

/** Format a Date back into the `yyyy-MM-dd` string a date-only field expects. */
export function dateToString(date: Date | null | undefined): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse a `yyyy-MM-ddTHH:mm` string into a local-time Date for DateTimePicker. */
export function dateTimeFromString(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Format a Date back into the `yyyy-MM-ddTHH:mm` string a datetime-local field expects. */
export function dateTimeToString(date: Date | null | undefined): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}
