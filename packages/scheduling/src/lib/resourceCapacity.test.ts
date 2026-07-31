import { describe, expect, it } from 'vitest';
import {
  MAX_WEEKLY_CAPACITY_HOURS,
  parseWeeklyCapacityHours,
  weeklyCapacityRejectionMessage,
} from './resourceCapacity';

describe('parseWeeklyCapacityHours', () => {
  it('treats null, undefined and blank strings as "unset"', () => {
    expect(parseWeeklyCapacityHours(null)).toEqual({ ok: true, value: null });
    expect(parseWeeklyCapacityHours(undefined)).toEqual({ ok: true, value: null });
    expect(parseWeeklyCapacityHours('')).toEqual({ ok: true, value: null });
    expect(parseWeeklyCapacityHours('   ')).toEqual({ ok: true, value: null });
  });

  it('accepts numbers and numeric strings, rounding to whole hours', () => {
    expect(parseWeeklyCapacityHours(40)).toEqual({ ok: true, value: 40 });
    expect(parseWeeklyCapacityHours('37.5')).toEqual({ ok: true, value: 38 });
    expect(parseWeeklyCapacityHours(' 12 ')).toEqual({ ok: true, value: 12 });
    expect(parseWeeklyCapacityHours(0)).toEqual({ ok: true, value: 0 });
  });

  it('rejects rather than nulls out unparseable input', () => {
    expect(parseWeeklyCapacityHours('abc')).toEqual({ ok: false, reason: 'not_a_number' });
    expect(parseWeeklyCapacityHours(Number.NaN)).toEqual({ ok: false, reason: 'not_a_number' });
    expect(parseWeeklyCapacityHours(Infinity)).toEqual({ ok: false, reason: 'not_a_number' });
    expect(parseWeeklyCapacityHours({})).toEqual({ ok: false, reason: 'not_a_number' });
    expect(parseWeeklyCapacityHours(true)).toEqual({ ok: false, reason: 'not_a_number' });
    expect(parseWeeklyCapacityHours([])).toEqual({ ok: false, reason: 'not_a_number' });
  });

  it('rejects negative capacity', () => {
    expect(parseWeeklyCapacityHours(-1)).toEqual({ ok: false, reason: 'negative' });
    expect(parseWeeklyCapacityHours('-40')).toEqual({ ok: false, reason: 'negative' });
  });

  it('rejects more hours than exist in a week', () => {
    expect(parseWeeklyCapacityHours(MAX_WEEKLY_CAPACITY_HOURS)).toEqual({
      ok: true,
      value: MAX_WEEKLY_CAPACITY_HOURS,
    });
    expect(parseWeeklyCapacityHours(MAX_WEEKLY_CAPACITY_HOURS + 1)).toEqual({
      ok: false,
      reason: 'above_max',
    });
  });
});

describe('weeklyCapacityRejectionMessage', () => {
  it('describes each rejection reason', () => {
    expect(weeklyCapacityRejectionMessage('negative')).toMatch(/negative/i);
    expect(weeklyCapacityRejectionMessage('above_max')).toContain(String(MAX_WEEKLY_CAPACITY_HOURS));
    expect(weeklyCapacityRejectionMessage('not_a_number')).toMatch(/number/i);
  });
});
