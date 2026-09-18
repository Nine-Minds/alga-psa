import { describe, expect, it } from 'vitest';
import { availabilitySettingSchema } from '../src/schemas/appointmentSchemas';

describe('availabilitySettingSchema time handling', () => {
  const base = {
    setting_type: 'user_hours' as const,
    user_id: '11111111-1111-4111-8111-111111111111',
    day_of_week: 1,
    is_available: true,
  };

  // Postgres `time` columns read back as HH:MM:SS, so saving hours loaded from
  // the DB without touching the pickers used to fail validation.
  it('accepts HH:MM:SS round-tripped from the database and trims the seconds', () => {
    const parsed = availabilitySettingSchema.parse({
      ...base,
      start_time: '09:00:00',
      end_time: '17:00:00',
    });

    expect(parsed.start_time).toBe('09:00');
    expect(parsed.end_time).toBe('17:00');
  });

  it('still accepts plain HH:MM', () => {
    const parsed = availabilitySettingSchema.parse({ ...base, start_time: '09:30', end_time: '17:45' });
    expect(parsed.start_time).toBe('09:30');
    expect(parsed.end_time).toBe('17:45');
  });

  it('still rejects malformed times and inverted ranges', () => {
    expect(() => availabilitySettingSchema.parse({ ...base, start_time: '9:00', end_time: '17:00' })).toThrow();
    expect(() => availabilitySettingSchema.parse({ ...base, start_time: '25:00', end_time: '26:00' })).toThrow();
    expect(() => availabilitySettingSchema.parse({ ...base, start_time: '09:00:99', end_time: '17:00' })).toThrow();
    expect(() => availabilitySettingSchema.parse({ ...base, start_time: '17:00:00', end_time: '09:00:00' })).toThrow();
  });
});
