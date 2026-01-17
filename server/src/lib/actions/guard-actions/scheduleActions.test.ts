import { describe, it, expect } from 'vitest';
import {
  validateTimeFormat,
  validateDayOfMonth,
  calculateNextRunAt,
} from './scheduleUtils';

describe('Schedule Actions - validateTimeFormat', () => {
  describe('valid time formats', () => {
    it('should accept 00:00', () => {
      expect(validateTimeFormat('00:00')).toBe(true);
    });

    it('should accept 23:59', () => {
      expect(validateTimeFormat('23:59')).toBe(true);
    });

    it('should accept 12:00', () => {
      expect(validateTimeFormat('12:00')).toBe(true);
    });

    it('should accept 09:30', () => {
      expect(validateTimeFormat('09:30')).toBe(true);
    });

    it('should accept single digit hour (9:30)', () => {
      expect(validateTimeFormat('9:30')).toBe(true);
    });

    it('should accept early morning times', () => {
      expect(validateTimeFormat('05:00')).toBe(true);
      expect(validateTimeFormat('06:30')).toBe(true);
    });

    it('should accept late night times', () => {
      expect(validateTimeFormat('22:45')).toBe(true);
      expect(validateTimeFormat('23:00')).toBe(true);
    });
  });

  describe('invalid time formats', () => {
    it('should reject 24:00', () => {
      expect(validateTimeFormat('24:00')).toBe(false);
    });

    it('should reject 25:00', () => {
      expect(validateTimeFormat('25:00')).toBe(false);
    });

    it('should reject 12:60', () => {
      expect(validateTimeFormat('12:60')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateTimeFormat('')).toBe(false);
    });

    it('should reject invalid format without colon', () => {
      expect(validateTimeFormat('1200')).toBe(false);
    });

    it('should reject 12-hour format with AM/PM', () => {
      expect(validateTimeFormat('12:00 PM')).toBe(false);
      expect(validateTimeFormat('9:00 AM')).toBe(false);
    });

    it('should reject negative times', () => {
      expect(validateTimeFormat('-1:00')).toBe(false);
    });

    it('should reject seconds format', () => {
      expect(validateTimeFormat('12:00:00')).toBe(false);
    });
  });
});

describe('Schedule Actions - validateDayOfMonth', () => {
  describe('valid days', () => {
    it('should accept day 1', () => {
      expect(validateDayOfMonth(1)).toBe(true);
    });

    it('should accept day 15', () => {
      expect(validateDayOfMonth(15)).toBe(true);
    });

    it('should accept day 28', () => {
      expect(validateDayOfMonth(28)).toBe(true);
    });
  });

  describe('invalid days', () => {
    it('should reject day 0', () => {
      expect(validateDayOfMonth(0)).toBe(false);
    });

    it('should reject day 29 (not all months have it)', () => {
      expect(validateDayOfMonth(29)).toBe(false);
    });

    it('should reject day 30', () => {
      expect(validateDayOfMonth(30)).toBe(false);
    });

    it('should reject day 31', () => {
      expect(validateDayOfMonth(31)).toBe(false);
    });

    it('should reject negative days', () => {
      expect(validateDayOfMonth(-1)).toBe(false);
    });

    it('should reject floating point numbers', () => {
      expect(validateDayOfMonth(1.5)).toBe(false);
    });
  });
});

describe('Schedule Actions - calculateNextRunAt', () => {
  // Use a fixed reference date for consistent testing
  const referenceDate = new Date('2026-01-17T10:00:00Z'); // Saturday

  describe('daily schedules', () => {
    it('should schedule for today if time has not passed', () => {
      const result = calculateNextRunAt(
        'daily',
        '14:00',
        'UTC',
        undefined,
        undefined,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDate()).toBe(17);
      expect(result.getUTCHours()).toBe(14);
      expect(result.getUTCMinutes()).toBe(0);
    });

    it('should schedule for tomorrow if time has passed', () => {
      const result = calculateNextRunAt(
        'daily',
        '08:00',
        'UTC',
        undefined,
        undefined,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDate()).toBe(18);
      expect(result.getUTCHours()).toBe(8);
    });

    it('should schedule for tomorrow if exact time matches', () => {
      const result = calculateNextRunAt(
        'daily',
        '10:00',
        'UTC',
        undefined,
        undefined,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDate()).toBe(18);
    });
  });

  describe('weekly schedules', () => {
    it('should schedule for next occurrence of specified day', () => {
      // Saturday Jan 17, schedule for Monday
      const result = calculateNextRunAt(
        'weekly',
        '09:00',
        'UTC',
        'monday',
        undefined,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDate()).toBe(19); // Monday Jan 19
      expect(result.getUTCDay()).toBe(1); // Monday
    });

    it('should schedule for same day next week if day has passed', () => {
      // Saturday Jan 17, schedule for Friday
      const result = calculateNextRunAt(
        'weekly',
        '09:00',
        'UTC',
        'friday',
        undefined,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDay()).toBe(5); // Friday
      expect(result.getUTCDate()).toBe(23); // Friday Jan 23
    });

    it('should schedule for same day this week if time has not passed', () => {
      // Saturday Jan 17, 10:00, schedule for Saturday 14:00
      const result = calculateNextRunAt(
        'weekly',
        '14:00',
        'UTC',
        'saturday',
        undefined,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDay()).toBe(6); // Saturday
      expect(result.getUTCDate()).toBe(17); // Same day
      expect(result.getUTCHours()).toBe(14);
    });

    it('should schedule for next week if same day and time has passed', () => {
      // Saturday Jan 17, 10:00, schedule for Saturday 08:00
      const result = calculateNextRunAt(
        'weekly',
        '08:00',
        'UTC',
        'saturday',
        undefined,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDay()).toBe(6); // Saturday
      expect(result.getUTCDate()).toBe(24); // Next Saturday
    });
  });

  describe('monthly schedules', () => {
    it('should schedule for specified day this month if not passed', () => {
      // Jan 17, schedule for 20th
      const result = calculateNextRunAt(
        'monthly',
        '09:00',
        'UTC',
        undefined,
        20,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDate()).toBe(20);
      expect(result.getUTCMonth()).toBe(0); // January
    });

    it('should schedule for next month if day has passed', () => {
      // Jan 17, schedule for 15th
      const result = calculateNextRunAt(
        'monthly',
        '09:00',
        'UTC',
        undefined,
        15,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDate()).toBe(15);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it('should schedule for same day next month if day and time have passed', () => {
      // Jan 17, 10:00, schedule for 17th at 08:00
      const result = calculateNextRunAt(
        'monthly',
        '08:00',
        'UTC',
        undefined,
        17,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDate()).toBe(17);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it('should handle first of month', () => {
      // Jan 17, schedule for 1st
      const result = calculateNextRunAt(
        'monthly',
        '09:00',
        'UTC',
        undefined,
        1,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDate()).toBe(1);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it('should handle 28th (max allowed)', () => {
      // Jan 17, schedule for 28th
      const result = calculateNextRunAt(
        'monthly',
        '09:00',
        'UTC',
        undefined,
        28,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCDate()).toBe(28);
      expect(result.getUTCMonth()).toBe(0); // January
    });
  });

  describe('time handling', () => {
    it('should set correct hours and minutes', () => {
      const result = calculateNextRunAt(
        'daily',
        '14:30',
        'UTC',
        undefined,
        undefined,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCHours()).toBe(14);
      expect(result.getUTCMinutes()).toBe(30);
      expect(result.getUTCSeconds()).toBe(0);
    });

    it('should handle midnight', () => {
      const result = calculateNextRunAt(
        'daily',
        '00:00',
        'UTC',
        undefined,
        undefined,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCHours()).toBe(0);
      expect(result.getUTCMinutes()).toBe(0);
    });

    it('should handle end of day', () => {
      const result = calculateNextRunAt(
        'daily',
        '23:59',
        'UTC',
        undefined,
        undefined,
        new Date('2026-01-17T10:00:00Z')
      );
      expect(result.getUTCHours()).toBe(23);
      expect(result.getUTCMinutes()).toBe(59);
    });
  });

  describe('edge cases', () => {
    it('should handle year boundary', () => {
      // December 31, schedule for 5th of month
      const result = calculateNextRunAt(
        'monthly',
        '09:00',
        'UTC',
        undefined,
        5,
        new Date('2026-12-31T10:00:00Z')
      );
      expect(result.getUTCMonth()).toBe(0); // January
      expect(result.getUTCFullYear()).toBe(2027);
    });

    it('should handle leap year February', () => {
      // 2024 is a leap year, schedule for 28th in February
      const result = calculateNextRunAt(
        'monthly',
        '09:00',
        'UTC',
        undefined,
        28,
        new Date('2024-02-15T10:00:00Z')
      );
      expect(result.getUTCDate()).toBe(28);
      expect(result.getUTCMonth()).toBe(1); // February
    });
  });
});
