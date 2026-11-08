import { zonedWallTimeToUtc } from './dateTimeUtils';
import { windowsTimeZones } from './windowsTimeZones';

/**
 * Normalize a provider zone name to IANA. Graph names recurrence zones in
 * Windows form ("Eastern Standard Time"); Google already uses IANA.
 */
export function toIanaTimeZone(timeZone?: string | null): string | undefined {
  const name = timeZone?.trim();
  if (!name) return undefined;
  return Object.prototype.hasOwnProperty.call(windowsTimeZones, name)
    ? windowsTimeZones[name]
    : name;
}

/** Convert a provider's timed value to an instant without using the worker timezone. */
export function parseCalendarDateTime(dateTime: string, timeZone?: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?([zZ]|[+-]\d{2}:?\d{2})?$/.exec(dateTime);
  if (!match) throw new Error('Invalid calendar dateTime');
  const milliseconds = Number((match[2] ?? '').padEnd(3, '0').slice(0, 3));
  // Validate the wall-clock date before Date can normalize invalid days.
  const utcWallTime = zonedWallTimeToUtc(match[1], 'UTC');
  if (utcWallTime.toISOString().slice(0, 19) !== match[1]) throw new Error('Invalid calendar dateTime');
  if (match[3]) {
    const instant = new Date(`${match[1]}.${String(milliseconds).padStart(3, '0')}${match[3].toUpperCase()}`);
    if (!Number.isFinite(instant.getTime())) throw new Error('Invalid calendar dateTime offset');
    return instant;
  }
  if (!timeZone?.trim()) throw new Error('Calendar dateTime without an offset requires a timeZone');
  const zone = Object.prototype.hasOwnProperty.call(windowsTimeZones, timeZone)
    ? windowsTimeZones[timeZone] : timeZone;
  const instant = zone === 'UTC' || zone === 'Etc/UTC' ? utcWallTime : zonedWallTimeToUtc(match[1], zone);
  return new Date(instant.getTime() + milliseconds);
}
