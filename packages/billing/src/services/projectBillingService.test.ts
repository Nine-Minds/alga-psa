import { describe, expect, it } from 'vitest';
import type { IProjectBillingScheduleEntry } from '@alga-psa/types';
import {
  computeEntryAmounts,
} from './projectBillingService';
import { getEntryDisplayPercentage } from '../components/project-billing/billingViewHelpers';

function entry(overrides: Partial<IProjectBillingScheduleEntry> = {}) {
  return {
    amount: null,
    percentage: 50,
    frozen_amount: null,
    status: 'pending',
    ...overrides,
  } as IProjectBillingScheduleEntry;
}

describe('project billing frozen amount derivation', () => {
  it('keeps frozen dollars while unfrozen percentages rederive from the full total', () => {
    const entries = [
      entry({ status: 'approved', frozen_amount: 4_000 }),
      entry({ percentage: 50 }),
    ];

    expect(computeEntryAmounts({ total_price: 12_000 }, entries)).toEqual([4_000, 6_000]);
    expect(getEntryDisplayPercentage(entries[0], 12_000)).toBeCloseTo(33.3333);
    expect(getEntryDisplayPercentage(entries[1], 12_000)).toBe(50);
  });

  it('never assigns the rounding remainder to a frozen entry', () => {
    const entries = [
      entry({ percentage: 33.3333 }),
      entry({ percentage: 33.3333 }),
      entry({ status: 'approved', percentage: 33.3334, frozen_amount: 3_333 }),
    ];

    expect(computeEntryAmounts({ total_price: 10_000 }, entries)).toEqual([3_333, 3_334, 3_333]);
  });

  it('leaves an all-frozen schedule unchanged', () => {
    const entries = [
      entry({ status: 'approved', frozen_amount: 3_333 }),
      entry({ status: 'invoiced', frozen_amount: 6_666 }),
    ];

    expect(computeEntryAmounts({ total_price: 10_000 }, entries)).toEqual([3_333, 6_666]);
  });
});
