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

/**
 * Milliseconds to ADD to the local clock to estimate server time:
 * serverNow - receivedAt, where receivedAt is the local time the response arrived.
 */
export function clockOffset(serverNow: StopwatchTimestamp | number, receivedAt: StopwatchTimestamp | number): number {
  return nowMs(serverNow) - nowMs(receivedAt);
}
