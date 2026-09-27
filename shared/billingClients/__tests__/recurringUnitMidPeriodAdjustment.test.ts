import { describe, expect, it } from 'vitest';
import {
  computeRecurringUnitMidPeriodAdjustment,
  daysBetweenOnly,
  formatRecurringUnitMidPeriodReason,
  inclusiveEndToExclusiveEnd,
  isValidDateOnly,
} from '../recurringUnitMidPeriodAdjustment';
import {
  prorateRecurringCoverageByDays,
  prorateRecurringCoverageByRatio,
} from '../coverageProration';

describe('shared coverage primitive', () => {
  it('uses the recurring ceiling rounding and is reusable by the true-up', () => {
    expect(prorateRecurringCoverageByRatio(390000, 0.5)).toBe(195000);
    expect(prorateRecurringCoverageByRatio(30000, 16 / 31)).toBe(15484);
    expect(prorateRecurringCoverageByDays(30000, 16, 31)).toBe(15484);
    // The same primitive drives a credit with the sign preserved.
    expect(prorateRecurringCoverageByDays(-30000, 16, 31)).toBe(-15484);
  });

  it('rejects impossible calendar dates instead of rolling them', () => {
    expect(isValidDateOnly('2026-02-30')).toBe(false);
    expect(isValidDateOnly('2026-13-01')).toBe(false);
    expect(isValidDateOnly('2024-02-29')).toBe(true);
    expect(isValidDateOnly('2023-02-29')).toBe(false);
    expect(() => daysBetweenOnly('2023-02-29', '2023-03-01')).toThrow();
  });
});

describe('inclusive to half-open conversion', () => {
  it('maps an inclusive last covered day to the following exclusive end', () => {
    expect(inclusiveEndToExclusiveEnd('2026-09-30')).toBe('2026-10-01');
    expect(inclusiveEndToExclusiveEnd('2026-02-28')).toBe('2026-03-01');
    expect(inclusiveEndToExclusiveEnd('2024-02-29')).toBe('2024-03-01');
    expect(inclusiveEndToExclusiveEnd('not-a-date')).toBeNull();
  });

  it('counts whole calendar days across month ends and leap days', () => {
    expect(daysBetweenOnly('2026-09-01', '2026-10-01')).toBe(30);
    expect(daysBetweenOnly('2026-09-16', '2026-10-01')).toBe(15);
    expect(daysBetweenOnly('2026-09-30', '2026-10-01')).toBe(1);
    expect(daysBetweenOnly('2024-02-01', '2024-03-01')).toBe(29);
  });
});

describe('computeRecurringUnitMidPeriodAdjustment', () => {
  it('produces the approved September 16 true-up: 3 x $100 x 15/30 = $150', () => {
    const result = computeRecurringUnitMidPeriodAdjustment({
      quantityDelta: 3,
      unitRateCents: 10_000,
      coveredDays: 15,
      fullPeriodDays: 30,
    });
    expect(result.amountCents).toBe(15_000);
  });

  it('credits a decrease symmetrically instead of rounding the magnitude twice', () => {
    const increase = computeRecurringUnitMidPeriodAdjustment({
      quantityDelta: 3,
      unitRateCents: 10_000,
      coveredDays: 15,
      fullPeriodDays: 30,
    });
    const decrease = computeRecurringUnitMidPeriodAdjustment({
      quantityDelta: -3,
      unitRateCents: 10_000,
      coveredDays: 15,
      fullPeriodDays: 30,
    });
    expect(decrease.amountCents).toBe(-increase.amountCents);
    expect(decrease.amountCents).toBe(-15_000);
  });

  it('prorates a first-day change over the whole period and a last-day change over one day', () => {
    const firstDay = computeRecurringUnitMidPeriodAdjustment({
      quantityDelta: 3,
      unitRateCents: 10_000,
      coveredDays: 30,
      fullPeriodDays: 30,
    });
    const lastDay = computeRecurringUnitMidPeriodAdjustment({
      quantityDelta: 3,
      unitRateCents: 10_000,
      coveredDays: 1,
      fullPeriodDays: 30,
    });
    expect(firstDay.amountCents).toBe(30_000);
    expect(lastDay.amountCents).toBe(1_000);
  });

  it('rounds once with the existing coverage convention (ceiling of the partial amount)', () => {
    // 1 x 1234 x 7/30 = 287.93... -> 288
    const result = computeRecurringUnitMidPeriodAdjustment({
      quantityDelta: 1,
      unitRateCents: 1_234,
      coveredDays: 7,
      fullPeriodDays: 30,
    });
    expect(result.amountCents).toBe(288);
  });

  it('keeps zero quantity and zero delta as an explicit no-op', () => {
    expect(
      computeRecurringUnitMidPeriodAdjustment({
        quantityDelta: 0,
        unitRateCents: 10_000,
        coveredDays: 15,
        fullPeriodDays: 30,
      }).amountCents,
    ).toBe(0);
    expect(
      computeRecurringUnitMidPeriodAdjustment({
        quantityDelta: -10,
        unitRateCents: 10_000,
        coveredDays: 0,
        fullPeriodDays: 30,
      }).amountCents,
    ).toBe(0);
  });

  it('rejects invalid day inputs rather than producing a silent charge', () => {
    expect(() =>
      computeRecurringUnitMidPeriodAdjustment({
        quantityDelta: 1,
        unitRateCents: 100,
        coveredDays: 5,
        fullPeriodDays: 0,
      }),
    ).toThrow();
    expect(() =>
      computeRecurringUnitMidPeriodAdjustment({
        quantityDelta: 1,
        unitRateCents: 100,
        coveredDays: 40,
        fullPeriodDays: 30,
      }),
    ).toThrow();
  });
});

describe('formatRecurringUnitMidPeriodReason', () => {
  it('names the direction, quantities and covered fraction', () => {
    const reason = formatRecurringUnitMidPeriodReason({
      previousQuantity: 10,
      newQuantity: 13,
      coveredDays: 15,
      fullPeriodDays: 30,
      periodStart: '2026-09-01',
      periodEndExclusive: '2026-10-01',
    });
    expect(reason).toContain('increase from 10 to 13');
    expect(reason).toContain('15/30');
    expect(reason).toContain('2026-09-01');
  });
});
