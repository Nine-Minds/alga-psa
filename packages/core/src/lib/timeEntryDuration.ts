/**
 * Elapsed-work duration for a time entry, independent of billing.
 *
 * `billable_duration` is deliberately zero for non-billable entries, so using
 * it as "time worked" renders a five-minute entry as `0m`. The worked duration
 * is the rounded `end_time - start_time` interval; `billable_duration` is only
 * a fallback for entries whose timestamps are missing, redacted, or unusable.
 *
 * Client-safe: pure arithmetic, no server-only dependencies.
 */

export interface TimeEntryDurationLike {
  start_time?: string | Date | null;
  end_time?: string | Date | null;
  billable_duration?: number | string | null;
}

const MS_PER_MINUTE = 60_000;

function toEpochMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

/**
 * Minutes actually worked on a time entry.
 *
 * Prefers the rounded `end_time - start_time` interval. Falls back to a finite,
 * non-negative `billable_duration` when no usable interval exists, and to `0`
 * when neither source is usable. Never returns `NaN` or a negative value.
 */
export function workedMinutes(entry: TimeEntryDurationLike | null | undefined): number {
  if (!entry) {
    return 0;
  }

  const start = toEpochMillis(entry.start_time);
  const end = toEpochMillis(entry.end_time);
  if (start !== null && end !== null && end >= start) {
    return Math.round((end - start) / MS_PER_MINUTE);
  }

  const rawBillable =
    typeof entry.billable_duration === 'string'
      ? Number(entry.billable_duration)
      : entry.billable_duration;
  if (typeof rawBillable === 'number' && Number.isFinite(rawBillable) && rawBillable > 0) {
    return rawBillable;
  }

  return 0;
}
