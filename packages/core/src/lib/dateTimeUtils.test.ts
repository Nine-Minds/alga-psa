import { afterAll, describe, expect, it } from 'vitest';
import { formatCalendarDate, toCalendarDisplayDate } from './dateTimeUtils';

const originalTz = process.env.TZ;

afterAll(() => {
  if (originalTz) {
    process.env.TZ = originalTz;
  } else {
    delete process.env.TZ;
  }
});

describe('calendar-date display helpers', () => {
  // These helpers anchor calendar dates at noon UTC so the rendered day never
  // shifts under any timezone offset. `new Date('2026-08-31')` is UTC midnight
  // and therefore drifts back a day in negative-offset timezones — the bug
  // class the helpers exist to avoid.
  it('formats a date-only string without a timezone round-trip in a negative-offset timezone', () => {
    process.env.TZ = 'America/New_York';
    expect(new Date('2026-08-31').getDate()).toBe(30);
    expect(formatCalendarDate('2026-08-31')).toBe('2026-08-31');
    expect(formatCalendarDate('2026-09-15')).toBe('2026-09-15');
  });

  it('renders the same day in UTC and positive-offset timezones', () => {
    process.env.TZ = 'UTC';
    expect(formatCalendarDate('2026-08-31')).toBe('2026-08-31');
    process.env.TZ = 'Pacific/Kiritimati';
    expect(formatCalendarDate('2026-08-31')).toBe('2026-08-31');
  });

  it('returns null for empty or unparseable values', () => {
    process.env.TZ = 'UTC';
    expect(formatCalendarDate(null)).toBeNull();
    expect(formatCalendarDate(undefined)).toBeNull();
    expect(formatCalendarDate('')).toBeNull();
    expect(formatCalendarDate('not-a-date')).toBeNull();
  });

  it('toCalendarDisplayDate anchors at local noon and exposes the same day', () => {
    process.env.TZ = 'America/New_York';
    const date = toCalendarDisplayDate('2026-08-31');
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(7);
    expect(date!.getDate()).toBe(31);
    expect(date!.getHours()).toBe(12);
    expect(toCalendarDisplayDate(null)).toBeNull();
  });
});
