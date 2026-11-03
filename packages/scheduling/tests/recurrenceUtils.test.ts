/**
 * @alga-psa/scheduling - Recurrence Utils Tests
 *
 * Tests for generateOccurrences() and applyTimeToDate() utility functions.
 * These are pure functions that can be tested without database mocking.
 *
 * Note: generateOccurrences() normalizes range boundaries using setHours() in local
 * time, which means exact boundary behavior varies by timezone. Tests use wide ranges
 * and check for known interior dates rather than exact boundary inclusion.
 */

import { describe, it, expect } from 'vitest';
import { RRule } from 'rrule';
import { generateOccurrences, applyTimeToDate, MAX_CALENDAR_WINDOW_MS, RecurrenceOccurrenceLimitError } from '@alga-psa/shared/utils/recurrenceUtils';
import type { IScheduleEntry, IRecurrencePattern } from '@alga-psa/types';

/**
 * Helper to create a minimal IScheduleEntry for testing.
 */
function makeEntry(overrides: Partial<IScheduleEntry> = {}): IScheduleEntry {
  return {
    entry_id: 'entry-1',
    title: 'Test Entry',
    scheduled_start: new Date('2024-01-15T09:00:00Z'),
    scheduled_end: new Date('2024-01-15T10:00:00Z'),
    status: 'scheduled',
    work_item_id: null,
    work_item_type: 'ad_hoc',
    assigned_user_ids: [],
    is_recurring: false,
    tenant: 'test-tenant',
    ...overrides,
  } as IScheduleEntry;
}

function makePattern(overrides: Partial<IRecurrencePattern> = {}): IRecurrencePattern {
  return {
    frequency: 'daily',
    interval: 1,
    startDate: new Date('2024-01-15'),
    ...overrides,
  };
}

describe('applyTimeToDate', () => {
  it('should apply hours/minutes/seconds from time to date', () => {
    const date = new Date('2024-03-20T00:00:00');
    const time = new Date('2024-01-01T14:30:45.123');

    const result = applyTimeToDate(date, time);

    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(45);
    expect(result.getMilliseconds()).toBe(123);
    // Date portion should be preserved
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(2); // March = 2
    expect(result.getDate()).toBe(20);
  });

  it('should not mutate the original date', () => {
    const date = new Date('2024-03-20T00:00:00');
    const originalTime = date.getTime();
    const time = new Date('2024-01-01T14:30:00');

    applyTimeToDate(date, time);

    expect(date.getTime()).toBe(originalTime);
  });
});

describe('generateOccurrences', () => {
  describe('without recurrence pattern', () => {
    it('should return the entry scheduled_start when no recurrence_pattern', () => {
      const entry = makeEntry({ recurrence_pattern: undefined });
      const start = new Date('2024-01-01');
      const end = new Date('2024-01-31');

      const result = generateOccurrences(entry, start, end);

      expect(result).toHaveLength(1);
      expect(result[0].toISOString()).toBe(new Date('2024-01-15T09:00:00Z').toISOString());
    });
  });

  describe('daily recurrence', () => {
    it('should generate daily occurrences excluding master date', () => {
      const pattern = makePattern({
        frequency: 'daily',
        interval: 1,
        startDate: new Date('2024-01-15'),
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T10:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      // Use a wide range to avoid boundary issues
      const start = new Date('2024-01-14');
      const end = new Date('2024-01-20');

      const result = generateOccurrences(entry, start, end);
      const dates = result.map((d) => d.toISOString().split('T')[0]);

      // Should include several days after master
      expect(dates).toContain('2024-01-16');
      expect(dates).toContain('2024-01-17');
      expect(dates).toContain('2024-01-18');
      expect(dates).toContain('2024-01-19');
      // Master date should be excluded
      expect(dates).not.toContain('2024-01-15');
    });

    it('should apply the original entry time to each occurrence', () => {
      const pattern = makePattern({
        frequency: 'daily',
        interval: 1,
        startDate: new Date('2024-01-15'),
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T14:30:00'),
        scheduled_end: new Date('2024-01-15T15:30:00'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      const start = new Date('2024-01-15');
      const end = new Date('2024-01-20');

      const result = generateOccurrences(entry, start, end);

      expect(result.length).toBeGreaterThan(0);
      for (const occ of result) {
        // Time should match the master entry's scheduled_start time (local)
        expect(occ.getHours()).toBe(14);
        expect(occ.getMinutes()).toBe(30);
      }
    });

    it('should respect interval > 1', () => {
      const pattern = makePattern({
        frequency: 'daily',
        interval: 2, // every other day
        startDate: new Date('2024-01-15'),
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T10:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      const start = new Date('2024-01-14');
      const end = new Date('2024-01-30');

      const result = generateOccurrences(entry, start, end);

      // With interval=2, each consecutive occurrence should be exactly 2 days apart
      expect(result.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < result.length; i++) {
        const diffMs = result[i].getTime() - result[i - 1].getTime();
        const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
        expect(diffDays).toBe(2);
      }
    });
  });

  describe('weekly recurrence', () => {
    it('should generate weekly occurrences', () => {
      const pattern = makePattern({
        frequency: 'weekly',
        interval: 1,
        startDate: new Date('2024-01-15'), // Monday
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T10:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      const start = new Date('2024-01-14');
      const end = new Date('2024-02-28');

      const result = generateOccurrences(entry, start, end);

      // Should generate multiple weekly occurrences (master excluded)
      expect(result.length).toBeGreaterThanOrEqual(3);

      // Each consecutive occurrence should be exactly 7 days apart
      for (let i = 1; i < result.length; i++) {
        const diffMs = result[i].getTime() - result[i - 1].getTime();
        const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
        expect(diffDays).toBe(7);
      }

      // Master date should not be in the result
      const dates = result.map((d) => d.toISOString().split('T')[0]);
      expect(dates).not.toContain('2024-01-15');
    });

    it('should support daysOfWeek for weekly recurrence', () => {
      const pattern = makePattern({
        frequency: 'weekly',
        interval: 1,
        startDate: new Date('2024-01-15'), // Monday
        daysOfWeek: [0, 2, 4], // Mon, Wed, Fri
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T10:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      const start = new Date('2024-01-14');
      const end = new Date('2024-01-28');

      const result = generateOccurrences(entry, start, end);

      // All occurrences should fall on Mon(1), Wed(3), or Fri(5) UTC day-of-week
      for (const occ of result) {
        expect([1, 3, 5]).toContain(occ.getUTCDay());
      }
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('monthly recurrence', () => {
    it('should generate monthly occurrences', () => {
      const pattern = makePattern({
        frequency: 'monthly',
        interval: 1,
        startDate: new Date('2024-01-15'),
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T10:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      const start = new Date('2024-01-01');
      const end = new Date('2024-06-01');

      const result = generateOccurrences(entry, start, end);

      // Should generate multiple monthly occurrences (master excluded)
      expect(result.length).toBeGreaterThanOrEqual(3);

      // Each consecutive occurrence should be roughly 28-31 days apart (monthly)
      for (let i = 1; i < result.length; i++) {
        const diffMs = result[i].getTime() - result[i - 1].getTime();
        const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
        expect(diffDays).toBeGreaterThanOrEqual(28);
        expect(diffDays).toBeLessThanOrEqual(31);
      }

      // Master date should not be in the result
      const dates = result.map((d) => d.toISOString().split('T')[0]);
      expect(dates).not.toContain('2024-01-15');
    });
  });

  describe('endDate handling', () => {
    it('should not generate occurrences after endDate', () => {
      const pattern = makePattern({
        frequency: 'daily',
        interval: 1,
        startDate: new Date('2024-01-15'),
        endDate: new Date('2024-01-18'),
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T10:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      const start = new Date('2024-01-14');
      const end = new Date('2024-01-31');

      const result = generateOccurrences(entry, start, end);
      const dates = result.map((d) => d.toISOString().split('T')[0]);

      // Should have Jan 16, 17 at minimum (limited by endDate of Jan 18)
      expect(dates).toContain('2024-01-16');
      expect(dates).toContain('2024-01-17');
      // Should NOT have dates clearly after the endDate
      expect(dates).not.toContain('2024-01-20');
      expect(dates).not.toContain('2024-01-25');
    });
  });

  describe('count handling', () => {
    it('should limit occurrences by count', () => {
      const pattern = makePattern({
        frequency: 'daily',
        interval: 1,
        startDate: new Date('2024-01-15'),
        count: 5, // Only 5 total occurrences (including master)
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T10:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      const start = new Date('2024-01-14');
      const end = new Date('2024-01-31');

      const result = generateOccurrences(entry, start, end);

      // Count=5 means 5 total. Master (Jan 15) is excluded from result.
      // So we should get at most 4 virtual instances: Jan 16, 17, 18, 19
      expect(result.length).toBeLessThanOrEqual(4);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('exception dates', () => {
    it('should exclude exception dates from occurrences', () => {
      const pattern = makePattern({
        frequency: 'daily',
        interval: 1,
        startDate: new Date('2024-01-15'),
        exceptions: [new Date('2024-01-17'), new Date('2024-01-19')],
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T10:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      const start = new Date('2024-01-14');
      const end = new Date('2024-01-22');

      const result = generateOccurrences(entry, start, end);
      const dates = result.map((d) => d.toISOString().split('T')[0]);

      // Jan 16, 18, 20, 21 should be present
      expect(dates).toContain('2024-01-16');
      expect(dates).toContain('2024-01-18');
      expect(dates).toContain('2024-01-20');
      // Exception dates should be excluded
      expect(dates).not.toContain('2024-01-17');
      expect(dates).not.toContain('2024-01-19');
    });

    it('should handle exception dates as strings', () => {
      const pattern = makePattern({
        frequency: 'daily',
        interval: 1,
        startDate: new Date('2024-01-15'),
        exceptions: ['2024-01-17T00:00:00.000Z' as any],
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T10:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      const start = new Date('2024-01-14');
      const end = new Date('2024-01-20');

      const result = generateOccurrences(entry, start, end);
      const dates = result.map((d) => d.toISOString().split('T')[0]);

      expect(dates).not.toContain('2024-01-17'); // exception
      expect(dates).toContain('2024-01-16');
      expect(dates).toContain('2024-01-18');
    });

    it('should silently skip invalid exception dates', () => {
      const pattern = makePattern({
        frequency: 'daily',
        interval: 1,
        startDate: new Date('2024-01-15'),
        exceptions: ['not-a-date' as any, new Date('2024-01-17')],
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T10:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      const start = new Date('2024-01-14');
      const end = new Date('2024-01-20');

      const result = generateOccurrences(entry, start, end);
      const dates = result.map((d) => d.toISOString().split('T')[0]);

      // Jan 17 should still be excluded (valid exception)
      expect(dates).not.toContain('2024-01-17');
      // Other dates should be present
      expect(dates).toContain('2024-01-16');
      expect(dates).toContain('2024-01-18');
    });
  });

  describe('range filtering', () => {
    it('should only return occurrences within the range', () => {
      const pattern = makePattern({
        frequency: 'daily',
        interval: 1,
        startDate: new Date('2024-01-01'),
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-01T09:00:00Z'),
        scheduled_end: new Date('2024-01-01T10:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      // Small window well inside the series
      const start = new Date('2024-01-09');
      const end = new Date('2024-01-13');

      const result = generateOccurrences(entry, start, end);
      const dates = result.map((d) => d.toISOString().split('T')[0]);

      // Should include interior dates
      expect(dates).toContain('2024-01-10');
      expect(dates).toContain('2024-01-11');
      expect(dates).toContain('2024-01-12');
      // Should not include dates well outside the window
      expect(dates).not.toContain('2024-01-07');
      expect(dates).not.toContain('2024-01-15');
    });
  });

  describe('error handling', () => {
    it('should return scheduled_start as fallback for invalid pattern startDate', () => {
      const pattern = makePattern({
        startDate: new Date('invalid') as any,
      });
      const entry = makeEntry({
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        is_recurring: true,
        recurrence_pattern: pattern,
      });

      const result = generateOccurrences(entry, new Date('2024-01-01'), new Date('2024-01-31'));

      expect(result).toHaveLength(1);
      expect(result[0].toISOString()).toBe(new Date('2024-01-15T09:00:00Z').toISOString());
    });
  });
});

describe('calendar master occurrence', () => {
  it('includes the first event exactly once and retains the subsequent-only default', () => {
    const entry = makeEntry({ is_recurring: true, scheduled_start: new Date('2024-01-15T09:00:00'), scheduled_end: new Date('2024-01-15T10:00:00'),
      recurrence_pattern: makePattern({ startDate: new Date('2024-01-15T00:00:00'), count: 3 }) });
    const dates = (includeMaster: boolean) => generateOccurrences(entry, new Date('2024-01-14T00:00:00'), new Date('2024-01-19T00:00:00'), { includeMaster }).map(date => date.getDate());
    expect(dates(true)).toEqual([15, 16, 17]);
    expect(dates(false)).toEqual([16, 17]);
  });

  it('applies exceptions and holidays to the first event as to later occurrences', () => {
    const entry = makeEntry({ is_recurring: true, scheduled_start: new Date('2024-01-15T09:00:00'), scheduled_end: new Date('2024-01-15T10:00:00'),
      recurrence_pattern: makePattern({ startDate: new Date('2024-01-15T00:00:00'), count: 3, exceptions: [new Date('2024-01-15T09:00:00')] }) });
    expect(generateOccurrences(entry, new Date('2024-01-14T00:00:00'), new Date('2024-01-19T00:00:00'), {
      includeMaster: true, holidays: [{ holiday_date: '2024-01-16', is_recurring: false } as any],
    }).map(date => date.getDate())).toEqual([17]);
  });
});

describe('bounded recurrence generation', () => {
  const endless = makeEntry({ is_recurring: true, scheduled_start: new Date('1970-01-01T09:00:00Z'),
    scheduled_end: new Date('1970-01-01T10:00:00Z'), recurrence_pattern: makePattern({ startDate: new Date('1970-01-01T00:00:00Z') }) });

  it.each([
    ['daily interval alignment and large COUNT', makePattern({ startDate: new Date('2018-01-03T00:00:00Z'), interval: 3, count: 100000 })],
    ['daily weekday filter and large COUNT', makePattern({ startDate: new Date('2018-01-03T00:00:00Z'), interval: 2, daysOfWeek: [0, 2, 4], count: 100000 })],
    ['weekly interval and week boundary', makePattern({ frequency: 'weekly', startDate: new Date('2020-01-08T00:00:00Z'), interval: 2, daysOfWeek: [0, 3] })],
    ['weekly COUNT across interval weeks', makePattern({ frequency: 'weekly', startDate: new Date('2020-01-08T00:00:00Z'), interval: 2, daysOfWeek: [0, 3], count: 100000 })],
    ['weekly COUNT beginning mid-week', makePattern({ frequency: 'weekly', startDate: new Date('2026-11-04T00:00:00Z'), daysOfWeek: [0, 3], count: 1 })],
    ['daily UNTIL', makePattern({ startDate: new Date('2020-01-01T00:00:00Z'), interval: 2, endDate: new Date('2026-11-20T00:00:00Z') })],
    ['daily COUNT ordinal', makePattern({ startDate: new Date('2020-01-01T00:00:00Z'), interval: 2, count: 2000 })],
    ['daily COUNT with month selector', makePattern({ startDate: new Date('2018-01-01T00:00:00Z'), count: 100000, monthOfYear: 11 })],
    ['daily COUNT with day selector', makePattern({ startDate: new Date('2018-01-01T00:00:00Z'), count: 100000, dayOfMonth: 1 })],
    ['exclusions', makePattern({ startDate: new Date('2020-01-01T00:00:00Z'), interval: 2, exceptions: [new Date('2026-11-03T00:00:00Z')] })],
    ['timezone boundary dates', makePattern({ frequency: 'weekly', startDate: new Date('2024-03-03T00:00:00Z'), daysOfWeek: [0] })],
  ])('matches rrule.between exactly for %s', (_name, pattern) => {
    const entry = { ...endless, scheduled_start: new Date(pattern.startDate),
      scheduled_end: new Date(new Date(pattern.startDate).getTime() + 60 * 60 * 1000), recurrence_pattern: pattern };
    const start = new Date('2026-11-01T00:00:00');
    const end = new Date('2026-11-30T00:00:00');
    const dtstart = new Date(pattern.startDate);
    dtstart.setHours(0, 0, 0, 0);
    let until: Date | undefined;
    if (pattern.endDate) { until = new Date(pattern.endDate); until.setHours(23, 59, 59, 999); }
    const rule = new RRule({
      freq: RRule[pattern.frequency.toUpperCase() as 'DAILY' | 'WEEKLY'], interval: pattern.interval, dtstart, until, count: pattern.count,
      byweekday: pattern.daysOfWeek?.map(day => [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU][day]),
      bymonthday: pattern.dayOfMonth, bymonth: pattern.monthOfYear,
    });
    const rangeStart = new Date(start); rangeStart.setHours(0, 0, 0, 0); rangeStart.setSeconds(rangeStart.getSeconds() - 1);
    const rangeEnd = new Date(end); rangeEnd.setHours(23, 59, 59, 999);
    const expected = rule.between(rangeStart, rangeEnd, true)
      .map(day => applyTimeToDate(day, entry.scheduled_start))
      .filter(date => !pattern.exceptions?.some(exception => new Date(exception).toISOString().slice(0, 10) === date.toISOString().slice(0, 10)))
      .map(date => date.toISOString());
    const actual = generateOccurrences(entry, start, end, { includeMaster: true, maxOccurrences: 1000 }).map(date => date.toISOString());
    expect(actual).toEqual(expected);
  });

  it('seeks old daily series without charging periods before the requested window', () => {
    const old = { ...endless, scheduled_start: new Date('2018-01-01T09:00:00Z'),
      recurrence_pattern: makePattern({ startDate: new Date('2018-01-01T00:00:00Z'), count: 100000 }) };
    const budget = { remaining: 20 };
    const dates = generateOccurrences(old, new Date('2026-11-01'), new Date('2026-11-04'), { includeMaster: true, workBudget: budget });
    const days = dates.map(date => date.toISOString().slice(0, 10));
    expect(days).toEqual(expect.arrayContaining(['2026-11-01', '2026-11-02', '2026-11-03']));
    expect(budget.remaining).toBeGreaterThan(10);
  });

  it('reads a 1970 daily master in a recent month with the default occurrence budget', () => {
    const dates = generateOccurrences(endless, new Date('2026-11-01'), new Date('2026-12-01'), { includeMaster: true });
    const days = dates.map(date => date.toISOString().slice(0, 10));
    expect(days).toEqual(expect.arrayContaining(Array.from({ length: 30 }, (_, day) => `2026-11-${String(day + 1).padStart(2, '0')}`)));
    expect(dates.length).toBeLessThanOrEqual(32);
  });

  it('seeks four old weekly series within one shared request budget', () => {
    const budget = { remaining: 2000 };
    const rows = Array.from({ length: 4 }, (_, index) => ({ ...endless, entry_id: `weekly-${index}`,
      scheduled_start: new Date(`2020-01-0${index + 1}T09:00:00Z`), recurrence_pattern: makePattern({
        frequency: 'weekly', startDate: new Date(`2020-01-0${index + 1}T00:00:00Z`), daysOfWeek: [index],
      }) }));
    const dates = rows.flatMap(row => generateOccurrences(row, new Date('2026-11-01'), new Date('2026-11-30'), { includeMaster: true, workBudget: budget }));
    expect(dates.length).toBeGreaterThan(12);
    expect(budget.remaining).toBeGreaterThan(0);
  });

  it('bounds empty rules whose date filters never produce a callback', () => {
    const emptyRule = { ...endless, scheduled_start: new Date('2025-01-01T09:00:00Z'),
      recurrence_pattern: makePattern({ startDate: new Date('2025-01-01'), monthOfYear: 2, dayOfMonth: 30 }) };
    const workBudget = { remaining: 12 };
    expect(() => generateOccurrences(emptyRule, new Date('2025-01-01'), new Date('2025-01-02'), {
      maxOccurrences: 100, workBudget,
    })).toThrow(RecurrenceOccurrenceLimitError);
    expect(workBudget.remaining).toBe(0);
  });

  it('charges sparse recurrence periods while preserving matching leap-day results', () => {
    const sparseRule = { ...endless, scheduled_start: new Date(2024, 1, 29, 9),
      recurrence_pattern: makePattern({ startDate: new Date(2024, 1, 29), monthOfYear: 2, dayOfMonth: 29 }) };
    const workBudget = { remaining: 3000 };
    expect(generateOccurrences(sparseRule, new Date(2028, 1, 29), new Date(2028, 1, 29), {
      maxOccurrences: 10, workBudget,
    }).map(date => date.toISOString().slice(0, 10))).toEqual(['2028-02-29']);
    expect(workBudget.remaining).toBeGreaterThan(0);
    const shortBudget = { remaining: 12 };
    expect(() => generateOccurrences(sparseRule, new Date('2025-01-01'), new Date('2025-01-02'), {
      maxOccurrences: 100, workBudget: shortBudget,
    })).toThrow(RecurrenceOccurrenceLimitError);
    expect(shortBudget.remaining).toBe(0);
  });

  it('accepts an exact occurrence budget and rejects one occurrence beyond it', () => {
    const entry = { ...endless, recurrence_pattern: makePattern({ startDate: new Date('2024-01-01'), count: 3 }),
      scheduled_start: new Date('2024-01-01T09:00:00Z') };
    expect(generateOccurrences(entry, new Date('2024-01-01'), new Date('2024-01-03'), { maxOccurrences: 3, includeMaster: true })).toHaveLength(3);
    expect(() => generateOccurrences(entry, new Date('2024-01-01'), new Date('2024-01-03'), { maxOccurrences: 2, includeMaster: true }))
      .toThrow(RecurrenceOccurrenceLimitError);
  });

  it('retains normal results and exports the shared one-year calendar window', () => {
    const entry = { ...endless, recurrence_pattern: makePattern({ startDate: new Date('2024-01-01'), count: 3 }),
      scheduled_start: new Date('2024-01-01T09:00:00Z') };
    const results = generateOccurrences(entry, new Date('2024-01-01'), new Date('2024-01-03'), { maxOccurrences: 3, includeMaster: true });
    expect(results).toHaveLength(3);
    expect(results[1].getTime() - results[0].getTime()).toBe(24 * 60 * 60 * 1000);
    expect(results[2].getTime() - results[1].getTime()).toBe(24 * 60 * 60 * 1000);
    expect(MAX_CALENDAR_WINDOW_MS).toBe(366 * 24 * 60 * 60 * 1000);
  });

  it('preserves finite count and interval semantics when the requested window is after the series ended', () => {
    const entry = { ...endless, recurrence_pattern: makePattern({ startDate: new Date('2024-01-01'), interval: 2, count: 3 }),
      scheduled_start: new Date('2024-01-01T09:00:00Z') };
    expect(generateOccurrences(entry, new Date('2024-02-01'), new Date('2024-02-02'), { maxOccurrences: 10 })).toEqual([]);
  });
});
