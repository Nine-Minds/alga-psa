import { afterEach, describe, expect, it } from 'vitest';
import { toCalendarDateString } from '@alga-psa/core';
import { calendarDateToLocalDate } from './calendarDate';

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('calendarDateToLocalDate', () => {
  it('returns undefined for empty or malformed input', () => {
    expect(calendarDateToLocalDate('')).toBeUndefined();
    expect(calendarDateToLocalDate(null)).toBeUndefined();
    expect(calendarDateToLocalDate('not-a-date')).toBeUndefined();
  });

  it.each(['Australia/Brisbane', 'America/Los_Angeles', 'UTC'])(
    'round-trips through toCalendarDateString in %s',
    (tz) => {
      process.env.TZ = tz;
      const date = calendarDateToLocalDate('2026-12-31')!;
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(11);
      expect(date.getDate()).toBe(31);
      expect(toCalendarDateString(date)).toBe('2026-12-31');
    }
  );

  it('ignores a time suffix on the stored value', () => {
    expect(toCalendarDateString(calendarDateToLocalDate('2026-12-31T00:00:00.000Z')!)).toBe('2026-12-31');
  });
});
