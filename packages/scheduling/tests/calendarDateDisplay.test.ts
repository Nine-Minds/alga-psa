import { describe, expect, it } from 'vitest';
import { calendarDisplayDates, calendarStoredDates, hasAllDayDates } from '../src/lib/calendarDateDisplay';

describe('calendar date semantics', () => {
  const boundaries = {
    scheduled_start: new Date('2026-10-25T00:00:00Z'),
    scheduled_end: new Date('2026-10-26T00:00:00Z'),
  };

  it.each([false, undefined])('keeps exact-midnight timed instants when all-day is %s', is_all_day => {
    const entry = { ...boundaries, is_all_day };
    expect(hasAllDayDates(entry)).toBe(false);
    expect(calendarDisplayDates(entry)).toMatchObject(boundaries);
  });

  it('shows explicitly all-day dates at local midnight and preserves their exclusive UTC dates', () => {
    const entry = { ...boundaries, is_all_day: true };
    expect(hasAllDayDates(entry)).toBe(true);
    const display = calendarDisplayDates(entry);
    expect(display).toMatchObject({ scheduled_start: new Date(2026, 9, 25), scheduled_end: new Date(2026, 9, 26) });
    expect(calendarStoredDates(display, entry)).toMatchObject({ ...boundaries, is_all_day: true });
  });

  it('clears all-day semantics when an editor time becomes explicit', () => {
    const entry = { ...boundaries, is_all_day: true };
    const edited = { scheduled_start: new Date(2026, 9, 25, 9), scheduled_end: new Date(2026, 9, 26) };
    expect(calendarStoredDates(edited, entry)).toEqual({ ...edited, is_all_day: false });
  });

  it('does not convert a timed editor range at local midnight into all-day storage', () => {
    const edited = { scheduled_start: new Date(2026, 9, 25), scheduled_end: new Date(2026, 9, 26) };
    expect(calendarStoredDates(edited, { ...boundaries, is_all_day: false })).toEqual({ ...edited, is_all_day: false });
  });
});
