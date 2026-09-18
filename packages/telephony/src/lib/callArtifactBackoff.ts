import type { TelephonyCallRecordRow } from '../types';

/**
 * Pacing for artifact polling (F066).
 *
 * There is no artifact change notification for ad hoc calls, so the callRecord
 * notification starts a poll and the sweep keeps it going. Recordings appear
 * minutes after the call, never at call end, so the first retries are close
 * together and then back off: 2m, 4m, 8m, ... capped at 1h.
 */
const ARTIFACT_FETCH_BASE_INTERVAL_MS = 2 * 60 * 1000;
const ARTIFACT_FETCH_MAX_INTERVAL_MS = 60 * 60 * 1000;

/**
 * How long after the call ends we keep looking. A recording that has not shown
 * up within this window is not coming — Teams Phone recording is per-policy and
 * off for most tenants, so "nothing" is the normal answer, not a failure.
 */
const ARTIFACT_WINDOW_MS = 6 * 60 * 60 * 1000;

export function callArtifactFetchIntervalMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(attempts, 20));
  return Math.min(ARTIFACT_FETCH_BASE_INTERVAL_MS * 2 ** exponent, ARTIFACT_FETCH_MAX_INTERVAL_MS);
}

type CallFetchState = Pick<
  TelephonyCallRecordRow,
  'artifact_fetch_attempts' | 'last_artifact_fetch_at' | 'ended_at'
>;

export function isCallArtifactFetchDue(call: CallFetchState, now: Date = new Date()): boolean {
  const endedAt = call.ended_at ? new Date(call.ended_at).getTime() : null;
  if (endedAt !== null && !Number.isNaN(endedAt) && endedAt > now.getTime()) {
    return false;
  }
  if (!call.last_artifact_fetch_at) {
    return true;
  }
  const lastFetch = new Date(call.last_artifact_fetch_at).getTime();
  if (Number.isNaN(lastFetch)) {
    return true;
  }
  return now.getTime() >= lastFetch + callArtifactFetchIntervalMs(call.artifact_fetch_attempts ?? 0);
}

export function hasCallArtifactWindowElapsed(
  call: Pick<TelephonyCallRecordRow, 'ended_at' | 'created_at'>,
  now: Date = new Date(),
): boolean {
  // A CDR without an end time (a failed setup) is timed from when we ingested it.
  const reference = call.ended_at ?? call.created_at;
  const referenceMs = reference ? new Date(reference).getTime() : Number.NaN;
  if (Number.isNaN(referenceMs)) {
    return true;
  }
  return now.getTime() >= referenceMs + ARTIFACT_WINDOW_MS;
}
