import { describe, expect, it } from 'vitest';
import {
  callArtifactFetchIntervalMs,
  hasCallArtifactWindowElapsed,
  isCallArtifactFetchDue,
} from './callArtifactBackoff';

const NOW = new Date('2026-08-24T12:00:00.000Z');

function callState(overrides: Record<string, unknown> = {}): any {
  return {
    artifact_fetch_attempts: 0,
    last_artifact_fetch_at: null,
    ended_at: '2026-08-24T11:00:00.000Z',
    created_at: '2026-08-24T11:00:00.000Z',
    ...overrides,
  };
}

describe('call artifact backoff', () => {
  it('T074: backs off exponentially from 2 minutes and caps at an hour', () => {
    expect(callArtifactFetchIntervalMs(0)).toBe(2 * 60 * 1000);
    expect(callArtifactFetchIntervalMs(1)).toBe(4 * 60 * 1000);
    expect(callArtifactFetchIntervalMs(3)).toBe(16 * 60 * 1000);
    expect(callArtifactFetchIntervalMs(99)).toBe(60 * 60 * 1000);
  });

  it('T074: a call never polled before is due as soon as it has ended', () => {
    expect(isCallArtifactFetchDue(callState(), NOW)).toBe(true);
    expect(isCallArtifactFetchDue(callState({ ended_at: '2026-08-24T12:30:00.000Z' }), NOW)).toBe(false);
  });

  it('T074: a recently polled call waits for its interval', () => {
    const justPolled = callState({
      artifact_fetch_attempts: 2,
      last_artifact_fetch_at: '2026-08-24T11:55:00.000Z',
    });
    expect(isCallArtifactFetchDue(justPolled, NOW)).toBe(false);

    const overdue = callState({
      artifact_fetch_attempts: 2,
      last_artifact_fetch_at: '2026-08-24T11:40:00.000Z',
    });
    expect(isCallArtifactFetchDue(overdue, NOW)).toBe(true);
  });

  it('T074: the window closes six hours after the call, timed from ingestion when it never ended', () => {
    expect(hasCallArtifactWindowElapsed(callState(), NOW)).toBe(false);
    expect(hasCallArtifactWindowElapsed(
      callState({ ended_at: '2026-08-24T04:00:00.000Z' }),
      NOW,
    )).toBe(true);
    expect(hasCallArtifactWindowElapsed(
      callState({ ended_at: null, created_at: '2026-08-24T03:00:00.000Z' }),
      NOW,
    )).toBe(true);
  });
});
