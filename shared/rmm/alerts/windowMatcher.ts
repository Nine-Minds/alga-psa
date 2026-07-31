import type { RmmMaintenanceWindowRow } from './contracts';

export interface WindowMatchTarget {
  integrationId: string;
  clientId?: string | null;
  assetId?: string | null;
  /** ISO timestamp the alert occurred at. */
  occurredAt: string;
}

/**
 * Returns the first active window matching the alert, or null. A window
 * matches when every non-null scope (integration, client, asset) equals the
 * alert's value and the occurrence instant falls inside the window's one-off
 * range or weekly recurrence.
 */
export function findMatchingWindow(
  windows: RmmMaintenanceWindowRow[],
  target: WindowMatchTarget
): RmmMaintenanceWindowRow | null {
  const occurredAt = new Date(target.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) return null;

  for (const window of windows) {
    if (!window.is_active) continue;
    if (window.integration_id && window.integration_id !== target.integrationId) continue;
    if (window.client_id && window.client_id !== (target.clientId ?? null)) continue;
    if (window.asset_id && window.asset_id !== (target.assetId ?? null)) continue;
    if (isInstantInWindow(window, occurredAt)) return window;
  }
  return null;
}

export function isInstantInWindow(window: RmmMaintenanceWindowRow, instant: Date): boolean {
  if (window.recurrence?.type === 'weekly') {
    return isInWeeklyRecurrence(window.recurrence, instant);
  }
  if (window.starts_at && window.ends_at) {
    const start = new Date(window.starts_at);
    const end = new Date(window.ends_at);
    return instant >= start && instant < end;
  }
  return false;
}

/**
 * Weekly recurrence, evaluated in the window's timezone. A window whose
 * endTime <= startTime crosses midnight: it starts on each listed day and
 * ends the following day, so an instant matches either the pre-midnight part
 * (its own day is listed) or the post-midnight part (the previous day is
 * listed).
 */
function isInWeeklyRecurrence(
  recurrence: NonNullable<RmmMaintenanceWindowRow['recurrence']>,
  instant: Date
): boolean {
  const { dayOfWeek, minutes } = localDayAndMinutes(instant, recurrence.timezone);
  if (dayOfWeek === null) return false;

  const start = parseMinutes(recurrence.startTime);
  const end = parseMinutes(recurrence.endTime);
  const days = new Set(recurrence.days);

  if (start < end) {
    return days.has(dayOfWeek) && minutes >= start && minutes < end;
  }
  // Crosses midnight.
  if (days.has(dayOfWeek) && minutes >= start) return true;
  const previousDay = (dayOfWeek + 6) % 7;
  return days.has(previousDay) && minutes < end;
}

function parseMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function localDayAndMinutes(
  instant: Date,
  timezone: string
): { dayOfWeek: number | null; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const weekday = get('weekday');
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    const dayOfWeek = weekday !== undefined ? WEEKDAY_INDEX[weekday] ?? null : null;
    if (dayOfWeek === null || Number.isNaN(hour) || Number.isNaN(minute)) {
      return { dayOfWeek: null, minutes: 0 };
    }
    return { dayOfWeek, minutes: hour * 60 + minute };
  } catch {
    // Unknown timezone: fail closed (no suppression) rather than swallow alerts.
    return { dayOfWeek: null, minutes: 0 };
  }
}
