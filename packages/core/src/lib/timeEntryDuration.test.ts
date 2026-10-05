import { describe, expect, it } from 'vitest';
import { workedMinutes, type TimeEntryDurationLike } from './timeEntryDuration';

describe('workedMinutes', () => {
  it('returns the elapsed interval even when billable_duration is zero', () => {
    expect(
      workedMinutes({
        start_time: '2026-09-20T23:54:00.000Z',
        end_time: '2026-09-20T23:59:00.000Z',
        billable_duration: 0,
      }),
    ).toBe(5);
  });

  it('prefers the timestamp duration when billable minutes differ', () => {
    expect(
      workedMinutes({
        start_time: '2026-07-16T09:00:00.000Z',
        end_time: '2026-07-16T13:25:00.000Z',
        billable_duration: 300,
      }),
    ).toBe(265);
  });

  it('accepts Date and ISO string timestamps', () => {
    expect(
      workedMinutes({
        start_time: new Date('2026-09-20T10:00:00.000Z'),
        end_time: new Date('2026-09-20T10:05:00.000Z'),
        billable_duration: 0,
      }),
    ).toBe(5);
    expect(
      workedMinutes({
        start_time: '2026-09-20T10:00:00.000Z',
        end_time: '2026-09-20T10:05:00.000Z',
        billable_duration: 0,
      }),
    ).toBe(5);
  });

  it('rounds a sub-minute interval to the nearest minute', () => {
    expect(
      workedMinutes({
        start_time: '2026-09-20T10:00:00.000Z',
        end_time: '2026-09-20T10:00:40.000Z',
        billable_duration: 0,
      }),
    ).toBe(1);
    expect(
      workedMinutes({
        start_time: '2026-09-20T10:00:00.000Z',
        end_time: '2026-09-20T10:00:20.000Z',
        billable_duration: 0,
      }),
    ).toBe(0);
  });

  it('falls back to finite billable minutes for missing or invalid intervals', () => {
    const cases: TimeEntryDurationLike[] = [
      { start_time: null, end_time: '2026-09-20T10:05:00.000Z', billable_duration: 18 },
      { start_time: '2026-09-20T10:00:00.000Z', end_time: null, billable_duration: 18 },
      { start_time: 'not-a-date', end_time: 'also-not-a-date', billable_duration: 18 },
      { start_time: '2026-09-20T10:05:00.000Z', end_time: '2026-09-20T10:00:00.000Z', billable_duration: 18 },
    ];
    for (const entry of cases) {
      expect(workedMinutes(entry)).toBe(18);
    }
    expect(workedMinutes({ billable_duration: '12' })).toBe(12);
  });

  it('returns zero when neither source is usable', () => {
    expect(workedMinutes({ start_time: null, end_time: null, billable_duration: null })).toBe(0);
    expect(workedMinutes({ start_time: null, end_time: null, billable_duration: 0 })).toBe(0);
    expect(workedMinutes({ start_time: null, end_time: null, billable_duration: -5 })).toBe(0);
    expect(workedMinutes(null)).toBe(0);
    expect(workedMinutes(undefined)).toBe(0);
  });

  it('does not mutate the input object', () => {
    const entry = {
      start_time: '2026-09-20T23:54:00.000Z',
      end_time: '2026-09-20T23:59:00.000Z',
      billable_duration: 0,
    };
    const snapshot = { ...entry };
    workedMinutes(entry);
    expect(entry).toEqual(snapshot);
  });
});
