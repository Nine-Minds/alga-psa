import { describe, expect, it } from 'vitest';
import { availabilityUserHoursWeekSchema } from '../src/schemas/appointmentSchemas';
import {
  buildDefaultUserHours,
  hydrateUserHours,
  normalizeAvailabilityTime,
  userHoursToOrderedWeek,
} from '../src/lib/availabilityUserHours';

const userId = '00000000-0000-4000-8000-000000000001';

describe('availability user-hours model', () => {
  it('creates an explicit unsaved Monday-Friday 9-to-5 week', () => {
    const hydrated = hydrateUserHours([]);

    expect(hydrated.source).toBe('draft');
    expect(Object.keys(hydrated.hours)).toHaveLength(7);
    expect(hydrated.hours[3]).toEqual({
      day_of_week: 3,
      is_available: true,
      start_time: '09:00',
      end_time: '17:00',
    });
    expect(hydrated.hours[0].is_available).toBe(false);
    expect(hydrated.hours[6].is_available).toBe(false);
  });

  it('normalizes database time values to HH:MM', () => {
    expect(normalizeAvailabilityTime('09:00:00', '08:00')).toBe('09:00');
    expect(normalizeAvailabilityTime('16:30:00.000000', '17:00')).toBe('16:30');
    expect(normalizeAvailabilityTime('invalid', '17:00')).toBe('17:00');
  });

  it('preserves every other day when only Wednesday is edited', () => {
    const hours = buildDefaultUserHours();
    hours[3] = { ...hours[3], end_time: '16:30' };
    const ordered = userHoursToOrderedWeek(hours);

    expect(ordered).toHaveLength(7);
    expect(ordered[3].end_time).toBe('16:30');
    expect(ordered.filter((day) => day.day_of_week !== 3).every((day) => day.end_time === '17:00')).toBe(true);
  });

  it('rejects an incomplete or duplicate whole week before persistence', () => {
    const days = userHoursToOrderedWeek(buildDefaultUserHours());
    const base = { user_id: userId, days, buffer_before_minutes: 0, buffer_after_minutes: 15, config_json: {} };

    expect(availabilityUserHoursWeekSchema.safeParse(base).success).toBe(true);
    expect(availabilityUserHoursWeekSchema.safeParse({ ...base, days: days.slice(0, 6) }).success).toBe(false);
    expect(availabilityUserHoursWeekSchema.safeParse({ ...base, days: [...days.slice(0, 6), days[5]] }).success).toBe(false);
  });
});
