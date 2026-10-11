import { describe, expect, it } from 'vitest';
import { classifyInstant } from '@alga-psa/shared/lib/businessHours/businessDayCalendar';
import { classifyWorkflowOccurrenceDay } from './workflowBusinessDayScheduling';

// The workflow classifier delegates to the shared business-day calendar. This pins that the two
// agree over a year of instants for several schedule shapes, so a future change to either side that
// breaks parity is caught here.
const resolutionBase = {
  scheduleId: 'schedule-1',
  scheduleName: 'Default',
  source: 'tenant_default' as const,
  scheduleTimezone: 'America/New_York',
};

const shapes = [
  { is24x7: false, entries: [1, 2, 3, 4, 5].map((d) => ({ tenant: 't', schedule_id: 's', day_of_week: d, is_enabled: true })), holidays: [] },
  { is24x7: true, entries: [], holidays: [{ tenant: 't', schedule_id: null, holiday_date: '2026-07-04', is_recurring: true }] },
  {
    is24x7: false,
    entries: [0, 6].map((d) => ({ tenant: 't', schedule_id: 's', day_of_week: d, is_enabled: true })),
    holidays: [{ tenant: 't', schedule_id: null, holiday_date: '2026-03-07', is_recurring: false }],
  },
];

describe('workflow classification parity with shared businessDayCalendar', () => {
  it.each(shapes.map((shape, index) => [index, shape] as const))('shape %i agrees for every day of 2026', (_i, shape) => {
    const resolution = { ...resolutionBase, ...shape };
    for (let day = 0; day < 365; day += 1) {
      const occurrence = new Date(Date.UTC(2026, 0, 1, 3, 30) + day * 24 * 60 * 60 * 1000);
      expect(classifyWorkflowOccurrenceDay({ occurrence, occurrenceTimezone: 'UTC', resolution })).toBe(
        classifyInstant(occurrence, resolution.scheduleTimezone, resolution)
      );
    }
  });
});
