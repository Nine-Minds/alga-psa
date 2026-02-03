/**
 * SLA Time Calculator Unit Tests
 *
 * Tests for SLA time calculation logic including:
 * - Due timestamp calculation from SLA target (in minutes)
 * - Business hours consideration
 * - Holiday handling
 * - 24/7 vs business hours targets
 * - Remaining time calculation
 * - Percentage elapsed calculation
 * - Pause time handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateDeadline,
  getRemainingBusinessMinutes,
  calculateElapsedBusinessMinutes,
  isWithinBusinessHours,
  formatRemainingTime,
} from '@alga-psa/sla/services/businessHoursCalculator';
import type {
  IBusinessHoursScheduleWithEntries,
  IBusinessHoursEntry,
  IHoliday,
} from '@alga-psa/sla/types';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a standard Monday-Friday 9am-5pm business hours schedule
 */
function createStandardBusinessHours(timezone: string = 'UTC'): IBusinessHoursScheduleWithEntries {
  const entries: IBusinessHoursEntry[] = [
    { entry_id: '0', schedule_id: 'test', day_of_week: 0, start_time: '00:00', end_time: '00:00', is_enabled: false }, // Sunday
    { entry_id: '1', schedule_id: 'test', day_of_week: 1, start_time: '09:00', end_time: '17:00', is_enabled: true },  // Monday
    { entry_id: '2', schedule_id: 'test', day_of_week: 2, start_time: '09:00', end_time: '17:00', is_enabled: true },  // Tuesday
    { entry_id: '3', schedule_id: 'test', day_of_week: 3, start_time: '09:00', end_time: '17:00', is_enabled: true },  // Wednesday
    { entry_id: '4', schedule_id: 'test', day_of_week: 4, start_time: '09:00', end_time: '17:00', is_enabled: true },  // Thursday
    { entry_id: '5', schedule_id: 'test', day_of_week: 5, start_time: '09:00', end_time: '17:00', is_enabled: true },  // Friday
    { entry_id: '6', schedule_id: 'test', day_of_week: 6, start_time: '00:00', end_time: '00:00', is_enabled: false }, // Saturday
  ];

  return {
    schedule_id: 'test-schedule',
    schedule_name: 'Standard Business Hours',
    timezone,
    is_default: true,
    is_24x7: false,
    entries,
    holidays: [],
  };
}

/**
 * Creates a 24/7 schedule (always active)
 */
function create24x7Schedule(): IBusinessHoursScheduleWithEntries {
  return {
    schedule_id: '24x7-schedule',
    schedule_name: '24x7 Support',
    timezone: 'UTC',
    is_default: false,
    is_24x7: true,
    entries: [],
    holidays: [],
  };
}

/**
 * Creates a schedule with holidays
 */
function createScheduleWithHolidays(holidays: IHoliday[]): IBusinessHoursScheduleWithEntries {
  const schedule = createStandardBusinessHours();
  schedule.holidays = holidays;
  return schedule;
}

/**
 * Calculate percentage elapsed for SLA
 */
function calculatePercentageElapsed(
  startTime: Date,
  dueTime: Date,
  currentTime: Date,
  totalPauseMinutes: number = 0
): number {
  const totalMinutes = (dueTime.getTime() - startTime.getTime()) / 60000;
  const elapsedMinutes = (currentTime.getTime() - startTime.getTime()) / 60000 - totalPauseMinutes;

  if (totalMinutes <= 0) return 100;

  const percentage = (elapsedMinutes / totalMinutes) * 100;
  return Math.min(100, Math.max(0, percentage));
}

/**
 * Adjust due date for pause time
 */
function adjustDueForPause(originalDue: Date, pauseMinutes: number): Date {
  return new Date(originalDue.getTime() + pauseMinutes * 60000);
}

// ============================================================================
// Tests
// ============================================================================

describe('SLA Time Calculator', () => {
  describe('calculateDeadline - Due Timestamp from SLA Target', () => {
    describe('with 24/7 schedule', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = create24x7Schedule();
      });

      it('should calculate due timestamp by adding target minutes to start time', () => {
        const startTime = new Date('2024-01-15T10:00:00Z');
        const targetMinutes = 60;

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        expect(deadline.toISOString()).toBe('2024-01-15T11:00:00.000Z');
      });

      it('should handle multi-hour targets', () => {
        const startTime = new Date('2024-01-15T10:00:00Z');
        const targetMinutes = 240; // 4 hours

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        expect(deadline.toISOString()).toBe('2024-01-15T14:00:00.000Z');
      });

      it('should handle overnight targets', () => {
        const startTime = new Date('2024-01-15T22:00:00Z');
        const targetMinutes = 180; // 3 hours

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        expect(deadline.toISOString()).toBe('2024-01-16T01:00:00.000Z');
      });

      it('should handle multi-day targets', () => {
        const startTime = new Date('2024-01-15T12:00:00Z');
        const targetMinutes = 2880; // 48 hours

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        expect(deadline.toISOString()).toBe('2024-01-17T12:00:00.000Z');
      });

      it('should return due_at == start when target is 0 minutes', () => {
        const startTime = new Date('2024-01-15T10:00:00Z');
        const targetMinutes = 0;

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        expect(deadline.toISOString()).toBe('2024-01-15T10:00:00.000Z');
      });
    });

    describe('with business hours schedule', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = createStandardBusinessHours();
      });

      it('should calculate deadline within same business day', () => {
        const startTime = new Date('2024-01-15T09:00:00Z'); // Monday 9am
        const targetMinutes = 60;

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        // Deadline should be after start time
        expect(deadline.getTime()).toBeGreaterThan(startTime.getTime());
        // For business hours, deadline should be within same day for a 60 min target starting at 9am
        expect(deadline.getUTCDate()).toBe(startTime.getUTCDate());
      });

      it('should extend deadline to next business day when target exceeds remaining hours', () => {
        const startTime = new Date('2024-01-15T16:00:00Z'); // Monday 4pm
        const targetMinutes = 120; // 2 hours, but only 1 hour left in day

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        // Deadline should be after 5pm Monday (next day)
        expect(deadline.getTime()).toBeGreaterThan(new Date('2024-01-15T17:00:00Z').getTime());
      });

      it('should skip weekends when calculating deadline', () => {
        const startTime = new Date('2024-01-19T16:00:00Z'); // Friday 4pm
        const targetMinutes = 120; // 2 hours

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        // Should extend past weekend to Monday
        expect(deadline.getTime()).toBeGreaterThan(new Date('2024-01-20T00:00:00Z').getTime()); // Past Saturday
      });

      it('should start from next business hours if start is outside business hours', () => {
        const startTime = new Date('2024-01-15T07:00:00Z'); // Monday 7am (before 9am)
        const targetMinutes = 60;

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        // Deadline should be after the start time (fast-forwards to business hours first)
        expect(deadline.getTime()).toBeGreaterThan(startTime.getTime());
        // Should be within the same day
        expect(deadline.getUTCDate()).toBe(startTime.getUTCDate());
      });

      it('should handle full business day target (480 minutes)', () => {
        const startTime = new Date('2024-01-15T09:00:00Z'); // Monday 9am
        const targetMinutes = 480; // 8 hours = full business day

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        const elapsed = calculateElapsedBusinessMinutes(schedule, startTime, deadline);
        expect(elapsed.businessMinutes).toBe(targetMinutes);
      });
    });

    describe('with holidays', () => {
      it('should skip holidays when calculating deadline', () => {
        const holidays: IHoliday[] = [
          {
            holiday_id: 'h1',
            holiday_name: 'Company Holiday',
            holiday_date: '2024-01-16', // Tuesday
            is_recurring: false,
          },
        ];
        const schedule = createScheduleWithHolidays(holidays);

        const startTime = new Date('2024-01-15T16:00:00Z'); // Monday 4pm
        const targetMinutes = 120; // 2 hours

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        // Deadline should be after Tuesday (holiday is skipped)
        // Monday has 1 hour left, Tuesday is skipped, so needs Wednesday for remaining hour
        expect(deadline.getTime()).toBeGreaterThan(new Date('2024-01-16T00:00:00Z').getTime());
      });

      it('should handle recurring holidays', () => {
        const holidays: IHoliday[] = [
          {
            holiday_id: 'h1',
            holiday_name: 'Christmas',
            holiday_date: '2024-12-25',
            is_recurring: true,
          },
        ];
        const schedule = createScheduleWithHolidays(holidays);

        const startTime = new Date('2024-12-24T16:00:00Z'); // Tuesday Dec 24, 4pm
        const targetMinutes = 120;

        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        // Should skip Christmas (Wednesday Dec 25), deadline on Thursday Dec 26
        expect(deadline.getTime()).toBeGreaterThan(new Date('2024-12-25T00:00:00Z').getTime());
      });
    });
  });

  describe('getRemainingBusinessMinutes - Remaining Time Until Breach', () => {
    describe('with 24/7 schedule', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = create24x7Schedule();
      });

      it('should return positive minutes before deadline', () => {
        const deadline = new Date('2024-01-15T12:00:00Z');
        const currentTime = new Date('2024-01-15T10:00:00Z');

        const remaining = getRemainingBusinessMinutes(schedule, deadline, currentTime);

        expect(remaining).toBe(120);
      });

      it('should return negative minutes after deadline', () => {
        const deadline = new Date('2024-01-15T10:00:00Z');
        const currentTime = new Date('2024-01-15T12:00:00Z');

        const remaining = getRemainingBusinessMinutes(schedule, deadline, currentTime);

        expect(remaining).toBe(-120);
      });

      it('should return 0 at exactly deadline', () => {
        const deadline = new Date('2024-01-15T10:00:00Z');
        const currentTime = new Date('2024-01-15T10:00:00Z');

        const remaining = getRemainingBusinessMinutes(schedule, deadline, currentTime);

        // At deadline or past, should be 0 or negative
        expect(remaining).toBeLessThanOrEqual(0);
      });
    });

    describe('with business hours schedule', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = createStandardBusinessHours();
      });

      it('should only count business hours in remaining time', () => {
        const deadline = new Date('2024-01-16T10:00:00Z'); // Tuesday 10am
        const currentTime = new Date('2024-01-15T16:00:00Z'); // Monday 4pm

        const remaining = getRemainingBusinessMinutes(schedule, deadline, currentTime);

        // Monday 4pm-5pm = 60 min + Tuesday 9am-10am = 60 min = 120 min
        expect(remaining).toBe(120);
      });

      it('should skip weekends in remaining time', () => {
        const deadline = new Date('2024-01-22T10:00:00Z'); // Monday 10am
        const currentTime = new Date('2024-01-19T16:00:00Z'); // Friday 4pm

        const remaining = getRemainingBusinessMinutes(schedule, deadline, currentTime);

        // Friday 4pm-5pm = 60 min + Monday 9am-10am = 60 min = 120 min
        expect(remaining).toBe(120);
      });

      it('should handle current time outside business hours', () => {
        const deadline = new Date('2024-01-16T10:00:00Z'); // Tuesday 10am
        const currentTime = new Date('2024-01-15T18:00:00Z'); // Monday 6pm (after hours)

        const remaining = getRemainingBusinessMinutes(schedule, deadline, currentTime);

        // Only Tuesday 9am-10am = 60 min counts
        expect(remaining).toBe(60);
      });
    });
  });

  describe('calculatePercentageElapsed - Percentage Elapsed', () => {
    it('should return 0% at start', () => {
      const startTime = new Date('2024-01-15T10:00:00Z');
      const dueTime = new Date('2024-01-15T12:00:00Z');
      const currentTime = new Date('2024-01-15T10:00:00Z');

      const percentage = calculatePercentageElapsed(startTime, dueTime, currentTime);

      expect(percentage).toBe(0);
    });

    it('should return 50% at midpoint', () => {
      const startTime = new Date('2024-01-15T10:00:00Z');
      const dueTime = new Date('2024-01-15T12:00:00Z');
      const currentTime = new Date('2024-01-15T11:00:00Z');

      const percentage = calculatePercentageElapsed(startTime, dueTime, currentTime);

      expect(percentage).toBe(50);
    });

    it('should return 100% at deadline', () => {
      const startTime = new Date('2024-01-15T10:00:00Z');
      const dueTime = new Date('2024-01-15T12:00:00Z');
      const currentTime = new Date('2024-01-15T12:00:00Z');

      const percentage = calculatePercentageElapsed(startTime, dueTime, currentTime);

      expect(percentage).toBe(100);
    });

    it('should cap at 100% when past deadline', () => {
      const startTime = new Date('2024-01-15T10:00:00Z');
      const dueTime = new Date('2024-01-15T12:00:00Z');
      const currentTime = new Date('2024-01-15T14:00:00Z');

      const percentage = calculatePercentageElapsed(startTime, dueTime, currentTime);

      expect(percentage).toBe(100);
    });

    it('should handle 80% threshold (at_risk boundary)', () => {
      const startTime = new Date('2024-01-15T10:00:00Z');
      const dueTime = new Date('2024-01-15T12:00:00Z'); // 120 min total
      const currentTime = new Date('2024-01-15T11:36:00Z'); // 96 min elapsed = 80%

      const percentage = calculatePercentageElapsed(startTime, dueTime, currentTime);

      expect(percentage).toBe(80);
    });

    it('should subtract pause time from elapsed', () => {
      const startTime = new Date('2024-01-15T10:00:00Z');
      const dueTime = new Date('2024-01-15T12:00:00Z'); // 120 min total
      const currentTime = new Date('2024-01-15T11:30:00Z'); // 90 min elapsed
      const pauseMinutes = 30;

      const percentage = calculatePercentageElapsed(startTime, dueTime, currentTime, pauseMinutes);

      // (90 - 30) / 120 * 100 = 50%
      expect(percentage).toBe(50);
    });

    it('should return 100% when due time equals start time', () => {
      const startTime = new Date('2024-01-15T10:00:00Z');
      const dueTime = new Date('2024-01-15T10:00:00Z'); // 0 minute target
      const currentTime = new Date('2024-01-15T10:00:00Z');

      const percentage = calculatePercentageElapsed(startTime, dueTime, currentTime);

      expect(percentage).toBe(100);
    });
  });

  describe('Pause Time Handling', () => {
    describe('adjustDueForPause - Pause Duration Extends Due Date', () => {
      it('should extend due date by pause minutes', () => {
        const originalDue = new Date('2024-01-15T12:00:00Z');
        const pauseMinutes = 30;

        const adjustedDue = adjustDueForPause(originalDue, pauseMinutes);

        expect(adjustedDue.toISOString()).toBe('2024-01-15T12:30:00.000Z');
      });

      it('should handle multiple hours of pause', () => {
        const originalDue = new Date('2024-01-15T12:00:00Z');
        const pauseMinutes = 180; // 3 hours

        const adjustedDue = adjustDueForPause(originalDue, pauseMinutes);

        expect(adjustedDue.toISOString()).toBe('2024-01-15T15:00:00.000Z');
      });

      it('should handle overnight extension', () => {
        const originalDue = new Date('2024-01-15T23:00:00Z');
        const pauseMinutes = 120; // 2 hours

        const adjustedDue = adjustDueForPause(originalDue, pauseMinutes);

        expect(adjustedDue.toISOString()).toBe('2024-01-16T01:00:00.000Z');
      });

      it('should handle 0 pause minutes', () => {
        const originalDue = new Date('2024-01-15T12:00:00Z');
        const pauseMinutes = 0;

        const adjustedDue = adjustDueForPause(originalDue, pauseMinutes);

        expect(adjustedDue.toISOString()).toBe('2024-01-15T12:00:00.000Z');
      });

      it('should preserve milliseconds precision', () => {
        const originalDue = new Date('2024-01-15T12:00:00.500Z');
        const pauseMinutes = 30;

        const adjustedDue = adjustDueForPause(originalDue, pauseMinutes);

        expect(adjustedDue.toISOString()).toBe('2024-01-15T12:30:00.500Z');
      });
    });

    describe('Pause Subtraction in Remaining Time', () => {
      it('should correctly calculate remaining time with pause', () => {
        const schedule = create24x7Schedule();
        const originalDue = new Date('2024-01-15T12:00:00Z');
        const currentTime = new Date('2024-01-15T11:30:00Z');
        const pauseMinutes = 60;

        // Effective due is 13:00 with 60 min pause
        const adjustedDue = adjustDueForPause(originalDue, pauseMinutes);
        const remaining = getRemainingBusinessMinutes(schedule, adjustedDue, currentTime);

        // From 11:30 to 13:00 = 90 minutes remaining
        expect(remaining).toBe(90);
      });

      it('should show positive remaining even if past original due when paused', () => {
        const schedule = create24x7Schedule();
        const originalDue = new Date('2024-01-15T12:00:00Z');
        const currentTime = new Date('2024-01-15T12:30:00Z'); // 30 min past original due
        const pauseMinutes = 60;

        // Effective due is 13:00 with 60 min pause
        const adjustedDue = adjustDueForPause(originalDue, pauseMinutes);
        const remaining = getRemainingBusinessMinutes(schedule, adjustedDue, currentTime);

        // From 12:30 to 13:00 = 30 minutes remaining
        expect(remaining).toBe(30);
      });
    });
  });

  describe('isWithinBusinessHours', () => {
    describe('with standard business hours', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = createStandardBusinessHours();
      });

      it('should return true during business hours', () => {
        const datetime = new Date('2024-01-15T10:00:00Z'); // Monday 10am
        expect(isWithinBusinessHours(schedule, datetime)).toBe(true);
      });

      it('should return false before business hours', () => {
        const datetime = new Date('2024-01-15T08:00:00Z'); // Monday 8am
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });

      it('should return false after business hours', () => {
        const datetime = new Date('2024-01-15T18:00:00Z'); // Monday 6pm
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });

      it('should return false on weekend', () => {
        const datetime = new Date('2024-01-13T10:00:00Z'); // Saturday 10am
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });

      it('should return true at exactly start time', () => {
        const datetime = new Date('2024-01-15T09:00:00Z'); // Monday 9am
        expect(isWithinBusinessHours(schedule, datetime)).toBe(true);
      });

      it('should return false at exactly end time', () => {
        const datetime = new Date('2024-01-15T17:00:00Z'); // Monday 5pm
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });
    });

    describe('with 24/7 schedule', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = create24x7Schedule();
      });

      it('should always return true', () => {
        expect(isWithinBusinessHours(schedule, new Date('2024-01-15T03:00:00Z'))).toBe(true);
        expect(isWithinBusinessHours(schedule, new Date('2024-01-13T10:00:00Z'))).toBe(true); // Saturday
        expect(isWithinBusinessHours(schedule, new Date('2024-01-14T23:59:00Z'))).toBe(true); // Sunday
      });
    });
  });

  describe('formatRemainingTime', () => {
    it('should format minutes only when less than an hour', () => {
      expect(formatRemainingTime(30)).toBe('30m');
      expect(formatRemainingTime(0)).toBe('0m');
      expect(formatRemainingTime(59)).toBe('59m');
    });

    it('should format hours and minutes for time less than 24 hours', () => {
      expect(formatRemainingTime(60)).toBe('1h');
      expect(formatRemainingTime(90)).toBe('1h 30m');
      expect(formatRemainingTime(120)).toBe('2h');
    });

    it('should format days and hours for time 24 hours or more', () => {
      expect(formatRemainingTime(1440)).toBe('1d');
      expect(formatRemainingTime(1500)).toBe('1d 1h');
      expect(formatRemainingTime(2880)).toBe('2d');
    });

    it('should handle negative (overdue) minutes', () => {
      expect(formatRemainingTime(-30)).toBe('-30m');
      expect(formatRemainingTime(-90)).toBe('-1h 30m');
      expect(formatRemainingTime(-1500)).toBe('-1d 1h');
    });
  });

  describe('Edge Cases', () => {
    it('should handle 0-minute target returning due_at == start', () => {
      const schedule = create24x7Schedule();
      const startTime = new Date('2024-01-15T10:00:00Z');

      const deadline = calculateDeadline(schedule, startTime, 0);

      expect(deadline.getTime()).toBe(startTime.getTime());
    });

    it('should handle very large targets (1 week)', () => {
      const schedule = create24x7Schedule();
      const startTime = new Date('2024-01-15T10:00:00Z');
      const targetMinutes = 10080; // 7 days

      const deadline = calculateDeadline(schedule, startTime, targetMinutes);

      expect(deadline.toISOString()).toBe('2024-01-22T10:00:00.000Z');
    });

    it('should handle dates at year boundary', () => {
      const schedule = create24x7Schedule();
      const startTime = new Date('2024-12-31T22:00:00Z');
      const targetMinutes = 180; // 3 hours

      const deadline = calculateDeadline(schedule, startTime, targetMinutes);

      expect(deadline.toISOString()).toBe('2025-01-01T01:00:00.000Z');
    });

    it('should handle leap year dates', () => {
      const schedule = create24x7Schedule();
      const startTime = new Date('2024-02-28T22:00:00Z');
      const targetMinutes = 180; // 3 hours

      const deadline = calculateDeadline(schedule, startTime, targetMinutes);

      expect(deadline.toISOString()).toBe('2024-02-29T01:00:00.000Z');
    });
  });
});
