import { describe, expect, it } from 'vitest';
import { formatPortalCalendarDate } from './formatPortalCalendarDate';

describe('portal invoice calendar dates', () => {
  it('preserves date-only, PostgreSQL Date, and serialized calendar-date values', () => {
    expect(formatPortalCalendarDate('2026-10-13')).toBe('October 13, 2026');
    expect(formatPortalCalendarDate(new Date('2026-10-13T00:00:00.000Z'))).toBe('October 13, 2026');
    expect(formatPortalCalendarDate('2026-10-13T00:00:00.000Z')).toBe('October 13, 2026');
  });

  it('keeps non-midnight ISO timestamps on the local-instant path', () => {
    const newYork = Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York';
    expect(formatPortalCalendarDate('2026-10-13T01:00:00.000Z'))
      .toBe(newYork ? 'October 12, 2026' : 'October 13, 2026');
  });

  it('preserves empty and invalid value behavior', () => {
    expect(formatPortalCalendarDate(null)).toBe('N/A');
    expect(formatPortalCalendarDate('not-a-date')).toBe('Invalid date');
  });
});
