import { describe, expect, it } from 'vitest';
import {
  buildFallbackBusinessDayCalendar,
  classifyInstant,
  createBusinessDayCalendar,
  type BusinessDayCalendarSpec,
} from '../businessDayCalendar';

// The first four tests mirror the fixtures of the original workflow classification tests
// (ee/packages/workflows/src/lib/workflowBusinessDayScheduling.test.ts) to pin parity.
const base: BusinessDayCalendarSpec = { is24x7: false, entries: [], holidays: [] };

describe('classifyInstant (parity with the original workflow classification)', () => {
  it('holidays are non-business even for 24x7 schedules', () => {
    const spec = { ...base, is24x7: true, holidays: [{ holiday_date: '2026-12-25', is_recurring: false }] };
    expect(classifyInstant(new Date('2026-12-25T10:00:00.000Z'), 'UTC', spec)).toBe('non_business');
  });

  it('Date-valued holiday rows (pg DATE parsed as local midnight) are holidays', () => {
    const spec = { ...base, is24x7: true, holidays: [{ holiday_date: new Date(2026, 11, 25), is_recurring: false }] };
    expect(classifyInstant(new Date('2026-12-25T10:00:00.000Z'), 'UTC', spec)).toBe('non_business');
  });

  it('non-holiday days are business only when the weekday entry is enabled', () => {
    const spec = {
      ...base,
      entries: [
        { day_of_week: 1, is_enabled: true },
        { day_of_week: 2, is_enabled: false },
      ],
    };
    expect(classifyInstant(new Date('2026-04-13T12:00:00.000Z'), 'UTC', spec)).toBe('business'); // Monday
    expect(classifyInstant(new Date('2026-04-14T12:00:00.000Z'), 'UTC', spec)).toBe('non_business'); // Tuesday (disabled)
    expect(classifyInstant(new Date('2026-04-15T12:00:00.000Z'), 'UTC', spec)).toBe('non_business'); // Wednesday (no entry)
  });

  it('classifies in the supplied timezone', () => {
    const spec = { ...base, entries: [{ day_of_week: 2, is_enabled: true }] };
    // 06:30Z on Tue Apr 14 is still Mon Apr 13 in Los Angeles (23:30) but Tue 02:30 in New York.
    const instant = new Date('2026-04-14T06:30:00.000Z');
    expect(classifyInstant(instant, 'America/New_York', spec)).toBe('business');
    expect(classifyInstant(instant, 'America/Los_Angeles', spec)).toBe('non_business');
  });

  it('recurring holidays match on month/day in any year', () => {
    const spec = { ...base, is24x7: true, holidays: [{ holiday_date: '2020-07-04', is_recurring: true }] };
    expect(classifyInstant(new Date('2031-07-04T12:00:00.000Z'), 'UTC', spec)).toBe('non_business');
    expect(classifyInstant(new Date('2031-07-05T12:00:00.000Z'), 'UTC', spec)).toBe('business');
  });
});

describe('createBusinessDayCalendar', () => {
  it('classifies calendar dates by weekday and holidays, independent of process timezone', () => {
    const cal = createBusinessDayCalendar(
      {
        is24x7: false,
        entries: [1, 2, 3, 4].map((d) => ({ day_of_week: d, is_enabled: true })), // Mon–Thu
        holidays: [{ holiday_date: '2026-03-04', is_recurring: false }],
      },
      { source: 'default_schedule', scheduleName: 'Four-day week', timezone: 'UTC' }
    );
    expect(cal.isBusinessDay('2026-03-02')).toBe(true); // Mon
    expect(cal.isBusinessDay('2026-03-04')).toBe(false); // Wed holiday
    expect(cal.isBusinessDay('2026-03-06')).toBe(false); // Fri not enabled
    expect(cal.source).toBe('default_schedule');
    expect(cal.scheduleName).toBe('Four-day week');
  });

  it('a 24x7 schedule makes every non-holiday a business day', () => {
    const cal = createBusinessDayCalendar(
      { is24x7: true, entries: [], holidays: [{ holiday_date: '2026-03-08', is_recurring: false }] },
      { source: 'default_schedule', scheduleName: 'Always', timezone: 'UTC' }
    );
    expect(cal.isBusinessDay('2026-03-07')).toBe(true); // Saturday
    expect(cal.isBusinessDay('2026-03-08')).toBe(false); // holiday
  });
});

describe('buildFallbackBusinessDayCalendar (tenant with no default schedule)', () => {
  it('is Monday–Friday', () => {
    const cal = buildFallbackBusinessDayCalendar();
    expect(cal.source).toBe('fallback');
    expect(cal.scheduleName).toBeNull();
    expect(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'].every(cal.isBusinessDay)).toBe(true);
    expect(cal.isBusinessDay('2026-03-07')).toBe(false);
    expect(cal.isBusinessDay('2026-03-08')).toBe(false);
  });

  it('applies tenant-wide holidays', () => {
    const cal = buildFallbackBusinessDayCalendar([
      { holiday_date: '2026-12-25', is_recurring: false },
      { holiday_date: '2020-01-01', is_recurring: true },
    ]);
    expect(cal.isBusinessDay('2026-12-25')).toBe(false); // Friday holiday
    expect(cal.isBusinessDay('2027-01-01')).toBe(false); // recurring
    expect(cal.isBusinessDay('2026-12-24')).toBe(true);
  });
});
