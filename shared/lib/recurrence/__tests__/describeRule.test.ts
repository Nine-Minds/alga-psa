import { describe, expect, it } from 'vitest';
import { describeRule } from '../describeRule';
import { recurrenceRuleSchema } from '../rule';

const d = (input: unknown) => describeRule(recurrenceRuleSchema.parse(input));

describe('describeRule (English defaults)', () => {
  it('daily', () => {
    expect(d({ frequency: 'daily', interval: 1 })).toBe('Every day');
    expect(d({ frequency: 'daily', interval: 3 })).toBe('Every 3 days');
    expect(d({ frequency: 'daily', interval: 1, weekdaysOnly: true })).toBe('Every weekday');
  });

  it('weekly lists weekdays in calendar order', () => {
    expect(d({ frequency: 'weekly', interval: 2, weekdays: ['thu', 'mon'] })).toBe('Every 2 weeks on Monday, Thursday');
    expect(d({ frequency: 'weekly', interval: 1, weekdays: ['fri'] })).toBe('Every week on Friday');
  });

  it('monthly', () => {
    expect(d({ frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 15 } })).toBe('Every month on day 15');
    expect(d({ frequency: 'monthly', interval: 3, on: { type: 'dayOfMonth', day: 'last' } })).toBe(
      'Every 3 months on the last day'
    );
    expect(d({ frequency: 'monthly', interval: 1, on: { type: 'nthWeekday', nth: 2, weekday: 'tue' } })).toBe(
      'Every month on the second Tuesday'
    );
    expect(d({ frequency: 'monthly', interval: 1, on: { type: 'nthWeekday', nth: 'last', weekday: 'fri' } })).toBe(
      'Every month on the last Friday'
    );
  });

  it('yearly and end conditions', () => {
    expect(d({ frequency: 'yearly', month: 2, day: 29 })).toBe('Every year on February 29');
    expect(d({ frequency: 'daily', interval: 1, end: { type: 'onDate', date: '2026-12-31' } })).toBe(
      'Every day, until 2026-12-31'
    );
    expect(d({ frequency: 'daily', interval: 1, end: { type: 'afterCount', count: 5 } })).toBe('Every day, 5 times');
  });

  it('uses the supplied translator when given', () => {
    const rule = recurrenceRuleSchema.parse({ frequency: 'daily', interval: 1 });
    expect(describeRule(rule, (key) => `[${key}]`)).toBe('[recurring.rule.daily]');
  });
});
