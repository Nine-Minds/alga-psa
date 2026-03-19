import { describe, expect, it } from 'vitest';

import {
  buildCronFromRecurringBuilder,
  getRecurringBuilderSummary,
  getRecurringBuilderValidationMessage,
  parseRecurringBuilderFromCron,
} from './workflowScheduleRecurrence';

describe('workflowScheduleRecurrence', () => {
  it('builds cron strings for supported daily, weekly, and monthly builder states', () => {
    expect(buildCronFromRecurringBuilder({
      frequency: 'daily',
      time: '09:30',
      weekdays: [1],
      dayOfMonth: '1',
    })).toBe('30 9 * * *');

    expect(buildCronFromRecurringBuilder({
      frequency: 'weekly',
      time: '14:05',
      weekdays: [1, 3, 5],
      dayOfMonth: '1',
    })).toBe('5 14 * * 1,3,5');

    expect(buildCronFromRecurringBuilder({
      frequency: 'monthly',
      time: '18:45',
      weekdays: [1],
      dayOfMonth: '15',
    })).toBe('45 18 15 * *');
  });

  it('parses supported cron strings back into builder state', () => {
    expect(parseRecurringBuilderFromCron('0 9 * * *')).toEqual({
      frequency: 'daily',
      time: '09:00',
      weekdays: [1],
      dayOfMonth: '1',
    });

    expect(parseRecurringBuilderFromCron('0 9 * * 1-5')).toEqual({
      frequency: 'weekly',
      time: '09:00',
      weekdays: [1, 2, 3, 4, 5],
      dayOfMonth: '1',
    });

    expect(parseRecurringBuilderFromCron('30 6 10 * *')).toEqual({
      frequency: 'monthly',
      time: '06:30',
      weekdays: [1],
      dayOfMonth: '10',
    });
  });

  it('rejects unsupported cron expressions and builder states that fall outside the simple presets', () => {
    expect(parseRecurringBuilderFromCron('0 */2 * * *')).toBeNull();
    expect(parseRecurringBuilderFromCron('0 9 1 * 1')).toBeNull();
    expect(getRecurringBuilderValidationMessage({
      frequency: 'weekly',
      time: '09:00',
      weekdays: [],
      dayOfMonth: '1',
    })).toBe('Choose at least one weekday.');
  });

  it('formats a readable recurrence summary for supported builder states', () => {
    expect(getRecurringBuilderSummary({
      frequency: 'weekly',
      time: '09:00',
      weekdays: [1, 3, 5],
      dayOfMonth: '1',
    }, 'America/New_York')).toBe(
      'Runs every Monday, Wednesday, and Friday at 9:00 AM America/New_York'
    );
  });
});
