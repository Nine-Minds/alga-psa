import { describe, expect, it } from 'vitest';

import { classifyContractLineCoverage, computeFifoAllocation, computeRemainingBlockValueMinor } from '../hourBlockService';
import type { ContractLineCoverageRow } from '../hourBlockService';

type Block = { block_id: string; remaining_minutes: number };

function block(id: string, remainingMinutes: number): Block {
  return { block_id: id, remaining_minutes: remainingMinutes };
}

describe('computeFifoAllocation', () => {
  it('allocates from a single block up to its remaining minutes', () => {
    expect(computeFifoAllocation(120, [block('a', 600)])).toEqual([{ block_id: 'a', minutes: 120 }]);
  });

  it('honors FIFO order (expiration-then-purchase) by consuming blocks in the given order', () => {
    // Blocks arrive already ordered FIFO: expiring first, then by purchase.
    const fifoOrdered = [
      block('expiring-soon', 300),
      block('older-purchase', 300),
      block('no-expiry', 300),
    ];
    const allocations = computeFifoAllocation(450, fifoOrdered);
    expect(allocations).toEqual([
      { block_id: 'expiring-soon', minutes: 300 },
      { block_id: 'older-purchase', minutes: 150 },
    ]);
  });

  it('spans a single entry across two blocks, exhausting the first', () => {
    const allocations = computeFifoAllocation(540, [block('first', 240), block('second', 600)]);
    expect(allocations).toEqual([
      { block_id: 'first', minutes: 240 },
      { block_id: 'second', minutes: 300 },
    ]);
  });

  it('leaves the uncovered remainder unallocated when blocks run dry', () => {
    const allocations = computeFifoAllocation(1000, [block('small', 240), block('smaller', 120)]);
    expect(allocations).toEqual([
      { block_id: 'small', minutes: 240 },
      { block_id: 'smaller', minutes: 120 },
    ]);
    const allocated = allocations.reduce((sum, a) => sum + a.minutes, 0);
    expect(allocated).toBe(360);
  });

  it('returns nothing for a non-positive need', () => {
    expect(computeFifoAllocation(0, [block('a', 100)])).toEqual([]);
    expect(computeFifoAllocation(-60, [block('a', 100)])).toEqual([]);
  });

  it('skips depleted blocks', () => {
    const allocations = computeFifoAllocation(120, [block('empty', 0), block('full', 240)]);
    expect(allocations).toEqual([{ block_id: 'full', minutes: 120 }]);
  });

  it('allocates the full remaining minutes of the last covering block', () => {
    const allocations = computeFifoAllocation(240, [block('a', 240)]);
    expect(allocations).toEqual([{ block_id: 'a', minutes: 240 }]);
  });

  it('is idempotent: same inputs yield the same allocations', () => {
    const blocks = [block('a', 600), block('b', 600)];
    const first = computeFifoAllocation(500, blocks);
    const second = computeFifoAllocation(500, blocks);
    expect(second).toEqual(first);
  });
});

describe('classifyContractLineCoverage', () => {
  const window = { from: '2026-10-13', to: '2027-10-13' };
  function row(n: string, start: string, end: string | null, serviceId = 'svc'): ContractLineCoverageRow {
    return {
      service_id: serviceId,
      service_name: 'Support',
      contract_id: `contract-${n}`,
      contract_name: `Contract ${n}`,
      client_contract_id: `cc-${n}`,
      contract_line_id: `line-${n}`,
      contract_line_name: `Line ${n}`,
      start_date: start,
      end_date: end,
    };
  }

  it('returns an empty list for no rows', () => {
    expect(classifyContractLineCoverage([], window)).toEqual([]);
  });

  it('classifies a single line as automatic', () => {
    const result = classifyContractLineCoverage([row('a', '2026-01-01', null)], window);
    expect(result).toHaveLength(1);
    expect(result[0].assignment).toBe('automatic');
    expect(result[0].lines).toHaveLength(1);
  });

  it('classifies two overlapping lines as when_assigned', () => {
    const result = classifyContractLineCoverage(
      [row('a', '2026-01-01', null), row('b', '2026-06-01', '2027-06-01')],
      window,
    );
    expect(result[0].assignment).toBe('when_assigned');
    expect(result[0].lines).toHaveLength(2);
  });

  it('keeps two back-to-back lines automatic and lists both', () => {
    const result = classifyContractLineCoverage(
      [row('a', '2026-01-01', '2026-12-31'), row('b', '2027-01-01', null)],
      window,
    );
    expect(result[0].assignment).toBe('automatic');
    expect(result[0].lines.map((l) => l.contract_line_id)).toEqual(['line-a', 'line-b']);
  });

  it('ignores overlap that falls outside the window', () => {
    const result = classifyContractLineCoverage(
      [row('a', '2020-01-01', '2026-10-12'), row('b', '2026-01-01', null)],
      window,
    );
    expect(result[0].assignment).toBe('automatic');
  });

  it('omits a service whose only line is the excluded one', () => {
    const result = classifyContractLineCoverage([row('a', '2026-01-01', null)], window, 'line-a');
    expect(result).toHaveLength(0);
  });

  it('stays when_assigned when the excluded issuing line overlaps another line, listing only the other', () => {
    // Un-assigned time on the service splits between line-a and the issuing
    // line-b, and time on line-b DOES draw the block: 'automatic' here would
    // claim all the service's time bills through line-a.
    const result = classifyContractLineCoverage(
      [row('a', '2026-01-01', null), row('b', '2026-06-01', '2027-06-01')],
      window,
      'line-b',
    );
    expect(result[0].assignment).toBe('when_assigned');
    expect(result[0].lines.map((l) => l.contract_line_id)).toEqual(['line-a']);
  });

  it('stays automatic when the excluded issuing line only follows the other line in time', () => {
    const result = classifyContractLineCoverage(
      [row('a', '2026-01-01', '2026-12-31'), row('b', '2027-01-01', null)],
      window,
      'line-b',
    );
    expect(result[0].assignment).toBe('automatic');
    expect(result[0].lines.map((l) => l.contract_line_id)).toEqual(['line-a']);
  });

  it('leaves the classification untouched when nothing is excluded', () => {
    const result = classifyContractLineCoverage(
      [row('a', '2026-01-01', null), row('b', '2026-06-01', '2027-06-01')],
      window,
    );
    expect(result[0].assignment).toBe('when_assigned');
    expect(result[0].lines.map((l) => l.contract_line_id)).toEqual(['line-a', 'line-b']);
  });

  it('treats a null exclusion as no exclusion', () => {
    const withNull = classifyContractLineCoverage([row('a', '2026-01-01', null)], window, null);
    expect(withNull).toHaveLength(1);
  });
});

describe('computeRemainingBlockValueMinor', () => {
  it('values remaining minutes at the hourly rate in minor units, rounded once', () => {
    expect(computeRemainingBlockValueMinor({ remaining_minutes: 600, hourly_rate: 15000 })).toBe(150000);
    expect(computeRemainingBlockValueMinor({ remaining_minutes: 20, hourly_rate: 10000 })).toBe(3333);
    expect(computeRemainingBlockValueMinor({ remaining_minutes: '90', hourly_rate: '12001' })).toBe(18002);
  });

  it('is zero for exhausted blocks and unpriced grants', () => {
    expect(computeRemainingBlockValueMinor({ remaining_minutes: 0, hourly_rate: 15000 })).toBe(0);
    expect(computeRemainingBlockValueMinor({ remaining_minutes: 60, hourly_rate: 0 })).toBe(0);
    expect(computeRemainingBlockValueMinor({ remaining_minutes: null, hourly_rate: null })).toBe(0);
  });
});
