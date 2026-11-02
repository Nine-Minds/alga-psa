import { afterEach, describe, expect, it } from 'vitest';
import { formatLocalizedCalendarDate } from './calendarDate';

const originalTz = process.env.TZ;

describe('formatLocalizedCalendarDate', () => {
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'])('keeps the calendar day under TZ=%s', (tz) => {
    process.env.TZ = tz;
    expect(formatLocalizedCalendarDate('2026-10-29', 'en-US')).toBe('October 29, 2026');
    expect(formatLocalizedCalendarDate('2026-10-29', 'es')).toBe('29 de octubre de 2026');
    expect(formatLocalizedCalendarDate(new Date(Date.UTC(2026, 9, 29)), 'en-US')).toBe('October 29, 2026');
    expect(formatLocalizedCalendarDate(new Date(2026, 9, 29), 'de')).toBe('29. Oktober 2026');
  });

  it('rejects an invalid Date', () => {
    expect(() => formatLocalizedCalendarDate(new Date('x'), 'en')).toThrow();
  });
});
