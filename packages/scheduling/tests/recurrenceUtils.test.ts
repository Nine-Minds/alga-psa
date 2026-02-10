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
import { generateOccurrences, applyTimeToDate } from '../src/utils/recurrenceUtils';
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
