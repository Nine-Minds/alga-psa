import { describe, expect, it } from 'vitest';
import {
  normalizeToMonthlyCents,
  resolveFixedLineRecurringTotal,
  summarizeRecurringAmounts,
} from '../recurringMemberRate';

describe('summarizeRecurringAmounts', () => {
  it('keeps a single annual contract in its own cadence (Lynda: A$1,723.92/yr ≈ A$143.66/mo)', () => {
    const s = summarizeRecurringAmounts([{ periodCents: 172392, frequency: 'annually' }]);
    expect(s.singleFrequency).toBe('annually');
    expect(s.singleFrequencyPeriodCents).toBe(172392);
    expect(s.monthlyCents).toBe(14366);
  });

  it('single monthly is unchanged', () => {
    const s = summarizeRecurringAmounts([
      { periodCents: 1000, frequency: 'monthly' },
      { periodCents: 500, frequency: 'monthly' },
    ]);
    expect(s.groups).toEqual([{ frequency: 'monthly', periodCents: 1500, monthlyCents: 1500 }]);
    expect(s.singleFrequency).toBe('monthly');
    expect(s.singleFrequencyPeriodCents).toBe(1500);
    expect(s.monthlyCents).toBe(1500);
  });

  it('mixed monthly + annual: one group each, largest monthly first, no single frequency', () => {
    const s = summarizeRecurringAmounts([
      { periodCents: 45000, frequency: 'monthly' },
      { periodCents: 172392, frequency: 'annually' },
    ]);
    expect(s.groups.map((g) => g.frequency)).toEqual(['monthly', 'annually']);
    expect(s.singleFrequency).toBeNull();
    expect(s.singleFrequencyPeriodCents).toBeNull();
    expect(s.monthlyCents).toBe(45000 + 14366);
  });

  it('weekly: monthly total is per-entry rounded, same as normalizing each line', () => {
    const amounts = [
      { periodCents: 101, frequency: 'weekly' },
      { periodCents: 101, frequency: 'weekly' },
    ];
    const s = summarizeRecurringAmounts(amounts);
    expect(s.monthlyCents).toBe(2 * normalizeToMonthlyCents(101, 'weekly'));
    // grouping first would give round(202 * 4.33) = 875, one cent off
    expect(s.monthlyCents).toBe(874);
    expect(s.groups[0].periodCents).toBe(202);
  });

  it('treats null/unknown cadence as monthly', () => {
    const s = summarizeRecurringAmounts([
      { periodCents: 100, frequency: null },
      { periodCents: 200, frequency: undefined },
      { periodCents: 300, frequency: 'monthly' },
    ]);
    expect(s.groups).toEqual([{ frequency: 'monthly', periodCents: 600, monthlyCents: 600 }]);
  });

  it('folds semi_annually and semi-annually into one group', () => {
    const s = summarizeRecurringAmounts([
      { periodCents: 600, frequency: 'semi_annually' },
      { periodCents: 1200, frequency: 'semi-annually' },
    ]);
    expect(s.groups).toEqual([{ frequency: 'semi-annually', periodCents: 1800, monthlyCents: 300 }]);
    expect(s.singleFrequency).toBe('semi-annually');
  });

  it('an unknown cadence joins the monthly group', () => {
    const s = summarizeRecurringAmounts([
      { periodCents: 100, frequency: 'biweekly-ish' },
      { periodCents: 200, frequency: 'monthly' },
    ]);
    expect(s.groups).toEqual([{ frequency: 'monthly', periodCents: 300, monthlyCents: 300 }]);
    expect(s.monthlyCents).toBe(100 + 200);
  });

  it('drops zero-amount groups', () => {
    const s = summarizeRecurringAmounts([
      { periodCents: 0, frequency: 'annually' },
      { periodCents: 700, frequency: 'monthly' },
    ]);
    expect(s.groups.map((g) => g.frequency)).toEqual(['monthly']);
    expect(s.singleFrequency).toBe('monthly');
  });

  it('empty input yields an empty summary', () => {
    const s = summarizeRecurringAmounts([]);
    expect(s).toEqual({ groups: [], singleFrequency: null, singleFrequencyPeriodCents: null, monthlyCents: 0 });
  });

  it('monthly total equals the existing resolver summed per line', () => {
    const lines = [
      { frequency: 'weekly', rate: 333, qty: 3 },
      { frequency: 'quarterly', rate: 1001, qty: 2 },
      { frequency: 'annually', rate: 16098, qty: 4 },
      { frequency: 'semi-annually', rate: 777, qty: 1 },
      { frequency: 'monthly', rate: 1234, qty: 1 },
    ].map(({ frequency, rate, qty }) => ({
      billing_frequency: frequency,
      custom_rate: null,
      members: [{ item_kind: 'product', quantity: qty, price_rate: rate }],
    }));
    const expected = lines.reduce((sum, l) => sum + (resolveFixedLineRecurringTotal(l) ?? 0), 0);
    const s = summarizeRecurringAmounts(
      lines.map((l) => ({
        periodCents: l.members[0].quantity * l.members[0].price_rate,
        frequency: l.billing_frequency,
      })),
    );
    expect(s.monthlyCents).toBe(expected);
  });
});
