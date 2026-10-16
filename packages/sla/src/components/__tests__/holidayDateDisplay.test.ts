import { afterEach, describe, expect, it } from 'vitest';
import { toCalendarDateString, toCalendarDisplayDate } from '@alga-psa/core';
import { formatHolidayDate } from '../holidayDateDisplay';

const originalTimeZone = process.env.TZ;

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe('holiday date display', () => {
  it('renders stored calendar dates in America/New_York', () => {
    process.env.TZ = 'America/New_York';
    expect(new Date('2026-09-24').getDate()).toBe(23);

    expect(formatHolidayDate('2026-09-24')).toContain('Sep');
    expect(formatHolidayDate('2026-09-24')).toContain('24');
    expect(formatHolidayDate('2026-01-01')).not.toContain('Dec 31, 2025');
  });

  it.each(['America/New_York', 'Europe/Berlin'])('round trips the picked day in %s', (timeZone) => {
    process.env.TZ = timeZone;
    const pickedDate = toCalendarDisplayDate('2026-09-24');
    expect(pickedDate).not.toBeNull();
    expect(toCalendarDateString(pickedDate!)).toBe('2026-09-24');
  });
});
