import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampDurationToSameDay,
  getSameDayDurationLimit,
  getTimeEntryWorkDate,
  isTimeEntryOnWorkDate,
  validateTimeEntry,
} from './utils';

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

  it('T003: prefers work_date for timezone-boundary display grouping', () => {
    const entry = {
      work_date: '2026-03-31',
      start_time: '2026-04-01T00:00:00.000Z',
    } as any;

    expect(getTimeEntryWorkDate(entry)).toBe('2026-03-31');
    expect(isTimeEntryOnWorkDate(entry, '2026-03-31')).toBe(true);
    expect(isTimeEntryOnWorkDate(entry, '2026-04-01')).toBe(false);
  });

  it('normalizes serialized work_date values without falling back to start_time', () => {
    expect(getTimeEntryWorkDate({
      work_date: '2026-03-31T00:00:00.000Z',
      start_time: '2026-04-01T00:00:00.000Z',
    })).toBe('2026-03-31');

    expect(getTimeEntryWorkDate({
      work_date: new Date('2026-03-31T00:00:00.000Z'),
      start_time: '2026-04-01T00:00:00.000Z',
    })).toBe('2026-03-31');
  });

  it('T008: fails fast when work_date is missing after migration', () => {
    const entry = {
      entry_id: 'entry-without-work-date',
      work_date: null,
      start_time: '2026-04-01T00:00:00.000Z',
    } as any;

    expect(() => getTimeEntryWorkDate(entry)).toThrow('entry-without-work-date');
    expect(() => isTimeEntryOnWorkDate(entry, '2026-04-01')).toThrow('entry-without-work-date');
  });
});
