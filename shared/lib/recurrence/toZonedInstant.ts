import { Temporal } from '@js-temporal/polyfill';
import { parseDateString } from './dates';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeString(time: string): boolean {
  return TIME_RE.test(time);
}

/**
 * The instant at which wall-clock `HH:MM` on calendar `date` occurs in `timeZone`.
 *
 * Uses `disambiguation: 'compatible'`: a time inside a spring-forward gap (e.g. 02:30 when clocks
 * jump 02:00 → 03:00) resolves to the same offset-shifted moment after the gap (03:30), and a time
 * in a fall-back overlap resolves to the earlier of the two occurrences.
 */
export function toZonedInstant(date: string, time: string, timeZone: string): Date {
  const match = TIME_RE.exec(time);
  if (!match) {
    throw new Error(`Invalid time "${time}": expected HH:MM (24-hour)`);
  }
  const { year, month, day } = parseDateString(date);
  const zoned = Temporal.ZonedDateTime.from(
    { timeZone, year, month, day, hour: Number(match[1]), minute: Number(match[2]) },
    { disambiguation: 'compatible', overflow: 'reject' }
  );
  return new Date(zoned.epochMilliseconds);
}

/** Calendar date of `instant` as seen in `timeZone`. */
export function toLocalDateString(instant: Date, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}
