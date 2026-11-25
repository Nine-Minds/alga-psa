/**
 * Pure stopwatch math (plan section 5, D2/D5).
 *
 * NO imports on purpose: this file is copied verbatim to
 * ee/mobile/src/features/timer/stopwatchMath.ts (the mobile workspace does not consume
 * @alga-psa/scheduling) and a parity test keeps the two identical.
 */

export type StopwatchTimestamp = string | Date;

export interface StopwatchSegmentLike {
  started_at: StopwatchTimestamp;
  ended_at: StopwatchTimestamp | null;
}

export interface StopwatchEntrySpan {
  /** First segment start truncated to the minute. */
  start: Date;
  /** start + billableMinutes. Always consistent with start and billableMinutes. */
  end: Date;
  /** round(activeMs / 60000), minimum 1. */
  billableMinutes: number;
  /** Wall-clock time between the first start and the end of the last segment (or now) that was not active. */
  pausedMs: number;
  segmentCount: number;
}

const MINUTE_MS = 60_000;

function toMs(value: StopwatchTimestamp): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function nowMs(now: StopwatchTimestamp | number): number {
  return typeof now === 'number' ? now : toMs(now);
}

/** Total active milliseconds: closed segments plus (now - started_at) for the open one. */
export function activeMs(segments: readonly StopwatchSegmentLike[], now: StopwatchTimestamp | number): number {
  const nowValue = nowMs(now);
  let total = 0;
  for (const segment of segments) {
    const start = toMs(segment.started_at);
    const end = segment.ended_at == null ? nowValue : toMs(segment.ended_at);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      total += end - start;
    }
  }
  return total;
}

export function isRunning(segments: readonly StopwatchSegmentLike[]): boolean {
  return segments.some((segment) => segment.ended_at == null);
}

/** Earliest segment start, or null when there are no segments. */
export function firstStart(segments: readonly StopwatchSegmentLike[]): Date | null {
  let min: number | null = null;
  for (const segment of segments) {
    const start = toMs(segment.started_at);
    if (Number.isFinite(start) && (min === null || start < min)) {
      min = start;
    }
  }
  return min === null ? null : new Date(min);
}

/**
 * D5: one session becomes one entry.
 *  - start = first segment start, truncated to the minute
 *  - billableMinutes = round(active / 1 min), minimum 1
 *  - end = start + billableMinutes, so start/end/duration agree and the entry form's
 *    recomputation from the span yields the same minutes (no re-billing of pauses).
 */
export function toEntrySpan(segments: readonly StopwatchSegmentLike[], now: StopwatchTimestamp | number): StopwatchEntrySpan {
  const nowValue = nowMs(now);
  const first = firstStart(segments);
  const startMs = Math.floor((first ? first.getTime() : nowValue) / MINUTE_MS) * MINUTE_MS;
  const active = activeMs(segments, nowValue);
  const billableMinutes = Math.max(1, Math.round(active / MINUTE_MS));

  let lastEnd = first ? first.getTime() : nowValue;
  for (const segment of segments) {
    const end = segment.ended_at == null ? nowValue : toMs(segment.ended_at);
    if (Number.isFinite(end) && end > lastEnd) lastEnd = end;
  }
  const pausedMs = first ? Math.max(0, lastEnd - first.getTime() - active) : 0;

  return {
    start: new Date(startMs),
    end: new Date(startMs + billableMinutes * MINUTE_MS),
    billableMinutes,
    pausedMs,
    segmentCount: segments.length,
  };
}

/** Maps instants to work days. Injected so this file stays import-free (see header). */
export interface WorkDayCalendar {
  /** Work date (YYYY-MM-DD) of an instant. */
  dayOf(ms: number): string;
  /** First instant of the next work day after `ms` (the next local midnight). */
  nextDayStart(ms: number): number;
}

export interface StopwatchEntryPlanItem {
  workDate: string;
  /** Minute-truncated first active instant of that day. */
  start: Date;
  /** start + minutes, capped at 23:59 of that day. */
  end: Date;
  minutes: number;
  /** Exact active milliseconds of that day, before rounding. */
  activeMs: number;
  /** Segment pieces that contributed to this day. */
  segmentCount: number;
}

/**
 * One entry per work day that has active time (design 2.1, 2.5).
 *  - segments are cut at every calendar midnight; paused time is never booked
 *  - per day: start = first active instant truncated to the minute, minutes = round(active ms / 1 min)
 *  - end = start + minutes, capped at 23:59 local (an end of 00:00 would belong to the next day);
 *    the cap can cost at most 1 minute on the earlier day of a segment that crosses midnight
 *  - days that round to 0 minutes are dropped; if every day drops, one 1-minute item on the first day
 * A session that stays inside one day yields the same span as toEntrySpan.
 */
export function toEntryPlan(
  segments: readonly StopwatchSegmentLike[],
  now: StopwatchTimestamp | number,
  calendar: WorkDayCalendar,
): StopwatchEntryPlanItem[] {
  const nowValue = nowMs(now);

  const pieces: Array<{ start: number; end: number }> = [];
  for (const segment of segments) {
    const start = toMs(segment.started_at);
    const end = segment.ended_at == null ? nowValue : toMs(segment.ended_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    let cursor = start;
    while (cursor < end) {
      const boundary = calendar.nextDayStart(cursor);
      // A calendar that fails to advance would loop forever; treat the rest as one piece.
      const pieceEnd = Number.isFinite(boundary) && boundary > cursor ? Math.min(boundary, end) : end;
      pieces.push({ start: cursor, end: pieceEnd });
      cursor = pieceEnd;
    }
  }
  pieces.sort((a, b) => a.start - b.start);

  const days = new Map<string, { first: number; activeMs: number; count: number }>();
  for (const piece of pieces) {
    const key = calendar.dayOf(piece.start);
    const day = days.get(key);
    if (day) {
      day.activeMs += piece.end - piece.start;
      day.count += 1;
    } else {
      days.set(key, { first: piece.start, activeMs: piece.end - piece.start, count: 1 });
    }
  }

  const plan: StopwatchEntryPlanItem[] = [];
  for (const [workDate, day] of days) {
    const startMs = Math.floor(day.first / MINUTE_MS) * MINUTE_MS;
    const lastMinuteStart = calendar.nextDayStart(startMs) - MINUTE_MS;
    const minutes = Math.min(Math.round(day.activeMs / MINUTE_MS), Math.floor((lastMinuteStart - startMs) / MINUTE_MS));
    if (minutes < 1) continue;
    plan.push({
      workDate,
      start: new Date(startMs),
      end: new Date(startMs + minutes * MINUTE_MS),
      minutes,
      activeMs: day.activeMs,
      segmentCount: day.count,
    });
  }

  if (plan.length > 0) return plan;

  // D5 floor: a session always yields at least one 1-minute entry on its first day.
  const firstMs = pieces.length > 0 ? pieces[0].start : nowValue;
  let startMs = Math.floor(firstMs / MINUTE_MS) * MINUTE_MS;
  const lastMinuteStart = calendar.nextDayStart(startMs) - MINUTE_MS;
  if (startMs + MINUTE_MS > lastMinuteStart) startMs = lastMinuteStart - MINUTE_MS;
  return [
    {
      workDate: calendar.dayOf(firstMs),
      start: new Date(startMs),
      end: new Date(startMs + MINUTE_MS),
      minutes: 1,
      activeMs: pieces.reduce((sum, piece) => sum + (piece.end - piece.start), 0),
      segmentCount: pieces.length,
    },
  ];
}

/**
 * Milliseconds to ADD to the local clock to estimate server time:
 * serverNow - receivedAt, where receivedAt is the local time the response arrived.
 */
export function clockOffset(serverNow: StopwatchTimestamp | number, receivedAt: StopwatchTimestamp | number): number {
  return nowMs(serverNow) - nowMs(receivedAt);
}
