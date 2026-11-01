import { describe, expect, it } from 'vitest';
import {
  allocateCappedLargestRemainder,
  allocateDiscountsBeforeTax,
  type DiscountTaxEntity,
} from '../src/lib/discountAllocationBeforeTax';

const entity = (id: string, amount: number, extra: Partial<DiscountTaxEntity> = {}): DiscountTaxEntity => ({
  id,
  itemId: extra.itemId ?? id,
  amount,
  region: 'R1',
  taxable: true,
  ...extra,
});

const sum = (values: Iterable<number>) => [...values].reduce((a, b) => a + b, 0);

describe('allocateCappedLargestRemainder', () => {
  it('splits 100 three ways with no stray cent', () => {
    const result = allocateCappedLargestRemainder(100, [
      { key: 'a', weight: 100, cap: 100 },
      { key: 'b', weight: 100, cap: 100 },
      { key: 'c', weight: 100, cap: 100 },
    ]);
    expect(sum(result.values())).toBe(100);
    // Tie on remainder and weight breaks by key: the extra cent goes to "a".
    expect([...result.entries()]).toEqual([['a', 34], ['b', 33], ['c', 33]]);
  });

  it('redistributes the excess of a capped slot', () => {
    const result = allocateCappedLargestRemainder(90, [
      { key: 'small', weight: 10, cap: 10 },
      { key: 'big', weight: 90, cap: 1000 },
    ]);
    // Ideal split is 9 / 81; both fit, so no clipping.
    expect(result.get('small')).toBe(9);
    expect(result.get('big')).toBe(81);

    const clipped = allocateCappedLargestRemainder(100, [
      { key: 'small', weight: 50, cap: 5 },
      { key: 'big', weight: 50, cap: 1000 },
    ]);
    expect(clipped.get('small')).toBe(5);
    expect(clipped.get('big')).toBe(95);
  });

  it('never exceeds total capacity', () => {
    const result = allocateCappedLargestRemainder(1000, [
      { key: 'a', weight: 1, cap: 10 },
      { key: 'b', weight: 1, cap: 20 },
    ]);
    expect(sum(result.values())).toBe(30);
  });

  it('is stable under input reordering', () => {
    const slots = [
      { key: 'x', weight: 333, cap: 333 },
      { key: 'y', weight: 333, cap: 333 },
      { key: 'z', weight: 334, cap: 334 },
    ];
    const forward = allocateCappedLargestRemainder(100, slots);
    const reversed = allocateCappedLargestRemainder(100, [...slots].reverse());
    for (const slot of slots) expect(forward.get(slot.key)).toBe(reversed.get(slot.key));
    expect(sum(forward.values())).toBe(100);
  });
});

describe('allocateDiscountsBeforeTax', () => {
  it('targeted discount lowers only its target', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [entity('a', 1000), entity('b', 1000)],
      pools: [{ id: 'd1', amount: 300, target: { itemId: 'a' } }],
    });
    expect(result.taxableAmountById.get('a')).toBe(700);
    expect(result.taxableAmountById.get('b')).toBe(1000);
  });

  it('exempt lines absorb their share of an untargeted discount', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [entity('hardware', 1000), entity('labor', 3000, { taxable: false })],
      pools: [{ id: 'd1', amount: 400 }],
    });
    // 400 spread 1:3 -> 100 on hardware, 300 on exempt labor.
    expect(result.taxableAmountById.get('hardware')).toBe(900);
    expect(result.reductionById.get('labor')).toBe(300);
  });

  it('a discount aimed at an exempt line leaves the taxable line untouched', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [entity('hardware', 1000), entity('labor', 3000, { taxable: false })],
      pools: [{ id: 'd1', amount: 500, target: { itemId: 'labor' } }],
    });
    expect(result.taxableAmountById.get('hardware')).toBe(1000);
  });

  it('floors at zero when the discount exceeds the population', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [entity('a', 500), entity('b', 700)],
      pools: [{ id: 'd1', amount: 5000 }],
    });
    expect(result.taxableAmountById.get('a')).toBe(0);
    expect(result.taxableAmountById.get('b')).toBe(0);
    expect(result.unappliedByPool.get('d1')).toBe(3800);
  });

  it('cap leftover redistributes across the remaining entities', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [entity('a', 100), entity('b', 10_000)],
      pools: [{ id: 'd1', amount: 6000 }],
    });
    // Pro rata a would take ~59 and b ~5941; neither caps, sum is exact.
    expect(sum(result.reductionById.values())).toBe(6000);
    expect(result.taxableAmountById.get('a')! + result.taxableAmountById.get('b')!).toBe(4100);
  });

  it('three-way split with a tax-rate-sized remainder keeps the exact sum', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [entity('a', 3333), entity('b', 3333), entity('c', 3334)],
      pools: [{ id: 'd1', amount: 1001 }],
    });
    expect(sum(result.reductionById.values())).toBe(1001);
    for (const e of ['a', 'b', 'c']) {
      expect(result.taxableAmountById.get(e)).toBeGreaterThanOrEqual(0);
    }
  });

  it('region-scoped pools only reduce their own region', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [entity('a', 1000, { region: 'R1' }), entity('b', 1000, { region: 'R2' })],
      pools: [{ id: 'd1', amount: 400, region: 'R2' }],
    });
    expect(result.taxableAmountById.get('a')).toBe(1000);
    expect(result.taxableAmountById.get('b')).toBe(600);
  });

  it('untargeted pools spread across regions in proportion', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [entity('a', 1000, { region: 'R1' }), entity('b', 3000, { region: 'R2' })],
      pools: [{ id: 'd1', amount: 400 }],
    });
    expect(result.taxableAmountById.get('a')).toBe(900);
    expect(result.taxableAmountById.get('b')).toBe(2700);
  });

  it('fixed-detail entities share a discount aimed at their parent', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [
        entity('detail-1', 600, { itemId: 'parent' }),
        entity('detail-2', 400, { itemId: 'parent' }),
        entity('other', 1000),
      ],
      pools: [{ id: 'd1', amount: 500, target: { itemId: 'parent' } }],
    });
    expect(result.taxableAmountById.get('detail-1')).toBe(300);
    expect(result.taxableAmountById.get('detail-2')).toBe(200);
    expect(result.taxableAmountById.get('other')).toBe(1000);
  });

  it('exact per-line allocations (automatic discounts) override scope', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [entity('a', 1000), entity('b', 1000)],
      pools: [{ id: 'd1', amount: 300, allocations: [{ itemId: 'b', amount: 300 }] }],
    });
    expect(result.taxableAmountById.get('a')).toBe(1000);
    expect(result.taxableAmountById.get('b')).toBe(700);
  });

  it('stacked pools never take an entity below zero', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [entity('a', 1000)],
      pools: [
        { id: 'd1', amount: 800, target: { itemId: 'a' } },
        { id: 'd2', amount: 800, target: { itemId: 'a' } },
      ],
    });
    expect(result.taxableAmountById.get('a')).toBe(0);
    expect(result.unappliedByPool.get('d2')).toBe(600);
  });

  it('a target that matches nothing is unapplied, not spread elsewhere', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [entity('a', 1000)],
      pools: [{ id: 'd1', amount: 100, target: { itemId: 'missing' } }],
    });
    expect(result.taxableAmountById.get('a')).toBe(1000);
    expect(result.unappliedByPool.get('d1')).toBe(100);
  });

  it('service and client-contract targets match', () => {
    const result = allocateDiscountsBeforeTax({
      entities: [
        entity('a', 1000, { serviceId: 's1', clientContractId: 'cc1' }),
        entity('b', 1000, { serviceId: 's2', clientContractId: 'cc1' }),
        entity('c', 1000, { serviceId: 's3', clientContractId: 'cc2' }),
      ],
      pools: [
        { id: 'd1', amount: 100, target: { serviceId: 's1' } },
        { id: 'd2', amount: 200, target: { clientContractId: 'cc1' } },
      ],
    });
    expect(sum([result.reductionById.get('a')!, result.reductionById.get('b')!])).toBe(300);
    expect(result.reductionById.get('c')).toBe(0);
  });
});
