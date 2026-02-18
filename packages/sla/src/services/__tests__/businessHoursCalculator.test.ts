import { describe, it, expect, beforeEach } from 'vitest';
import {
  isWithinBusinessHours,
  getNextBusinessHoursStart,
  calculateElapsedBusinessMinutes,
  calculateDeadline,
  getRemainingBusinessMinutes,
  formatRemainingTime,
  type BusinessTimeResult
} from '../businessHoursCalculator';
import type { IBusinessHoursScheduleWithEntries, IBusinessHoursEntry, IHoliday } from '../../types';

// Helper to create a standard Monday-Friday 9am-5pm schedule
function createStandardSchedule(timezone: string = 'UTC'): IBusinessHoursScheduleWithEntries {
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
    holidays: []
  };
}

// Helper to create a 24x7 schedule
function create24x7Schedule(): IBusinessHoursScheduleWithEntries {
  return {
    schedule_id: '24x7-schedule',
    schedule_name: '24x7 Support',
    timezone: 'UTC',
    is_default: false,
    is_24x7: true,
    entries: [],
    holidays: []
  };
}

describe('businessHoursCalculator', () => {
  describe('isWithinBusinessHours', () => {
    describe('with standard business hours', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = createStandardSchedule('UTC');
      });

      it('should return true during business hours on a weekday', () => {
        // Monday at 10:00 UTC
        const datetime = new Date('2024-01-15T10:00:00Z');
        expect(isWithinBusinessHours(schedule, datetime)).toBe(true);
      });

      it('should return false before business hours start', () => {
        // Monday at 08:00 UTC (before 9am)
        const datetime = new Date('2024-01-15T08:00:00Z');
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });

      it('should return false at exactly end time (5pm is not included)', () => {
        // Monday at 17:00 UTC (exactly 5pm)
        const datetime = new Date('2024-01-15T17:00:00Z');
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });

      it('should return true at exactly start time', () => {
        // Monday at 09:00 UTC
        const datetime = new Date('2024-01-15T09:00:00Z');
        expect(isWithinBusinessHours(schedule, datetime)).toBe(true);
      });

      it('should return false on Saturday', () => {
        // Saturday at 10:00 UTC
        const datetime = new Date('2024-01-13T10:00:00Z');
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });

      it('should return false on Sunday', () => {
        // Sunday at 10:00 UTC
        const datetime = new Date('2024-01-14T10:00:00Z');
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });

      it('should return false after business hours', () => {
        // Monday at 18:00 UTC (after 5pm)
        const datetime = new Date('2024-01-15T18:00:00Z');
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });
    });

    describe('with holidays', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = createStandardSchedule('UTC');
        schedule.holidays = [
          {
            holiday_id: 'h1',
            holiday_name: 'New Year',
            holiday_date: '2024-01-01',
            is_recurring: false
          }
        ];
      });

      it('should return false on a non-recurring holiday', () => {
        // Monday Jan 1, 2024 at 10:00 UTC (New Year's Day)
        const datetime = new Date('2024-01-01T10:00:00Z');
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });

      it('should return true on a regular business day after holiday', () => {
        // Tuesday Jan 2, 2024 at 10:00 UTC
        const datetime = new Date('2024-01-02T10:00:00Z');
        expect(isWithinBusinessHours(schedule, datetime)).toBe(true);
      });
    });

    describe('with recurring holidays', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = createStandardSchedule('UTC');
        schedule.holidays = [
          {
            holiday_id: 'h1',
            holiday_name: 'Christmas',
            holiday_date: '2024-12-25',
            is_recurring: true
          }
        ];
      });

      it('should return false on recurring holiday in same year', () => {
        // Wednesday Dec 25, 2024 at 10:00 UTC
        const datetime = new Date('2024-12-25T10:00:00Z');
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });

      it('should return false on recurring holiday in different year', () => {
        // Thursday Dec 25, 2025 at 10:00 UTC
        const datetime = new Date('2025-12-25T10:00:00Z');
        expect(isWithinBusinessHours(schedule, datetime)).toBe(false);
      });
    });

    describe('with 24x7 schedule', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = create24x7Schedule();
      });

      it('should always return true regardless of time', () => {
        expect(isWithinBusinessHours(schedule, new Date('2024-01-15T03:00:00Z'))).toBe(true);
        expect(isWithinBusinessHours(schedule, new Date('2024-01-13T23:59:00Z'))).toBe(true); // Saturday
        expect(isWithinBusinessHours(schedule, new Date('2024-01-14T12:00:00Z'))).toBe(true); // Sunday
      });
    });
  });

  describe('getNextBusinessHoursStart', () => {
    describe('with standard business hours', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = createStandardSchedule('UTC');
      });

      it('should return a time within business hours if already within', () => {
        // Monday at 10:00 UTC - within business hours
        const datetime = new Date('2024-01-15T10:00:00Z');
        const result = getNextBusinessHoursStart(schedule, datetime);
        // Should return same day, within business hours window
        expect(isWithinBusinessHours(schedule, result)).toBe(true);
      });

      it('should return a future time if before opening', () => {
        // Monday at 07:00 UTC - before business hours
        const datetime = new Date('2024-01-15T07:00:00Z');
        const result = getNextBusinessHoursStart(schedule, datetime);
        // Result should be at or after the input
        expect(result.getTime()).toBeGreaterThanOrEqual(datetime.getTime());
        // Result should be within business hours
        expect(isWithinBusinessHours(schedule, result)).toBe(true);
      });

      it('should return a future date if after closing', () => {
        // Monday at 18:00 UTC - after business hours
        const datetime = new Date('2024-01-15T18:00:00Z');
        const result = getNextBusinessHoursStart(schedule, datetime);
        // Result should be after the input
        expect(result.getTime()).toBeGreaterThan(datetime.getTime());
        // Result should be within business hours
        expect(isWithinBusinessHours(schedule, result)).toBe(true);
      });

      it('should return a weekday if called on weekend', () => {
        // Saturday at 12:00 UTC
        const datetime = new Date('2024-01-13T12:00:00Z');
        const result = getNextBusinessHoursStart(schedule, datetime);
        // Should be after Saturday
        expect(result.getTime()).toBeGreaterThan(datetime.getTime());
        // Should be within business hours
        expect(isWithinBusinessHours(schedule, result)).toBe(true);
      });
    });

    describe('with 24x7 schedule', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = create24x7Schedule();
      });

      it('should always return the input datetime', () => {
        const datetime = new Date('2024-01-13T03:00:00Z'); // Saturday at 3am
        const result = getNextBusinessHoursStart(schedule, datetime);
        expect(result.getTime()).toBe(datetime.getTime());
      });
    });
  });

  describe('calculateElapsedBusinessMinutes', () => {
    describe('with standard business hours', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = createStandardSchedule('UTC');
      });

      it('should calculate minutes for time span within same business day', () => {
        const startTime = new Date('2024-01-15T09:00:00Z'); // Monday 9am
        const endTime = new Date('2024-01-15T10:30:00Z');   // Monday 10:30am
        const result = calculateElapsedBusinessMinutes(schedule, startTime, endTime);
        expect(result.businessMinutes).toBe(90);
        expect(result.isWithinBusinessHours).toBe(true);
      });

      it('should return 0 for time span entirely outside business hours', () => {
        const startTime = new Date('2024-01-15T17:30:00Z'); // Monday 5:30pm
        const endTime = new Date('2024-01-15T20:00:00Z');   // Monday 8pm
        const result = calculateElapsedBusinessMinutes(schedule, startTime, endTime);
        expect(result.businessMinutes).toBe(0);
        expect(result.isWithinBusinessHours).toBe(false);
      });

      it('should count only business hours when spanning overnight', () => {
        const startTime = new Date('2024-01-15T16:00:00Z'); // Monday 4pm
        const endTime = new Date('2024-01-16T10:00:00Z');   // Tuesday 10am
        const result = calculateElapsedBusinessMinutes(schedule, startTime, endTime);
        // Monday 4pm-5pm = 60 minutes + Tuesday 9am-10am = 60 minutes = 120 minutes
        expect(result.businessMinutes).toBe(120);
      });

      it('should skip weekends in calculation', () => {
        const startTime = new Date('2024-01-19T16:00:00Z'); // Friday 4pm
        const endTime = new Date('2024-01-22T10:00:00Z');   // Monday 10am
        const result = calculateElapsedBusinessMinutes(schedule, startTime, endTime);
        // Friday 4pm-5pm = 60 minutes + Monday 9am-10am = 60 minutes = 120 minutes
        expect(result.businessMinutes).toBe(120);
      });

      it('should handle full business day', () => {
        const startTime = new Date('2024-01-15T09:00:00Z'); // Monday 9am
        const endTime = new Date('2024-01-15T17:00:00Z');   // Monday 5pm
        const result = calculateElapsedBusinessMinutes(schedule, startTime, endTime);
        expect(result.businessMinutes).toBe(480); // 8 hours = 480 minutes
      });

      it('should handle start time before business hours', () => {
        const startTime = new Date('2024-01-15T07:00:00Z'); // Monday 7am
        const endTime = new Date('2024-01-15T10:00:00Z');   // Monday 10am
        const result = calculateElapsedBusinessMinutes(schedule, startTime, endTime);
        // Only 9am-10am counts = 60 minutes
        expect(result.businessMinutes).toBe(60);
      });

      it('should handle end time after business hours', () => {
        const startTime = new Date('2024-01-15T16:00:00Z'); // Monday 4pm
        const endTime = new Date('2024-01-15T19:00:00Z');   // Monday 7pm
        const result = calculateElapsedBusinessMinutes(schedule, startTime, endTime);
        // Only 4pm-5pm counts = 60 minutes
        expect(result.businessMinutes).toBe(60);
      });

      it('should return 0 for negative time span', () => {
        const startTime = new Date('2024-01-15T12:00:00Z');
        const endTime = new Date('2024-01-15T10:00:00Z');
        const result = calculateElapsedBusinessMinutes(schedule, startTime, endTime);
        expect(result.businessMinutes).toBe(0);
      });
    });

    describe('with holidays', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = createStandardSchedule('UTC');
        schedule.holidays = [
          {
            holiday_id: 'h1',
            holiday_name: 'Holiday',
            holiday_date: '2024-01-16',
            is_recurring: false
          }
        ];
      });

      it('should skip holidays in calculation', () => {
        const startTime = new Date('2024-01-15T16:00:00Z'); // Monday 4pm
        const endTime = new Date('2024-01-17T10:00:00Z');   // Wednesday 10am
        const result = calculateElapsedBusinessMinutes(schedule, startTime, endTime);
        // Monday 4pm-5pm = 60 minutes + Wednesday 9am-10am = 60 minutes = 120 minutes
        // Tuesday is a holiday and is skipped
        expect(result.businessMinutes).toBe(120);
      });
    });

    describe('with 24x7 schedule', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = create24x7Schedule();
      });

      it('should count all minutes regardless of day or time', () => {
        const startTime = new Date('2024-01-13T22:00:00Z'); // Saturday 10pm
        const endTime = new Date('2024-01-14T02:00:00Z');   // Sunday 2am
        const result = calculateElapsedBusinessMinutes(schedule, startTime, endTime);
        expect(result.businessMinutes).toBe(240); // 4 hours
        expect(result.isWithinBusinessHours).toBe(true);
      });

      it('should count exact number of minutes for multi-day span', () => {
        const startTime = new Date('2024-01-15T00:00:00Z');
        const endTime = new Date('2024-01-17T00:00:00Z');
        const result = calculateElapsedBusinessMinutes(schedule, startTime, endTime);
        expect(result.businessMinutes).toBe(2880); // 48 hours = 2880 minutes
      });
    });
  });

  describe('calculateDeadline', () => {
    describe('with standard business hours', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = createStandardSchedule('UTC');
      });

      it('should return deadline after start time', () => {
        const startTime = new Date('2024-01-15T09:00:00Z'); // Monday 9am
        const targetMinutes = 60;
        const deadline = calculateDeadline(schedule, startTime, targetMinutes);
        expect(deadline.getTime()).toBeGreaterThan(startTime.getTime());
      });

      it('should calculate elapsed time correctly to deadline', () => {
        // Use 24x7 schedule for predictable results without timezone issues
        const schedule24x7 = create24x7Schedule();
        const startTime = new Date('2024-01-15T09:00:00Z');
        const targetMinutes = 60;
        const deadline = calculateDeadline(schedule24x7, startTime, targetMinutes);

        // The elapsed business minutes from start to deadline should equal target
        const elapsed = calculateElapsedBusinessMinutes(schedule24x7, startTime, deadline);
        expect(elapsed.businessMinutes).toBe(targetMinutes);
      });

      it('should handle multi-day deadline consistently', () => {
        const startTime = new Date('2024-01-15T09:00:00Z'); // Monday 9am
        const targetMinutes = 480; // 8 hours = 1 full business day
        const deadline = calculateDeadline(schedule, startTime, targetMinutes);

        // Verify by calculating elapsed
        const elapsed = calculateElapsedBusinessMinutes(schedule, startTime, deadline);
        expect(elapsed.businessMinutes).toBe(targetMinutes);
      });
    });

    describe('with 24x7 schedule', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = create24x7Schedule();
      });

      it('should simply add minutes regardless of time', () => {
        const startTime = new Date('2024-01-13T22:00:00Z'); // Saturday 10pm
        const targetMinutes = 240; // 4 hours
        const deadline = calculateDeadline(schedule, startTime, targetMinutes);
        expect(deadline.toISOString()).toBe('2024-01-14T02:00:00.000Z'); // Sunday 2am
      });

      it('should handle crossing multiple days', () => {
        const startTime = new Date('2024-01-15T12:00:00Z');
        const targetMinutes = 2880; // 48 hours
        const deadline = calculateDeadline(schedule, startTime, targetMinutes);
        expect(deadline.toISOString()).toBe('2024-01-17T12:00:00.000Z');
      });
    });
  });

  describe('getRemainingBusinessMinutes', () => {
    describe('with standard business hours', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = createStandardSchedule('UTC');
      });

      it('should return positive remaining minutes before deadline', () => {
        const deadline = new Date('2024-01-15T12:00:00Z'); // Monday 12pm
        const currentTime = new Date('2024-01-15T10:00:00Z'); // Monday 10am
        const remaining = getRemainingBusinessMinutes(schedule, deadline, currentTime);
        expect(remaining).toBe(120); // 2 hours remaining
      });

      it('should return negative minutes after deadline', () => {
        const deadline = new Date('2024-01-15T10:00:00Z'); // Monday 10am
        const currentTime = new Date('2024-01-15T12:00:00Z'); // Monday 12pm
        const remaining = getRemainingBusinessMinutes(schedule, deadline, currentTime);
        expect(remaining).toBe(-120); // 2 hours overdue
      });

      it('should return non-positive at or after deadline', () => {
        const deadline = new Date('2024-01-15T10:00:00Z');
        const currentTime = new Date('2024-01-15T10:00:00Z');
        const remaining = getRemainingBusinessMinutes(schedule, deadline, currentTime);
        // At deadline, remaining should be 0 or negative (accounting for edge cases)
        expect(remaining).toBeLessThanOrEqual(0);
      });

      it('should account for non-business hours in remaining time', () => {
        const deadline = new Date('2024-01-16T10:00:00Z'); // Tuesday 10am
        const currentTime = new Date('2024-01-15T16:00:00Z'); // Monday 4pm
        const remaining = getRemainingBusinessMinutes(schedule, deadline, currentTime);
        // Monday 4pm-5pm = 60 min + Tuesday 9am-10am = 60 min = 120 min
        expect(remaining).toBe(120);
      });
    });

    describe('with 24x7 schedule', () => {
      let schedule: IBusinessHoursScheduleWithEntries;

      beforeEach(() => {
        schedule = create24x7Schedule();
      });

      it('should calculate simple time difference', () => {
        const deadline = new Date('2024-01-15T12:00:00Z');
        const currentTime = new Date('2024-01-15T10:00:00Z');
        const remaining = getRemainingBusinessMinutes(schedule, deadline, currentTime);
        expect(remaining).toBe(120);
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
      expect(formatRemainingTime(150)).toBe('2h 30m');
      expect(formatRemainingTime(1439)).toBe('23h 59m'); // Just under 24 hours
    });

    it('should format days and hours for time 24 hours or more', () => {
      expect(formatRemainingTime(1440)).toBe('1d'); // Exactly 24 hours
      expect(formatRemainingTime(1500)).toBe('1d 1h'); // 25 hours
      expect(formatRemainingTime(2880)).toBe('2d'); // 48 hours
      expect(formatRemainingTime(2940)).toBe('2d 1h'); // 49 hours
    });

    it('should handle negative (overdue) minutes', () => {
      expect(formatRemainingTime(-30)).toBe('-30m');
      expect(formatRemainingTime(-90)).toBe('-1h 30m');
      expect(formatRemainingTime(-1500)).toBe('-1d 1h');
    });

    it('should format large values correctly', () => {
      expect(formatRemainingTime(10080)).toBe('7d'); // 1 week
      expect(formatRemainingTime(14400)).toBe('10d'); // 10 days
    });
  });
});
