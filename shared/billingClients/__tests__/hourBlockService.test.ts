import { describe, expect, it } from 'vitest';

import { computeFifoAllocation } from '../hourBlockService';

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
