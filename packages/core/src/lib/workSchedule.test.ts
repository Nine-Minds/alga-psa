import { describe, expect, it } from 'vitest';
import {
  dailyScheduledHours,
  parseWorkSchedule,
  scheduledHoursForRange,
  weeklyScheduledHours,
  type WorkScheduleDay,
} from './workSchedule';

function day(dayOfWeek: number, startTime: string, endTime: string, isWorking = true): WorkScheduleDay {
  return { dayOfWeek: dayOfWeek as WorkScheduleDay['dayOfWeek'], isWorking, startTime, endTime };
}

// Mon-Fri 09:00-17:00, weekends off.
const MON_TO_FRI: WorkScheduleDay[] = [
  day(0, '09:00', '17:00', false),
  day(1, '09:00', '17:00'),
  day(2, '09:00', '17:00'),
  day(3, '09:00', '17:00'),
  day(4, '09:00', '17:00'),
  day(5, '09:00', '17:00'),
  day(6, '09:00', '17:00', false),
];

describe('dailyScheduledHours', () => {
  it('measures the working window', () => {
    expect(dailyScheduledHours(day(1, '09:00', '17:00'))).toBe(8);
    expect(dailyScheduledHours(day(1, '08:30', '12:15'))).toBe(3.75);
  });

  it('contributes nothing for days off or unusable windows', () => {
    expect(dailyScheduledHours(day(0, '09:00', '17:00', false))).toBe(0);
    expect(dailyScheduledHours(day(1, '17:00', '09:00'))).toBe(0);
    expect(dailyScheduledHours(day(1, '09:00', '09:00'))).toBe(0);
    expect(dailyScheduledHours(day(1, 'nope', '17:00'))).toBe(0);
  });
});

describe('weeklyScheduledHours', () => {
  it('sums the working days only', () => {
    expect(weeklyScheduledHours(MON_TO_FRI)).toBe(40);
  });
});

describe('scheduledHoursForRange', () => {
  // 2026-07-27 is a Monday, so a 7-day range ending there runs Tue..Mon.
  it('counts the real weekdays in the range, not weekly / 7', () => {
    expect(scheduledHoursForRange(MON_TO_FRI, 7, '2026-07-27')).toBe(40);
  });

  it('distinguishes ranges that land differently across the weekend', () => {
    // Mon 2026-07-20 .. Sun 2026-07-26 is 5 working days.
    expect(scheduledHoursForRange(MON_TO_FRI, 7, '2026-07-26')).toBe(40);
    // Sat 2026-07-18 .. Fri 2026-07-24: 5 working days as well, but a 5-day
    // window ending Sunday only covers three.
    expect(scheduledHoursForRange(MON_TO_FRI, 5, '2026-07-26')).toBe(24);
    expect(scheduledHoursForRange(MON_TO_FRI, 5, '2026-07-24')).toBe(40);
  });

  it('prorates a 30-day range by actual working days', () => {
    // Sun 2026-06-28..Mon 2026-07-27 contains 21 weekdays, so 168h. The old
    // weekly/7 approximation would have claimed 40 * 30 / 7 = 171.4h.
    expect(scheduledHoursForRange(MON_TO_FRI, 30, '2026-07-27')).toBe(168);
    expect(Math.round((40 * 30) / 7 * 10) / 10).toBe(171.4);
  });

  it('returns null when there is no schedule at all', () => {
    expect(scheduledHoursForRange([], 30, '2026-07-27')).toBeNull();
  });

  it('returns zero when every day is marked off', () => {
    const allOff = MON_TO_FRI.map((entry) => ({ ...entry, isWorking: false }));
    expect(scheduledHoursForRange(allOff, 30, '2026-07-27')).toBe(0);
  });

  it('is not thrown off by an unparseable end date', () => {
    expect(scheduledHoursForRange(MON_TO_FRI, 30, 'not-a-date')).toBeNull();
  });
});

describe('parseWorkSchedule', () => {
  it('accepts a well-formed schedule and normalizes times to HH:MM', () => {
    const parsed = parseWorkSchedule([{ dayOfWeek: 1, isWorking: true, startTime: '09:00:00', endTime: '17:30:00' }]);
    expect(parsed).toEqual({ ok: true, value: [{ dayOfWeek: 1, isWorking: true, startTime: '09:00', endTime: '17:30' }] });
  });

  it('rejects days outside 0-6 and repeated days', () => {
    expect(parseWorkSchedule([{ dayOfWeek: 7, isWorking: true, startTime: '09:00', endTime: '17:00' }])).toEqual({
      ok: false,
      reason: 'bad_day',
    });
    expect(
      parseWorkSchedule([
        { dayOfWeek: 1, isWorking: true, startTime: '09:00', endTime: '17:00' },
        { dayOfWeek: 1, isWorking: true, startTime: '09:00', endTime: '17:00' },
      ]),
    ).toEqual({ ok: false, reason: 'duplicate_day' });
  });

  it('rejects unusable windows before they can violate the table CHECK', () => {
    expect(parseWorkSchedule([{ dayOfWeek: 1, isWorking: true, startTime: '25:00', endTime: '17:00' }])).toEqual({
      ok: false,
      reason: 'bad_time',
    });
    expect(parseWorkSchedule([{ dayOfWeek: 1, isWorking: false, startTime: '17:00', endTime: '09:00' }])).toEqual({
      ok: false,
      reason: 'inverted_window',
    });
  });
});
