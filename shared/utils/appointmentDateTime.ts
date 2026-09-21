import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

/** Convert a requester's wall-clock appointment without accepting normalized
 * invalid dates or nonexistent local times during a daylight-saving gap. */
export function appointmentDateTime(date: string, time: string, timezone: string, duration: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time) || !Number.isInteger(duration) || duration < 15 || duration > 480) throw new Error('Invalid appointment date, time or duration');
  const wallClock = `${date}T${time.slice(0, 5)}:00`, start = fromZonedTime(wallClock, timezone);
  if (!Number.isFinite(start.getTime()) || formatInTimeZone(start, timezone, "yyyy-MM-dd'T'HH:mm:ss") !== wallClock) throw new Error('Invalid appointment time in the requested time zone');
  return { start, end: new Date(start.getTime() + duration * 60000) };
}
