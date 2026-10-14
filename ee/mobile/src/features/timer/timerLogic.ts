export const TIMER_REMINDER_THRESHOLDS_MINUTES = [60, 120, 240, 480];

const REMINDER_IDENTIFIER_PREFIX = "timer-reminder:";

export type RunningTimerSnapshot = {
  sessionId: string;
  /**
   * Virtual start on the server clock: serverNow - activeMs. Reminder thresholds
   * measure active time, so pauses shift this forward. Use firstStartMs for display.
   */
  startTimeMs: number;
  /** Server-clock time of the first segment start (for "started at" text). */
  firstStartMs?: number;
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
