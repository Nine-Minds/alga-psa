import { describe, expect, it } from 'vitest';
import {
  ALLOWED_SCHEDULE_REMINDER_LEAD_MINUTES,
  DEFAULT_SCHEDULE_REMINDER_LEAD_MINUTES,
  normalizeScheduleReminderLeadMinutes,
} from './scheduleReminderPreferences';

describe('normalizeScheduleReminderLeadMinutes', () => {
  it('exports the allowed set and default', () => {
    expect([...ALLOWED_SCHEDULE_REMINDER_LEAD_MINUTES]).toEqual([0, 5, 10, 15, 30, 60]);
    expect([...DEFAULT_SCHEDULE_REMINDER_LEAD_MINUTES]).toEqual([15]);
  });
  it('unset -> [15]', () => {
    expect(normalizeScheduleReminderLeadMinutes(undefined)).toEqual([15]);
    expect(normalizeScheduleReminderLeadMinutes(null)).toEqual([15]);
  });
  it('explicit [] -> [] (off)', () => {
    expect(normalizeScheduleReminderLeadMinutes([])).toEqual([]);
    expect(normalizeScheduleReminderLeadMinutes('[]')).toEqual([]);
  });
  it('dedupes and sorts', () => {
    expect(normalizeScheduleReminderLeadMinutes([60, 5, 15, 5, 0])).toEqual([0, 5, 15, 60]);
  });
  it('drops disallowed and invalid entries', () => {
    expect(normalizeScheduleReminderLeadMinutes([7, 15, -5, '30', 5.5, null, 120])).toEqual([15]);
    expect(normalizeScheduleReminderLeadMinutes([7])).toEqual([]);
  });
  it('bad JSON or non-array -> [15]', () => {
    expect(normalizeScheduleReminderLeadMinutes('{oops')).toEqual([15]);
    expect(normalizeScheduleReminderLeadMinutes('15')).toEqual([15]);
    expect(normalizeScheduleReminderLeadMinutes({ a: 1 })).toEqual([15]);
  });
  it('parses stored JSON strings', () => {
    expect(normalizeScheduleReminderLeadMinutes('[30,5]')).toEqual([5, 30]);
  });
});
