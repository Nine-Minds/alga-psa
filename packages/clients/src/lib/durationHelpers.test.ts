import { describe, expect, it } from 'vitest';
import {
  MAX_INTERACTION_DURATION_MINUTES,
  clampDuration,
  durationFromRange,
  reconcileInteractionDuration,
} from './durationHelpers';

const at = (iso: string) => new Date(iso);

describe('clampDuration', () => {
  it('treats empty input as zero', () => {
    expect(clampDuration('', '')).toEqual({ hours: 0, minutes: 0, totalMinutes: 0 });
  });

  it('calculates total minutes for valid inputs', () => {
    expect(clampDuration('2', '30')).toEqual({ hours: 2, minutes: 30, totalMinutes: 150 });
  });

  it('clamps out-of-range hours to 24', () => {
    expect(clampDuration('25', '30')).toEqual({ hours: 24, minutes: 0, totalMinutes: 1440 });
  });

  it('forces minutes to 0 when hours equals 24', () => {
    expect(clampDuration('24', '59')).toEqual({ hours: 24, minutes: 0, totalMinutes: 1440 });
  });

  it('clamps out-of-range minutes to 59', () => {
    expect(clampDuration('2', '61')).toEqual({ hours: 2, minutes: 59, totalMinutes: 179 });
  });

  it('clamps negative inputs to zero', () => {
    expect(clampDuration('-3', '-5')).toEqual({ hours: 0, minutes: 0, totalMinutes: 0 });
  });

  it('handles non-numeric hour input', () => {
    expect(clampDuration('abc', '5')).toEqual({ hours: 0, minutes: 5, totalMinutes: 5 });
  });
});

describe('durationFromRange', () => {
  it('reports the exact duration a range spans', () => {
    expect(durationFromRange(at('2026-10-01T09:00:00Z'), at('2026-10-01T11:30:00Z'))).toEqual({
      hours: 2,
      minutes: 30,
      totalMinutes: 150,
      exceedsCap: false,
    });
  });

  it('treats an empty range as zero', () => {
    expect(durationFromRange(at('2026-10-01T09:00:00Z'), at('2026-10-01T09:00:00Z'))).toEqual({
      hours: 0,
      minutes: 0,
      totalMinutes: 0,
      exceedsCap: false,
    });
  });

  it('allows a range of exactly the cap', () => {
    expect(durationFromRange(at('2026-10-01T09:00:00Z'), at('2026-10-02T09:00:00Z'))).toMatchObject({
      hours: 24,
      minutes: 0,
      totalMinutes: MAX_INTERACTION_DURATION_MINUTES,
      exceedsCap: false,
    });
  });

  it('flags a 72-hour range as over the cap instead of reporting 72 hours of duration', () => {
    expect(durationFromRange(at('2026-10-01T09:00:00Z'), at('2026-10-04T09:00:00Z'))).toMatchObject({
      totalMinutes: 4320,
      exceedsCap: true,
    });
  });

  it('keeps the form fields at zero for an inverted range', () => {
    expect(durationFromRange(at('2026-10-01T11:00:00Z'), at('2026-10-01T09:00:00Z'))).toEqual({
      hours: 0,
      minutes: 0,
      totalMinutes: -120,
      exceedsCap: false,
    });
  });
});

describe('reconcileInteractionDuration', () => {
  it('normalizes a duration that disagrees with its range', () => {
    expect(reconcileInteractionDuration({
      start_time: at('2026-10-01T09:00:00Z'),
      end_time: at('2026-10-01T11:30:00Z'),
      duration: 45,
    })).toEqual({ ok: true, duration: 150 });
  });

  it('leaves a consistent sub-cap duration untouched', () => {
    expect(reconcileInteractionDuration({
      start_time: at('2026-10-01T09:00:00Z'),
      end_time: at('2026-10-01T09:30:00Z'),
      duration: 30,
    })).toEqual({ ok: true, duration: 30 });
  });

  it('accepts ISO timestamps as they arrive from a payload', () => {
    expect(reconcileInteractionDuration({
      start_time: '2026-10-01T09:00:00.000Z',
      end_time: '2026-10-01T10:00:00.000Z',
      duration: null,
    })).toEqual({ ok: true, duration: 60 });
  });

  it('reports no duration for a zero-length range', () => {
    expect(reconcileInteractionDuration({
      start_time: at('2026-10-01T09:00:00Z'),
      end_time: at('2026-10-01T09:00:00Z'),
      duration: 120,
    })).toEqual({ ok: true, duration: null });
  });

  it('rejects a range longer than the cap', () => {
    expect(reconcileInteractionDuration({
      start_time: at('2026-10-01T09:00:00Z'),
      end_time: at('2026-10-04T09:00:00Z'),
      duration: 1440,
    })).toEqual({ ok: false, reason: 'range_exceeds_cap' });
  });

  it('rejects an end time before the start time', () => {
    expect(reconcileInteractionDuration({
      start_time: at('2026-10-01T11:00:00Z'),
      end_time: at('2026-10-01T09:00:00Z'),
      duration: 120,
    })).toEqual({ ok: false, reason: 'end_before_start' });
  });

  it('clamps a bare duration to the cap when there is no range to measure', () => {
    expect(reconcileInteractionDuration({ start_time: at('2026-10-01T09:00:00Z'), duration: 4320 }))
      .toEqual({ ok: true, duration: MAX_INTERACTION_DURATION_MINUTES });
    expect(reconcileInteractionDuration({ duration: 90 })).toEqual({ ok: true, duration: 90 });
    expect(reconcileInteractionDuration({})).toEqual({ ok: true, duration: null });
  });
});
