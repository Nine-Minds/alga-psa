import { describe, it, expect } from 'vitest';
import {
  computeWeightedMinutes,
  isAfterHoursInstant,
  type AfterHoursRule,
  type WeightedBurnInput,
} from '@alga-psa/shared/billingClients/weightedBurn';
import type { BusinessHoursScheduleInput } from '@alga-psa/shared/lib/businessHours/businessHoursSegmentation';

// A standard Mon–Fri 09:00–17:00 schedule (UTC by default).
function standardSchedule(timezone = 'UTC'): BusinessHoursScheduleInput {
  const entries = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    day_of_week: dayOfWeek,
    start_time: dayOfWeek >= 1 && dayOfWeek <= 5 ? '09:00' : '00:00',
    end_time: dayOfWeek >= 1 && dayOfWeek <= 5 ? '17:00' : '00:00',
    is_enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
  }));
  return {
    timezone,
    is_24x7: false,
    entries,
    holidays: [],
  };
}

function afterHoursRule(multiplier: number, schedule = standardSchedule()): AfterHoursRule {
  return { multiplier, schedule };
}

function input(
  startTime: string,
  endTime: string,
  billableDuration: number
): WeightedBurnInput {
  return {
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    billableDuration,
  };
}

describe('computeWeightedMinutes', () => {
  // Mon 2026-07-13 10:00–11:00 UTC is fully in-hours.
  it('fully in-hours span burns at member multiplier only', () => {
    const result = computeWeightedMinutes(
      input('2026-07-13T10:00:00Z', '2026-07-13T11:00:00Z', 60),
      1,
      afterHoursRule(2)
    );
    expect(result.weightedMinutes).toBe(60);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].multiplier).toBe(1);
    expect(result.segments[0].isBusinessHours).toBe(true);
  });

  // Sat 2026-07-18 is fully out-of-hours.
  it('fully after-hours span burns at max(member, afterHours)', () => {
    const result = computeWeightedMinutes(
      input('2026-07-18T10:00:00Z', '2026-07-18T11:00:00Z', 60),
      1,
      afterHoursRule(2)
    );
    expect(result.weightedMinutes).toBe(120);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].multiplier).toBe(2);
    expect(result.segments[0].isBusinessHours).toBe(false);
  });

  // Mon 16:00–18:00 straddles the 17:00 boundary: 60 in-hours + 60 after-hours.
  it('straddling boundary prorates billable duration by wall-clock overlap', () => {
    const result = computeWeightedMinutes(
      input('2026-07-13T16:00:00Z', '2026-07-13T18:00:00Z', 120),
      1,
      afterHoursRule(2)
    );
    expect(result.weightedMinutes).toBe(60 * 1 + 60 * 2);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].isBusinessHours).toBe(true);
    expect(result.segments[0].multiplier).toBe(1);
    expect(result.segments[0].billableMinutes).toBe(60);
    expect(result.segments[1].isBusinessHours).toBe(false);
    expect(result.segments[1].multiplier).toBe(2);
    expect(result.segments[1].billableMinutes).toBe(60);
  });

  // Overnight Mon 16:00 → Tue 10:00: 60 in (Mon) + 840 out + 60 in (Tue).
  it('overnight span splits across days', () => {
    const result = computeWeightedMinutes(
      input('2026-07-13T16:00:00Z', '2026-07-14T10:00:00Z', 1080),
      1,
      afterHoursRule(2)
    );
    const inMinutes = result.segments
      .filter((s) => s.isBusinessHours)
      .reduce((sum, s) => sum + s.billableMinutes, 0);
    const outMinutes = result.segments
      .filter((s) => !s.isBusinessHours)
      .reduce((sum, s) => sum + s.billableMinutes, 0);
    expect(inMinutes).toBe(120);
    expect(outMinutes).toBe(960);
    expect(result.weightedMinutes).toBe(120 * 1 + 960 * 2);
  });

  // Weekend span fully after-hours even though wall clock is long.
  it('weekend span burns entirely at the after-hours multiplier', () => {
    const result = computeWeightedMinutes(
      input('2026-07-18T00:00:00Z', '2026-07-19T00:00:00Z', 1440),
      1,
      afterHoursRule(1.5)
    );
    expect(result.weightedMinutes).toBe(1440 * 1.5);
    expect(result.segments.every((s) => !s.isBusinessHours)).toBe(true);
  });

  // Holiday: 2026-07-14 is a holiday for the schedule → after-hours all day.
  it('holiday classifies as after-hours', () => {
    const schedule = standardSchedule();
    schedule.holidays = [{ holiday_date: '2026-07-14', is_recurring: false }];
    const result = computeWeightedMinutes(
      input('2026-07-14T10:00:00Z', '2026-07-14T11:00:00Z', 60),
      1,
      afterHoursRule(2, schedule)
    );
    expect(result.weightedMinutes).toBe(120);
    expect(result.segments[0].isBusinessHours).toBe(false);
  });

  // Schedule timezone vs entry timezone disagreement: schedule is America/New_York,
  // entry is 13:00Z = 09:00 EDT → in-hours.
  it('evaluates in the schedule timezone, not the entry timezone', () => {
    const schedule = standardSchedule('America/New_York');
    const result = computeWeightedMinutes(
      input('2026-07-13T13:00:00Z', '2026-07-13T14:00:00Z', 60),
      1,
      afterHoursRule(2)
    );
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].isBusinessHours).toBe(true);
    expect(result.weightedMinutes).toBe(60);
  });

  // A span crossing a DST transition (US spring-forward is 2026-03-08 07:00Z)
  // still segments without spurious splits or missing wall-clock time: a
  // daily-enabled schedule keeps the whole span in-hours.
  it('DST-transition day does not corrupt segmentation', () => {
    const dailyEnabled: BusinessHoursScheduleInput = {
      timezone: 'America/New_York',
      is_24x7: false,
      entries: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        day_of_week: dayOfWeek,
        start_time: '00:00',
        end_time: '23:59',
        is_enabled: true,
      })),
      holidays: [],
    };
    const result = computeWeightedMinutes(
      input('2026-03-08T05:00:00Z', '2026-03-08T08:00:00Z', 180),
      1,
      afterHoursRule(2, dailyEnabled)
    );
    expect(result.weightedMinutes).toBe(180);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].isBusinessHours).toBe(true);
  });

  // Mon–Fri 09:00–17:00 schedule in America/New_York, span crossing the
  // spring-forward boundary (2026-03-08 07:00Z) plus a full business day.
  // Must produce identical proration under any process timezone (TZ=UTC and
  // TZ=America/Los_Angeles both verified).
  it('Mon-Fri schedule crossing spring-forward prorates deterministically', () => {
    const schedule: BusinessHoursScheduleInput = {
      timezone: 'America/New_York',
      is_24x7: false,
      entries: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        day_of_week: dayOfWeek,
        start_time: dayOfWeek >= 1 && dayOfWeek <= 5 ? '09:00' : '00:00',
        end_time: dayOfWeek >= 1 && dayOfWeek <= 5 ? '17:00' : '00:00',
        is_enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
      })),
      holidays: [],
    };
    // Sun 2026-03-08 22:00Z (17:00 EST) → Mon 2026-03-09 15:00Z (11:00 EDT,
    // after the transition). In-hours: Mon 09:00–11:00 EDT = 13:00Z–15:00Z.
    const result = computeWeightedMinutes(
      input('2026-03-08T22:00:00Z', '2026-03-09T15:00:00Z', 1020),
      1,
      afterHoursRule(2, schedule)
    );
    const inMinutes = result.segments
      .filter((s) => s.isBusinessHours)
      .reduce((sum, s) => sum + s.billableMinutes, 0);
    const outMinutes = result.segments
      .filter((s) => !s.isBusinessHours)
      .reduce((sum, s) => sum + s.billableMinutes, 0);
    // 1020 wall minutes: Mon 13:00Z–15:00Z (120) in-hours, the rest out.
    expect(inMinutes).toBeCloseTo(120, 6);
    expect(outMinutes).toBeCloseTo(900, 6);
    expect(result.weightedMinutes).toBe(Math.round((120 * 1 + 900 * 2) * 100) / 100);
  });

  // Zero-length span with positive billable duration classifies by start_time.
  it('zero-length span classifies by start_time', () => {
    const inHours = computeWeightedMinutes(
      input('2026-07-13T10:00:00Z', '2026-07-13T10:00:00Z', 30),
      1,
      afterHoursRule(2)
    );
    expect(inHours.weightedMinutes).toBe(30);
    expect(inHours.segments[0].isBusinessHours).toBe(true);

    const afterHours = computeWeightedMinutes(
      input('2026-07-18T10:00:00Z', '2026-07-18T10:00:00Z', 30),
      1,
      afterHoursRule(2)
    );
    expect(afterHours.weightedMinutes).toBe(60);
    expect(afterHours.segments[0].isBusinessHours).toBe(false);
  });

  // billable_duration ≠ wall-clock: proration uses wall-clock fractions.
  it('prorates billable_duration by wall-clock fraction even when they differ', () => {
    const result = computeWeightedMinutes(
      input('2026-07-13T16:00:00Z', '2026-07-13T18:00:00Z', 90),
      1,
      afterHoursRule(2)
    );
    // 120 wall minutes: 60 in, 60 out → each gets 45 billable minutes.
    expect(result.segments[0].billableMinutes).toBe(45);
    expect(result.segments[1].billableMinutes).toBe(45);
    expect(result.weightedMinutes).toBe(45 * 1 + 45 * 2);
  });

  // Max-wins both directions: member > afterHours, and afterHours > member.
  it('max-wins when member multiplier is larger', () => {
    const result = computeWeightedMinutes(
      input('2026-07-18T10:00:00Z', '2026-07-18T11:00:00Z', 60),
      3,
      afterHoursRule(2)
    );
    expect(result.weightedMinutes).toBe(180);
    expect(result.segments[0].multiplier).toBe(3);
  });

  it('max-wins when afterHours multiplier is larger', () => {
    const result = computeWeightedMinutes(
      input('2026-07-18T10:00:00Z', '2026-07-18T11:00:00Z', 60),
      1,
      afterHoursRule(2)
    );
    expect(result.weightedMinutes).toBe(120);
    expect(result.segments[0].multiplier).toBe(2);
  });

  // In-hours segment never applies the after-hours multiplier even if it's higher.
  it('in-hours segment ignores a higher after-hours multiplier', () => {
    const result = computeWeightedMinutes(
      input('2026-07-13T10:00:00Z', '2026-07-13T11:00:00Z', 60),
      1,
      afterHoursRule(5)
    );
    expect(result.weightedMinutes).toBe(60);
    expect(result.segments[0].multiplier).toBe(1);
  });

  // No rule: whole span burns at member multiplier only.
  it('no-rule bucket burns at member multiplier over the whole span', () => {
    const result = computeWeightedMinutes(
      input('2026-07-18T10:00:00Z', '2026-07-18T12:00:00Z', 120),
      2,
      null
    );
    expect(result.weightedMinutes).toBe(240);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].multiplier).toBe(2);
  });

  // Rounding to 2 decimals.
  it('rounds the weighted total to 2 decimals', () => {
    // 2026-07-13 16:30–17:10: 30 in, 10 out with member 1.333 and afterHours 1.5.
    const result = computeWeightedMinutes(
      input('2026-07-13T16:30:00Z', '2026-07-13T17:10:00Z', 40),
      1.333,
      afterHoursRule(1.5)
    );
    expect(result.weightedMinutes).toBeCloseTo(30 * 1.333 + 10 * 1.5, 2);
    expect(result.weightedMinutes).toBe(Math.round((30 * 1.333 + 10 * 1.5) * 100) / 100);
  });

  // 24x7 schedule: never after-hours, even on a weekend.
  it('24x7 schedule treats every segment as in-hours', () => {
    const schedule: BusinessHoursScheduleInput = {
      timezone: 'UTC',
      is_24x7: true,
      entries: [],
      holidays: [],
    };
    const result = computeWeightedMinutes(
      input('2026-07-18T10:00:00Z', '2026-07-18T11:00:00Z', 60),
      1,
      afterHoursRule(2, schedule)
    );
    expect(result.weightedMinutes).toBe(60);
    expect(result.segments[0].isBusinessHours).toBe(true);
    expect(result.segments[0].multiplier).toBe(1);
  });

  // A member multiplier that is non-positive clamps to 1.
  it('clamps non-positive member multipliers to 1', () => {
    const result = computeWeightedMinutes(
      input('2026-07-13T10:00:00Z', '2026-07-13T11:00:00Z', 60),
      0,
      null
    );
    expect(result.weightedMinutes).toBe(60);
  });
});

describe('isAfterHoursInstant', () => {
  it('classifies a weekday 10:00 instant as in-hours', () => {
    expect(isAfterHoursInstant(standardSchedule(), new Date('2026-07-13T10:00:00Z'))).toBe(false);
  });

  it('classifies a Saturday instant as after-hours', () => {
    expect(isAfterHoursInstant(standardSchedule(), new Date('2026-07-18T10:00:00Z'))).toBe(true);
  });
});
