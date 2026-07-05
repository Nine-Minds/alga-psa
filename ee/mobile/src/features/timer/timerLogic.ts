export const TIMER_REMINDER_THRESHOLDS_MINUTES = [60, 120, 240, 480];

const REMINDER_IDENTIFIER_PREFIX = "timer-reminder:";

/**
 * Below this, treat device and server clocks as in sync: elapsed_minutes is
 * rounded server-side, so small offsets are measurement noise, and the local
 * clock gives a smoother elapsed display than the rounded server value.
 */
const OFFSET_NOISE_FLOOR_MS = 90_000;

export type RunningTimerSnapshot = {
  sessionId: string;
  startTimeMs: number;
  offsetMs: number;
  workItemId: string | null;
  workItemType: string;
  workItemTitle: string | null;
};

export type PlannedTimerReminder = {
  identifier: string;
  thresholdMinutes: number;
  fireAt: Date;
};

export function computeServerClockOffsetMs(
  startTimeIso: string,
  elapsedMinutes: number,
  localNowMs: number,
): number {
  const startMs = Date.parse(startTimeIso);
  if (!Number.isFinite(startMs)) return 0;
  const serverNowApproxMs = startMs + elapsedMinutes * 60_000;
  const offsetMs = serverNowApproxMs - localNowMs;
  return Math.abs(offsetMs) <= OFFSET_NOISE_FLOOR_MS ? 0 : offsetMs;
}

export function elapsedMsAt(
  localNowMs: number,
  startTimeMs: number,
  offsetMs: number,
): number {
  return Math.max(0, localNowMs + offsetMs - startTimeMs);
}

export function formatElapsedClock(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

export function formatMinutesDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const remaining = safe % 60;
  if (hours === 0) return `${remaining}m`;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}m`;
}

export function timerReminderIdentifier(
  sessionId: string,
  thresholdMinutes: number,
): string {
  return `${REMINDER_IDENTIFIER_PREFIX}${sessionId}:${thresholdMinutes}`;
}

export function parseTimerReminderIdentifier(
  identifier: string,
): { sessionId: string; thresholdMinutes: number } | null {
  if (!identifier.startsWith(REMINDER_IDENTIFIER_PREFIX)) return null;
  const rest = identifier.slice(REMINDER_IDENTIFIER_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  if (sep <= 0) return null;
  const thresholdMinutes = Number(rest.slice(sep + 1));
  if (!Number.isFinite(thresholdMinutes)) return null;
  return { sessionId: rest.slice(0, sep), thresholdMinutes };
}

export function planTimerReminders(
  snapshot: RunningTimerSnapshot,
  nowMs: number,
): PlannedTimerReminder[] {
  return TIMER_REMINDER_THRESHOLDS_MINUTES.flatMap((thresholdMinutes) => {
    const fireAtMs = snapshot.startTimeMs + thresholdMinutes * 60_000 - snapshot.offsetMs;
    if (fireAtMs <= nowMs) return [];
    return [{
      identifier: timerReminderIdentifier(snapshot.sessionId, thresholdMinutes),
      thresholdMinutes,
      fireAt: new Date(fireAtMs),
    }];
  });
}

/**
 * Unlike schedule reminders, timer reminders are a per-user singleton: any
 * existing timer identifier not in the current plan is stale (older session,
 * or a threshold already passed) and gets canceled.
 */
export function diffTimerReminders(
  existingIdentifiers: string[],
  planned: PlannedTimerReminder[],
): { toCancel: string[]; toSchedule: PlannedTimerReminder[] } {
  const plannedIds = new Set(planned.map((p) => p.identifier));
  const existing = new Set(existingIdentifiers);
  return {
    toCancel: existingIdentifiers.filter((identifier) => !plannedIds.has(identifier)),
    toSchedule: planned.filter((p) => !existing.has(p.identifier)),
  };
}
