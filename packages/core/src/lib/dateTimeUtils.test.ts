import { afterAll, describe, expect, it } from 'vitest';
import { formatCalendarDate, toCalendarDateString, toCalendarDisplayDate, toISOTimestamp, toPlainDate } from './dateTimeUtils';
import { formatDate } from './formatters';

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

  // The HOUR_BLOCK_EXPIRING subscriber renders expirationDate (a YYYY-MM-DD
  // string from the event payload) for the email template. It used to go through
  // formatDate, which reparses date-only strings as UTC midnight and therefore
  // rendered the PREVIOUS day in negative-offset timezones. The subscriber now
  // uses formatCalendarDate with the same 'M/d/yyyy' shape formatDate produced
  // for en-US; this pins the exact rendering in a negative-offset zone.
  it('renders the calendar date the way the hour-block email subscriber does (America/New_York)', () => {
    process.env.TZ = 'America/New_York';
    // Old path: new Date('2026-08-31') is UTC midnight, which lands on 08-30
    // in a negative-offset zone.
    expect(formatDate('2026-08-31')).toBe('8/30/2026');
    // New path: anchored at local noon, same calendar day in every zone.
    expect(formatCalendarDate('2026-08-31', 'M/d/yyyy')).toBe('8/31/2026');
  });

  it('keeps a UTC maintenance due date on its persisted calendar day in America/New_York', () => {
    process.env.TZ = 'America/New_York';
    expect(formatCalendarDate('2026-09-22T00:00:00.000Z', 'MMM d, yyyy')).toBe('Sep 22, 2026');
  });

  it('round-trips a maintenance completion audit date in America/New_York', () => {
    process.env.TZ = 'America/New_York';
    const performedDate = toCalendarDateString('2026-08-23');
    expect(performedDate).toBe('2026-08-23');

    // Completion stores the selected calendar day at canonical UTC midnight;
    // both the workspace audit and asset history render it as a calendar date.
    const storedPerformedAt = toISOTimestamp(toPlainDate(performedDate!));
    expect(storedPerformedAt).toBe('2026-08-23T00:00:00.000Z');
    expect(formatCalendarDate(storedPerformedAt, 'MMM d, yyyy')).toBe('Aug 23, 2026');
    expect(formatCalendarDate(storedPerformedAt)).toBe('2026-08-23');
  });
});
