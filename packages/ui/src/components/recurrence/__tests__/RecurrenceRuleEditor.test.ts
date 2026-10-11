import { describe, expect, it } from 'vitest';
import { defaultRuleForFrequency } from '../RecurrenceRuleEditor';

describe('defaultRuleForFrequency', () => {
  it('daily defaults to every day, weekends included', () => {
    expect(defaultRuleForFrequency('daily')).toEqual({ frequency: 'daily', interval: 1, weekdaysOnly: false, end: { type: 'never' } });
  });

  it('weekly defaults to Monday', () => {
    expect(defaultRuleForFrequency('weekly')).toMatchObject({ frequency: 'weekly', interval: 1, weekdays: ['mon'] });
  });

  it('monthly defaults to the first day of the month', () => {
    expect(defaultRuleForFrequency('monthly')).toMatchObject({ frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 1 } });
  });

  it('yearly defaults to 1 January and has no interval', () => {
    const rule = defaultRuleForFrequency('yearly');
    expect(rule).toMatchObject({ frequency: 'yearly', month: 1, day: 1 });
    expect('interval' in rule).toBe(false);
  });

  it('keeps the chosen end condition when the frequency changes', () => {
    const end = { type: 'afterCount', count: 5 } as const;
    for (const frequency of ['daily', 'weekly', 'monthly', 'yearly'] as const) {
      expect(defaultRuleForFrequency(frequency, end).end).toEqual(end);
    }
  });
});
