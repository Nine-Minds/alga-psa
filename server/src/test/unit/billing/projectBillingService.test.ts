import { describe, expect, it } from 'vitest';
import {
  computeCapWriteDown,
  computeDepositReconciliation,
  computeEntryAmounts,
  detectThresholdCrossings,
} from '@alga-psa/billing/services/projectBillingService';

type AllocationEntry = Parameters<typeof computeEntryAmounts>[1][number];
type DepositEntry = Parameters<typeof computeDepositReconciliation>[0][number];

const allocationEntry = (
  amount: number | null,
  percentage: number | null,
  status: AllocationEntry['status'] = 'pending',
): AllocationEntry => ({ amount, percentage, status });

const depositEntry = (
  entry_type: DepositEntry['entry_type'],
  status: DepositEntry['status'],
  computed_amount: number,
): DepositEntry => ({ entry_type, status, computed_amount });

describe('project billing allocation math (T005)', () => {
  it('computes percentages from total_price and rounds half cents to the nearest cent', () => {
    expect(computeEntryAmounts(
      { total_price: 999 },
      [allocationEntry(null, 12.5)],
    )).toEqual([125]);

    expect(computeEntryAmounts(
      { total_price: 1 },
      [allocationEntry(null, 50)],
    )).toEqual([1]);
  });

  it('assigns the rounding remainder to the final active entry', () => {
    const amounts = computeEntryAmounts(
      { total_price: 10_001 },
      [
        allocationEntry(null, 33.3333),
        allocationEntry(null, 33.3333),
        allocationEntry(null, 33.3334),
      ],
    );

    expect(amounts).toEqual([3_334, 3_334, 3_333]);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(10_001);
  });

  it('supports mixed fixed amounts and percentages when the exact allocation is complete', () => {
    expect(computeEntryAmounts(
      { total_price: 10_001 },
      [allocationEntry(5_000, null), allocationEntry(null, 50.005)],
    )).toEqual([5_000, 5_001]);
  });

  it('does not hide a material under-allocation by assigning it as remainder', () => {
    expect(computeEntryAmounts(
      { total_price: 10_000 },
      [allocationEntry(null, 30), allocationEntry(null, 30)],
    )).toEqual([3_000, 3_000]);
  });

  it('excludes canceled entries from remainder allocation without changing their displayed amount', () => {
    expect(computeEntryAmounts(
      { total_price: 101 },
      [
        allocationEntry(null, 50),
        allocationEntry(null, 10, 'canceled'),
        allocationEntry(null, 50),
      ],
    )).toEqual([51, 10, 50]);
  });

  it('returns fixed cents and zero for percentage entries when total_price is absent', () => {
    expect(computeEntryAmounts(
      { total_price: null },
      [allocationEntry(2_500, null), allocationEntry(null, 25)],
    )).toEqual([2_500, 0]);
  });

  it('rejects invalid money, percentages, and entries without an allocation', () => {
    expect(() => computeEntryAmounts(
      { total_price: -1 },
      [allocationEntry(1, null)],
    )).toThrow('total_price must be a non-negative integer number of cents');
    expect(() => computeEntryAmounts(
      { total_price: 100 },
      [allocationEntry(-1, null)],
    )).toThrow('entry amount must be a non-negative integer number of cents');
    expect(() => computeEntryAmounts(
      { total_price: 100 },
      [allocationEntry(null, Number.NaN)],
    )).toThrow('percentage must be a non-negative finite number');
    expect(() => computeEntryAmounts(
      { total_price: 100 },
      [allocationEntry(null, null)],
    )).toThrow('Project billing entry must have an amount or percentage');
  });
});

describe('project billing cap math (T016/T017)', () => {
  it('writes down only the portion that straddles a hard cap', () => {
    expect(computeCapWriteDown(10_000, 8_500, 2_000)).toEqual({
      billable: 1_500,
      writtenDown: 500,
    });
  });

  it('handles exact-cap, exhausted-cap, zero-charge, and unused-cap boundaries', () => {
    expect(computeCapWriteDown(10_000, 8_000, 2_000)).toEqual({ billable: 2_000, writtenDown: 0 });
    expect(computeCapWriteDown(10_000, 10_000, 2_000)).toEqual({ billable: 0, writtenDown: 2_000 });
    expect(computeCapWriteDown(0, 0, 2_000)).toEqual({ billable: 0, writtenDown: 2_000 });
    expect(computeCapWriteDown(10_000, 2_000, 0)).toEqual({ billable: 0, writtenDown: 0 });
    expect(computeCapWriteDown(10_000, 0, 2_000)).toEqual({ billable: 2_000, writtenDown: 0 });
  });

  it('rejects negative or fractional cent inputs', () => {
    expect(() => computeCapWriteDown(-1, 0, 0)).toThrow(/capAmount/);
    expect(() => computeCapWriteDown(100, -1, 0)).toThrow(/usedBilled/);
    expect(() => computeCapWriteDown(100, 0, 0.5)).toThrow(/chargeAmount/);
  });

  it('detects exact threshold boundaries and preserves configured order', () => {
    expect(detectThresholdCrossings(
      10_000,
      4_999,
      9_000,
      [80, 50, 100],
      [],
    )).toEqual([80, 50]);

    expect(detectThresholdCrossings(10_000, 0, 5_000, [50], [])).toEqual([50]);
  });

  it('deduplicates repeated and already-notified thresholds across runs', () => {
    expect(detectThresholdCrossings(
      10_000,
      4_000,
      9_000,
      [50, 50, 75, 80, 80],
      [50, 75],
    )).toEqual([80]);

    expect(detectThresholdCrossings(10_000, 5_000, 7_500, [50, 75], [])).toEqual([75]);
  });

  it('does not emit when billing does not advance or the cap is zero', () => {
    expect(detectThresholdCrossings(10_000, 5_000, 5_000, [50], [])).toEqual([]);
    expect(detectThresholdCrossings(10_000, 6_000, 5_000, [50], [])).toEqual([]);
    expect(detectThresholdCrossings(0, 0, 100, [50], [])).toEqual([]);
  });

  it('rejects invalid threshold percentages', () => {
    expect(() => detectThresholdCrossings(10_000, 0, 5_000, [-1], [])).toThrow(
      'thresholds must contain non-negative finite percentages',
    );
    expect(() => detectThresholdCrossings(10_000, 0, 5_000, [Number.NaN], [])).toThrow(
      'thresholds must contain non-negative finite percentages',
    );
  });
});

describe('project billing deposit reconciliation math (T020)', () => {
  const entries: DepositEntry[] = [
    depositEntry('deposit', 'invoiced', 2_000),
    depositEntry('deposit', 'ready', 1_000),
    depositEntry('milestone', 'invoiced', 3_000),
    depositEntry('deposit', 'invoiced', 1_500),
    depositEntry('milestone', 'approved', 5_000),
  ];

  it('returns zero for credit treatment', () => {
    expect(computeDepositReconciliation(entries, 'credit')).toBe(0);
  });

  it('deducts only prior invoiced deposits from the final active milestone', () => {
    expect(computeDepositReconciliation(entries, 'deduct_final')).toBe(3_500);
  });

  it('caps the deduction at the final milestone amount', () => {
    expect(computeDepositReconciliation([
      depositEntry('deposit', 'invoiced', 7_500),
      depositEntry('milestone', 'approved', 5_000),
    ], 'deduct_final')).toBe(5_000);
  });

  it('ignores deposits after the final milestone and canceled milestones', () => {
    expect(computeDepositReconciliation([
      depositEntry('deposit', 'invoiced', 1_000),
      depositEntry('milestone', 'approved', 3_000),
      depositEntry('deposit', 'invoiced', 2_000),
      depositEntry('milestone', 'canceled', 10_000),
    ], 'deduct_final')).toBe(1_000);
  });

  it('returns zero when there is no active milestone', () => {
    expect(computeDepositReconciliation([
      depositEntry('deposit', 'invoiced', 1_000),
      depositEntry('milestone', 'canceled', 3_000),
    ], 'deduct_final')).toBe(0);
  });

  it('rejects negative values that participate in reconciliation', () => {
    expect(() => computeDepositReconciliation([
      depositEntry('deposit', 'invoiced', -1),
      depositEntry('milestone', 'approved', 3_000),
    ], 'deduct_final')).toThrow('deposit computed_amount must be a non-negative integer number of cents');
    expect(() => computeDepositReconciliation([
      depositEntry('milestone', 'approved', -1),
    ], 'deduct_final')).toThrow('final milestone computed_amount must be a non-negative integer number of cents');
  });
});
