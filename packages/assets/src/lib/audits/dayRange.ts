/**
 * Day boundaries for the audits list date filter.
 *
 * `asset_audits.started_at` is an instant, but the filter asks a calendar
 * question ("audits started on these days"), so the picked days have to become
 * instants in the viewer's time zone before they reach the service — otherwise
 * a London afternoon audit drops out of a Los Angeles user's "today".
 *
 * A browser's local zone *is* the viewer's resolved time zone (the same value
 * `getUserTimeZone()` reports), so local date components are the conversion:
 * no zone argument to get wrong, and DST-correct because the Date constructor
 * resolves the offset for that day.
 */

/** Local midnight of the picked day, as an ISO instant. */
export function startOfDayIso(day: Date): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).toISOString();
}

/** The last millisecond of the picked day, local, as an ISO instant. */
export function endOfDayIso(day: Date): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).toISOString();
}

/** Both bounds for a picked range; either side may be left open. */
export function dayRangeBounds(range: { from?: Date; to?: Date }): {
  started_from?: string;
  started_to?: string;
} {
  return {
    ...(range.from ? { started_from: startOfDayIso(range.from) } : {}),
    ...(range.to ? { started_to: endOfDayIso(range.to) } : {}),
  };
}
