import { describe, expect, it } from 'vitest';
import { buildFallbackBusinessDayCalendar } from '@alga-psa/shared/lib/businessHours/businessDayCalendar';
import type { RecurrenceRule } from '@alga-psa/shared/lib/recurrence';
import { listUpcomingOccurrences } from '../upcomingOccurrences';

const TZ = 'America/New_York';
const weeklyMon: RecurrenceRule = { frequency: 'weekly', interval: 1, weekdays: ['mon'], end: { type: 'never' } };
const yearly: RecurrenceRule = { frequency: 'yearly', month: 6, day: 15, end: { type: 'never' } };
const base = {
  rule: weeklyMon, startDate: '2026-01-05', createTime: '08:00', dueTime: '17:00', leadDays: 0, policy: 'keep' as const, calendar: null, timeZone: TZ, count: 5,
};

describe('listUpcomingOccurrences', () => {
  it('returns the next occurrences in due order', () => {
    const result = listUpcomingOccurrences({ ...base, now: new Date('2026-03-02T12:00:00Z') });
    expect(result.map((c) => c.nominal)).toEqual(['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']);
  });

  it('includes today when its due time is still ahead and drops it once passed', () => {
    // 2026-03-02 17:00 EST = 22:00Z
    expect(listUpcomingOccurrences({ ...base, now: new Date('2026-03-02T21:59:00Z') })[0].nominal).toBe('2026-03-02');
    expect(listUpcomingOccurrences({ ...base, now: new Date('2026-03-02T22:00:00Z') })[0].nominal).toBe('2026-03-09');
  });

  it('applies the business-day policy and keeps due-date order after moving', () => {
    const daily: RecurrenceRule = { frequency: 'daily', interval: 1, weekdaysOnly: false, end: { type: 'never' } };
    const result = listUpcomingOccurrences({
      ...base,
      rule: daily,
      policy: 'next',
      calendar: buildFallbackBusinessDayCalendar(),
      now: new Date('2026-03-06T23:00:00Z'), // Friday evening, after Friday's due time
    });
    for (const c of result) expect([0, 6]).not.toContain(new Date(`${c.due}T12:00:00Z`).getUTCDay());
    const dues = result.map((c) => c.dueAt.getTime());
    expect([...dues].sort((a, b) => a - b)).toEqual(dues);
    expect(result[0].due).toBe('2026-03-09');
  });

  it('requires a calendar for a non-keep policy', () => {
    expect(() => listUpcomingOccurrences({ ...base, policy: 'next', now: new Date('2026-03-02T12:00:00Z') })).toThrow(/calendar/i);
  });

  it('widens the search horizon for rare schedules', () => {
    const result = listUpcomingOccurrences({ ...base, rule: yearly, startDate: '2020-06-15', count: 2, now: new Date('2026-07-01T00:00:00Z') });
    expect(result.map((c) => c.nominal)).toEqual(['2027-06-15', '2028-06-15']);
  });

  it('returns fewer than requested when the rule has ended', () => {
    const ending: RecurrenceRule = { ...weeklyMon, end: { type: 'onDate', date: '2026-03-10' } } as RecurrenceRule;
    const result = listUpcomingOccurrences({ ...base, rule: ending, now: new Date('2026-03-02T12:00:00Z') });
    expect(result.map((c) => c.nominal)).toEqual(['2026-03-02', '2026-03-09']);
  });
});
