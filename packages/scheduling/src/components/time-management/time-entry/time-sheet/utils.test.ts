import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampDurationToSameDay, getSameDayDurationLimit, validateTimeEntry } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('time entry same-day duration helpers', () => {
  it('calculates the maximum duration through 23:59 on the start day', () => {
    const start = new Date(2026, 3, 23, 8, 0, 0, 0);

    expect(getSameDayDurationLimit(start)).toBe(959);
  });

  it('clamps very large durations to the latest same-day end time', () => {
    const start = new Date(2026, 3, 23, 8, 0, 0, 0);
    const result = clampDurationToSameDay(start, Number.POSITIVE_INFINITY);

    expect(result.durationMinutes).toBe(959);
    expect(result.wasClampedToSameDay).toBe(true);
    expect(result.endTime.getFullYear()).toBe(2026);
    expect(result.endTime.getMonth()).toBe(3);
    expect(result.endTime.getDate()).toBe(23);
    expect(result.endTime.getHours()).toBe(23);
    expect(result.endTime.getMinutes()).toBe(59);
  });

  it('keeps valid same-day durations unchanged', () => {
    const start = new Date(2026, 3, 23, 8, 0, 0, 0);
    const result = clampDurationToSameDay(start, 90);

    expect(result.durationMinutes).toBe(90);
    expect(result.wasClampedToSameDay).toBe(false);
    expect(result.endTime.getHours()).toBe(9);
    expect(result.endTime.getMinutes()).toBe(30);
  });

  it('returns no valid duration when the start time is already the latest same-day end minute', () => {
    const start = new Date(2026, 3, 23, 23, 59, 0, 0);
    const result = clampDurationToSameDay(start, 60);

    expect(result.durationMinutes).toBe(0);
    expect(result.wasClampedToSameDay).toBe(true);
    expect(result.endTime.getHours()).toBe(23);
    expect(result.endTime.getMinutes()).toBe(59);
  });

  it('rejects saved entries that spill into another day', () => {
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);

    expect(validateTimeEntry({
      start_time: new Date(2026, 3, 23, 23, 0, 0, 0).toISOString(),
      end_time: new Date(2026, 3, 24, 0, 30, 0, 0).toISOString(),
      billable_duration: 90,
    } as any)).toBe(false);
    expect(alertMock).toHaveBeenCalledWith('Time entry must end on the same day');
  });
});
