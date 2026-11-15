import { describe, expect, it } from 'vitest';
import { describeMaintenanceCadence } from './maintenanceCadence';

// Mimics i18next's English fallback: defaultValue with {{interpolation}}.
const t = (key: string, options: Record<string, unknown> = {}) => {
  const leaf = key.split('.').pop() ?? key;
  const fallback = typeof options.defaultValue === 'string' ? options.defaultValue : leaf;
  if (key.includes('.units.') || key.includes('.customUnits.')) {
    const count = Number(options.count ?? 1);
    const noun: Record<string, string> = { daily: 'day', monthly: 'month', days: 'day', weeks: 'week', months: 'month' };
    return `${noun[leaf] ?? leaf}${count === 1 ? '' : 's'}`;
  }
  return fallback.replace(/{{(\w+)}}/g, (_, name) => String(options[name]));
};

describe('describeMaintenanceCadence', () => {
  it('describes fixed frequencies through the existing keys', () => {
    expect(describeMaintenanceCadence(t, 'monthly', 6)).toBe('Every 6 months');
    expect(describeMaintenanceCadence(t, 'daily', 1)).toBe('Every 1 day');
  });

  it('describes custom rules with their selectors in calendar order', () => {
    expect(describeMaintenanceCadence(t, 'custom', 2, { recurrence: { unit: 'weeks', weekdays: [4, 1] } }))
      .toBe('Every 2 weeks on Mon, Thu');
    expect(describeMaintenanceCadence(t, 'custom', 1, { recurrence: { unit: 'months', days_of_month: [15, 1] } }))
      .toBe('Every 1 month on day 1, 15');
    expect(describeMaintenanceCadence(t, 'custom', 45, { recurrence: { unit: 'days' } })).toBe('Every 45 days');
  });

  it('flags custom schedules that have no usable rule', () => {
    expect(describeMaintenanceCadence(t, 'custom', 1, {})).toBe('Custom (not configured)');
  });
});
