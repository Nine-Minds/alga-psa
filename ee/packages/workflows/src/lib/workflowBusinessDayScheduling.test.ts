import { describe, expect, it } from 'vitest';
import {
  classifyWorkflowOccurrenceDay,
  computeNextEligibleRecurringFireAt,
  isWorkflowOccurrenceEligible
} from './workflowBusinessDayScheduling';

const baseResolution = {
  scheduleId: 'schedule-1',
  scheduleName: 'Default',
  source: 'tenant_default' as const,
  scheduleTimezone: 'UTC',
  is24x7: false,
  entries: [],
  holidays: []
};

describe('workflowBusinessDayScheduling', () => {
  it('T006: classifies holidays as non-business days even for 24x7 schedules', () => {
    const classification = classifyWorkflowOccurrenceDay({
      occurrence: new Date('2026-12-25T10:00:00.000Z'),
      occurrenceTimezone: 'UTC',
      resolution: {
        ...baseResolution,
        is24x7: true,
        holidays: [
          { tenant: 'tenant-1', schedule_id: null, holiday_date: '2026-12-25', is_recurring: false }
        ]
      }
    });

    expect(classification).toBe('non_business');
    expect(isWorkflowOccurrenceEligible({
      dayTypeFilter: 'non_business',
      occurrence: new Date('2026-12-25T10:00:00.000Z'),
      occurrenceTimezone: 'UTC',
      resolution: {
        ...baseResolution,
        is24x7: true,
        holidays: [
          { tenant: 'tenant-1', schedule_id: null, holiday_date: '2026-12-25', is_recurring: false }
        ]
      }
    })).toBe(true);
  });

  it('treats Date-valued holiday rows as holidays', () => {
    const classification = classifyWorkflowOccurrenceDay({
      occurrence: new Date('2026-12-25T10:00:00.000Z'),
      occurrenceTimezone: 'UTC',
      resolution: {
        ...baseResolution,
        is24x7: true,
        holidays: [
          { tenant: 'tenant-1', schedule_id: null, holiday_date: new Date('2026-12-25T00:00:00.000Z'), is_recurring: false }
        ]
      }
    });

    expect(classification).toBe('non_business');
  });

  it('T007: classifies non-holiday dates as business days only when the weekday is enabled', () => {
    const weekdayResolution = {
      ...baseResolution,
      is24x7: false,
      entries: [
        { tenant: 'tenant-1', schedule_id: 'schedule-1', day_of_week: 1, is_enabled: true },
        { tenant: 'tenant-1', schedule_id: 'schedule-1', day_of_week: 2, is_enabled: false }
      ]
    };

    const monday = classifyWorkflowOccurrenceDay({
      occurrence: new Date('2026-04-13T12:00:00.000Z'),
      occurrenceTimezone: 'UTC',
      resolution: weekdayResolution
    });
    const tuesday = classifyWorkflowOccurrenceDay({
      occurrence: new Date('2026-04-14T12:00:00.000Z'),
      occurrenceTimezone: 'UTC',
      resolution: weekdayResolution
    });

    expect(monday).toBe('business');
    expect(tuesday).toBe('non_business');
  });

  it('uses the resolved business-hours schedule timezone when classifying a workflow occurrence day', () => {
    const classification = classifyWorkflowOccurrenceDay({
      occurrence: new Date('2026-04-14T06:30:00.000Z'),
      occurrenceTimezone: 'America/Los_Angeles',
      resolution: {
        ...baseResolution,
        scheduleTimezone: 'America/New_York',
        entries: [
          { tenant: 'tenant-1', schedule_id: 'schedule-1', day_of_week: 2, is_enabled: true }
        ]
      }
    });

    expect(classification).toBe('business');
  });

  it('T015: finds next eligible recurring occurrence within bounds and returns null when none is found', () => {
    const resolution = {
      ...baseResolution,
      entries: [
        { tenant: 'tenant-1', schedule_id: 'schedule-1', day_of_week: 1, is_enabled: true }
      ]
    };

    const nextMonday = computeNextEligibleRecurringFireAt({
      cron: '0 9 * * *',
      timezone: 'UTC',
      dayTypeFilter: 'business',
      resolution,
      after: new Date('2026-04-12T00:00:00.000Z'),
      maxOccurrences: 10,
      maxDaysAhead: 14
    });
    expect(nextMonday).toBe('2026-04-13T09:00:00.000Z');

    const noResultWithinCap = computeNextEligibleRecurringFireAt({
      cron: '0 9 * * *',
      timezone: 'UTC',
      dayTypeFilter: 'business',
      resolution,
      after: new Date('2026-04-12T00:00:00.000Z'),
      maxOccurrences: 1,
      maxDaysAhead: 0
    });
    expect(noResultWithinCap).toBeNull();
  });
});
