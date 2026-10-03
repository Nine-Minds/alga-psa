import { describe, expect, it } from 'vitest';
import { listOccurrenceDates } from '../listOccurrenceDates';
import { recurrenceRuleSchema, type RecurrenceRule } from '../rule';

const rule = (input: unknown): RecurrenceRule => recurrenceRuleSchema.parse(input);
const NEVER = { type: 'never' } as const;

describe('listOccurrenceDates', () => {
  describe('daily', () => {
    it('every N days from the start date', () => {
      const r = rule({ frequency: 'daily', interval: 3, weekdaysOnly: false, end: NEVER });
      expect(listOccurrenceDates(r, '2026-03-01', { from: '2026-03-01', to: '2026-03-14' })).toEqual([
        '2026-03-01', '2026-03-04', '2026-03-07', '2026-03-10', '2026-03-13',
      ]);
    });

    it('stays aligned to the start date when the window starts later', () => {
      const r = rule({ frequency: 'daily', interval: 3, weekdaysOnly: false, end: NEVER });
      expect(listOccurrenceDates(r, '2026-03-01', { from: '2026-03-05', to: '2026-03-14' })).toEqual([
        '2026-03-07', '2026-03-10', '2026-03-13',
      ]);
    });

    it('weekdays only skips Saturday and Sunday', () => {
      const r = rule({ frequency: 'daily', interval: 1, weekdaysOnly: true, end: NEVER });
      // 2026-03-06 is a Friday
      expect(listOccurrenceDates(r, '2026-03-05', { from: '2026-03-05', to: '2026-03-10' })).toEqual([
        '2026-03-05', '2026-03-06', '2026-03-09', '2026-03-10',
      ]);
    });

    it('never returns dates before the start date', () => {
      const r = rule({ frequency: 'daily', interval: 1, weekdaysOnly: false, end: NEVER });
      expect(listOccurrenceDates(r, '2026-03-05', { from: '2026-03-01', to: '2026-03-06' })).toEqual([
        '2026-03-05', '2026-03-06',
      ]);
    });

    it('returns nothing for an inverted window', () => {
      const r = rule({ frequency: 'daily', interval: 1, weekdaysOnly: false, end: NEVER });
      expect(listOccurrenceDates(r, '2026-03-05', { from: '2026-03-09', to: '2026-03-06' })).toEqual([]);
    });
  });

  describe('weekly', () => {
    it('every 2 weeks on Monday and Thursday', () => {
      const r = rule({ frequency: 'weekly', interval: 2, weekdays: ['mon', 'thu'], end: NEVER });
      // 2026-03-02 is a Monday
      expect(listOccurrenceDates(r, '2026-03-02', { from: '2026-03-02', to: '2026-04-05' })).toEqual([
        '2026-03-02', '2026-03-05', '2026-03-16', '2026-03-19', '2026-03-30', '2026-04-02',
      ]);
    });

    it('does not emit a start date that is not a selected weekday', () => {
      const r = rule({ frequency: 'weekly', interval: 1, weekdays: ['fri'], end: NEVER });
      // 2026-03-03 is a Tuesday
      expect(listOccurrenceDates(r, '2026-03-03', { from: '2026-03-03', to: '2026-03-14' })).toEqual([
        '2026-03-06', '2026-03-13',
      ]);
    });
  });

  describe('monthly', () => {
    it('day 31 clamps to the last day of shorter months instead of skipping them', () => {
      const r = rule({ frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 31 }, end: NEVER });
      expect(listOccurrenceDates(r, '2026-01-01', { from: '2026-01-01', to: '2026-06-30' })).toEqual([
        '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
      ]);
    });

    it('day 30 clamps in February, day 29 clamps only in non-leap Februaries', () => {
      const r30 = rule({ frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 30 }, end: NEVER });
      expect(listOccurrenceDates(r30, '2026-01-01', { from: '2026-01-01', to: '2026-03-31' })).toEqual([
        '2026-01-30', '2026-02-28', '2026-03-30',
      ]);
      const r29 = rule({ frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 29 }, end: NEVER });
      expect(listOccurrenceDates(r29, '2027-12-01', { from: '2027-12-01', to: '2028-03-31' })).toEqual([
        '2027-12-29', '2028-01-29', '2028-02-29', '2028-03-29',
      ]);
      expect(listOccurrenceDates(r29, '2026-12-01', { from: '2026-12-01', to: '2027-03-31' })).toEqual([
        '2026-12-29', '2027-01-29', '2027-02-28', '2027-03-29',
      ]);
    });

    it('a plain day of month is exact', () => {
      const r = rule({ frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 15 }, end: NEVER });
      expect(listOccurrenceDates(r, '2026-01-20', { from: '2026-01-20', to: '2026-04-30' })).toEqual([
        '2026-02-15', '2026-03-15', '2026-04-15',
      ]);
    });

    it('"last" is the last day of each month including leap February', () => {
      const r = rule({ frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 'last' }, end: NEVER });
      expect(listOccurrenceDates(r, '2027-12-01', { from: '2027-12-01', to: '2028-03-31' })).toEqual([
        '2027-12-31', '2028-01-31', '2028-02-29', '2028-03-31',
      ]);
    });

    it('2nd Tuesday (Patch Tuesday) matches the known list for 2026-2027', () => {
      const r = rule({
        frequency: 'monthly', interval: 1, on: { type: 'nthWeekday', nth: 2, weekday: 'tue' }, end: NEVER,
      });
      expect(listOccurrenceDates(r, '2026-01-01', { from: '2026-01-01', to: '2027-12-31' })).toEqual([
        '2026-01-13', '2026-02-10', '2026-03-10', '2026-04-14', '2026-05-12', '2026-06-09',
        '2026-07-14', '2026-08-11', '2026-09-08', '2026-10-13', '2026-11-10', '2026-12-08',
        '2027-01-12', '2027-02-09', '2027-03-09', '2027-04-13', '2027-05-11', '2027-06-08',
        '2027-07-13', '2027-08-10', '2027-09-14', '2027-10-12', '2027-11-09', '2027-12-14',
      ]);
    });

    it('last Friday of the month', () => {
      const r = rule({
        frequency: 'monthly', interval: 1, on: { type: 'nthWeekday', nth: 'last', weekday: 'fri' }, end: NEVER,
      });
      expect(listOccurrenceDates(r, '2026-01-01', { from: '2026-01-01', to: '2026-12-31' })).toEqual([
        '2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24', '2026-05-29', '2026-06-26',
        '2026-07-31', '2026-08-28', '2026-09-25', '2026-10-30', '2026-11-27', '2026-12-25',
      ]);
    });

    it('every 3 months from the start month', () => {
      const r = rule({ frequency: 'monthly', interval: 3, on: { type: 'dayOfMonth', day: 10 }, end: NEVER });
      expect(listOccurrenceDates(r, '2026-02-01', { from: '2026-01-01', to: '2027-03-31' })).toEqual([
        '2026-02-10', '2026-05-10', '2026-08-10', '2026-11-10', '2027-02-10',
      ]);
    });
  });

  describe('yearly', () => {
    it('Feb 29 clamps to Feb 28 in non-leap years', () => {
      const r = rule({ frequency: 'yearly', month: 2, day: 29, end: NEVER });
      expect(listOccurrenceDates(r, '2026-01-01', { from: '2026-01-01', to: '2029-12-31' })).toEqual([
        '2026-02-28', '2027-02-28', '2028-02-29', '2029-02-28',
      ]);
    });

    it('a regular month/day', () => {
      const r = rule({ frequency: 'yearly', month: 7, day: 4, end: NEVER });
      expect(listOccurrenceDates(r, '2026-08-01', { from: '2026-08-01', to: '2028-12-31' })).toEqual([
        '2027-07-04', '2028-07-04',
      ]);
    });
  });

  describe('end conditions', () => {
    it('afterCount is counted from the start date, regardless of the query window', () => {
      const r = rule({ frequency: 'daily', interval: 1, weekdaysOnly: false, end: { type: 'afterCount', count: 5 } });
      expect(listOccurrenceDates(r, '2026-03-01', { from: '2026-03-01', to: '2026-03-31' })).toEqual([
        '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
      ]);
      // Occurrences 1-5 are over; a later window must not "restart" the count.
      expect(listOccurrenceDates(r, '2026-03-01', { from: '2026-03-04', to: '2026-03-31' })).toEqual([
        '2026-03-04', '2026-03-05',
      ]);
    });

    it('afterCount counts clamped monthly occurrences once each', () => {
      const r = rule({
        frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 31 }, end: { type: 'afterCount', count: 3 },
      });
      expect(listOccurrenceDates(r, '2026-01-01', { from: '2026-01-01', to: '2026-12-31' })).toEqual([
        '2026-01-31', '2026-02-28', '2026-03-31',
      ]);
    });

    it('onDate is inclusive', () => {
      const r = rule({
        frequency: 'daily', interval: 1, weekdaysOnly: false, end: { type: 'onDate', date: '2026-03-03' },
      });
      expect(listOccurrenceDates(r, '2026-03-01', { from: '2026-03-01', to: '2026-03-10' })).toEqual([
        '2026-03-01', '2026-03-02', '2026-03-03',
      ]);
    });
  });

  describe('process timezone independence', () => {
    // The vitest process runs with whatever TZ the caller set (`npm run test:recurrence-tz` in
    // shared re-runs this file under TZ=Pacific/Auckland). The assertions below are timezone-free
    // calendar dates, so they must be identical in every process timezone.
    it('produces calendar dates that do not depend on process.env.TZ', () => {
      const r = rule({
        frequency: 'monthly', interval: 1, on: { type: 'nthWeekday', nth: 2, weekday: 'tue' }, end: NEVER,
      });
      expect(listOccurrenceDates(r, '2026-03-01', { from: '2026-03-01', to: '2026-05-31' })).toEqual([
        '2026-03-10', '2026-04-14', '2026-05-12',
      ]);
      const daily = rule({ frequency: 'daily', interval: 1, weekdaysOnly: false, end: NEVER });
      // A DST-change weekend in both New York (Mar 8) and Auckland (Apr 5): no day may be lost or duplicated.
      expect(listOccurrenceDates(daily, '2026-03-07', { from: '2026-03-07', to: '2026-03-10' })).toEqual([
        '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
      ]);
      expect(listOccurrenceDates(daily, '2026-04-04', { from: '2026-04-04', to: '2026-04-06' })).toEqual([
        '2026-04-04', '2026-04-05', '2026-04-06',
      ]);
    });
  });
});

describe('recurrenceRuleSchema', () => {
  it('applies defaults (end never, weekdaysOnly false)', () => {
    const parsed = recurrenceRuleSchema.parse({ frequency: 'daily', interval: 2 });
    expect(parsed).toEqual({ frequency: 'daily', interval: 2, weekdaysOnly: false, end: { type: 'never' } });
  });

  it.each([
    ['zero interval', { frequency: 'daily', interval: 0 }],
    ['fractional interval', { frequency: 'weekly', interval: 1.5, weekdays: ['mon'] }],
    ['weekly without weekdays', { frequency: 'weekly', interval: 1, weekdays: [] }],
    ['weekly duplicate weekdays', { frequency: 'weekly', interval: 1, weekdays: ['mon', 'mon'] }],
    ['unknown weekday', { frequency: 'weekly', interval: 1, weekdays: ['monday'] }],
    ['weekdays-only with interval > 1', { frequency: 'daily', interval: 2, weekdaysOnly: true }],
    ['monthly day 0', { frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 0 } }],
    ['monthly day 32', { frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 32 } }],
    ['monthly nth 5', { frequency: 'monthly', interval: 1, on: { type: 'nthWeekday', nth: 5, weekday: 'mon' } }],
    ['monthly missing on', { frequency: 'monthly', interval: 1 }],
    ['yearly month 13', { frequency: 'yearly', month: 13, day: 1 }],
    ['yearly Feb 30', { frequency: 'yearly', month: 2, day: 30 }],
    ['yearly Apr 31', { frequency: 'yearly', month: 4, day: 31 }],
    ['unknown frequency', { frequency: 'hourly', interval: 1 }],
    ['end onDate invalid date', { frequency: 'daily', interval: 1, end: { type: 'onDate', date: '2026-02-30' } }],
    ['end onDate bad format', { frequency: 'daily', interval: 1, end: { type: 'onDate', date: '03/01/2026' } }],
    ['end afterCount 0', { frequency: 'daily', interval: 1, end: { type: 'afterCount', count: 0 } }],
  ])('rejects %s', (_label, input) => {
    expect(recurrenceRuleSchema.safeParse(input).success).toBe(false);
  });

  it('accepts Feb 29 yearly and last-weekday monthly', () => {
    expect(recurrenceRuleSchema.safeParse({ frequency: 'yearly', month: 2, day: 29 }).success).toBe(true);
    expect(
      recurrenceRuleSchema.safeParse({
        frequency: 'monthly', interval: 1, on: { type: 'nthWeekday', nth: 'last', weekday: 'sun' },
      }).success
    ).toBe(true);
  });
});
