import { describe, expect, it } from 'vitest';

import {
  blockContributesToMonth,
  computeHourBlockMovement,
  computeHourBlocksRollforward,
  perHourRate,
  type HourBlockInput,
} from './blocks';

function block(over: Partial<HourBlockInput>): HourBlockInput {
  return {
    blockId: 'block-1',
    clientId: 'client-1',
    serviceName: 'Engineering',
    contractName: 'Managed IT',
    currencyCode: 'USD',
    hourlyRate: 15000,
    totalMinutes: 2400,
    purchaseAmount: 600000,
    status: 'active',
    purchasedAt: '2026-02-05',
    expirationDate: null,
    voidedAt: null,
    allocations: [],
    ...over,
  };
}

describe('perHourRate valuation', () => {
  it('converts a cents-per-hour rate into a per-minute rate', () => {
    expect(perHourRate(15000)).toBeCloseTo(250, 6);
  });

  it('returns zero for missing or negative rates', () => {
    expect(perHourRate(0)).toBe(0);
    expect(perHourRate(-100)).toBe(0);
  });
});

describe('computeHourBlockMovement issuance', () => {
  it('issues the full allowance value in the purchase month', () => {
    const movement = computeHourBlockMovement('2026-02', block({}));
    // 2400 min × (15000¢/h ÷ 60) = 600000¢ = $60.00/h × 40h
    expect(movement.issued).toBe(600000);
    expect(movement.opening).toBe(0);
    expect(movement.applied).toBe(0);
    expect(movement.closing).toBe(600000);
    expect(movement.detail.purchasedAt).toBe('2026-02-05');
  });

  it('opens with the carried balance in later months without re-issuing', () => {
    const movement = computeHourBlockMovement('2026-03', block({}));
    expect(movement.opening).toBe(600000);
    expect(movement.issued).toBe(0);
    expect(movement.closing).toBe(600000);
  });

  it('contributes nothing before the purchase month', () => {
    const movement = computeHourBlockMovement('2026-01', block({}));
    expect(movement).toMatchObject({ opening: 0, issued: 0, applied: 0, closing: 0 });
    expect(blockContributesToMonth(movement)).toBe(false);
  });

  it('excludes pending blocks entirely', () => {
    const movement = computeHourBlockMovement('2026-02', block({ status: 'pending' }));
    expect(movement.issued).toBe(0);
    expect(blockContributesToMonth(movement)).toBe(false);
  });

  it('excludes voided blocks that were never issued', () => {
    const movement = computeHourBlockMovement('2026-02', block({ purchasedAt: null, status: 'voided', voidedAt: '2026-02-10' }));
    expect(movement.issued).toBe(0);
    expect(movement.expired).toBe(0);
    expect(blockContributesToMonth(movement)).toBe(false);
  });
});

describe('computeHourBlockMovement burn', () => {
  it('recognises in-month burn as a negative applied movement', () => {
    const movement = computeHourBlockMovement('2026-03', block({ allocations: [{ createdAt: '2026-03-10', minutes: 240 }] }));
    expect(movement.applied).toBe(-240 * 250);
    expect(movement.closing).toBe(600000 - 60000);
    expect(movement.detail.minutesBurned).toBe(240);
    expect(movement.detail.remainingMinutes).toBe(2160);
  });

  it('attributes each allocation to its own month', () => {
    const allocations = [
      { createdAt: '2026-02-20', minutes: 120 },
      { createdAt: '2026-03-05', minutes: 60 },
    ];
    const feb = computeHourBlockMovement('2026-02', block({ allocations }));
    const mar = computeHourBlockMovement('2026-03', block({ allocations }));
    expect(feb.applied).toBe(-120 * 250);
    expect(feb.closing).toBe(600000 - 30000);
    expect(mar.opening).toBe(feb.closing);
    expect(mar.applied).toBe(-60 * 250);
    expect(mar.closing).toBe(600000 - 45000);
  });

  it('caps recognition at the value the block actually holds', () => {
    // Allocations recorded before purchase must not drive the balance negative.
    const movement = computeHourBlockMovement('2026-02', block({ allocations: [{ createdAt: '2026-02-01', minutes: 4800 }] }));
    expect(movement.issued).toBe(600000);
    expect(movement.applied).toBe(-600000);
    expect(movement.closing).toBe(0);
    expect(movement.detail.remainingMinutes).toBe(0);
  });

  it('ignores burn dated after the reported month', () => {
    const movement = computeHourBlockMovement('2026-03', block({ allocations: [{ createdAt: '2026-04-02', minutes: 240 }] }));
    expect(movement.applied).toBe(0);
    expect(movement.closing).toBe(600000);
    expect(movement.detail.remainingMinutes).toBe(2400);
  });
});

describe('computeHourBlockMovement extinction', () => {
  it('writes off unburned value in the expiration month', () => {
    const movement = computeHourBlockMovement(
      '2026-04',
      block({ status: 'expired', expirationDate: '2026-04-30', allocations: [{ createdAt: '2026-04-10', minutes: 240 }] }),
    );
    expect(movement.opening).toBe(600000);
    expect(movement.applied).toBe(-60000);
    expect(movement.expired).toBe(-(2160 * 250));
    expect(movement.closing).toBe(0);
  });

  it('writes off unburned value in the void month', () => {
    const movement = computeHourBlockMovement('2026-03', block({ status: 'voided', voidedAt: '2026-03-15T10:00:00Z' }));
    expect(movement.expired).toBe(-600000);
    expect(movement.closing).toBe(0);
  });

  it('carries no opening balance into months after extinction', () => {
    const movement = computeHourBlockMovement('2026-05', block({ status: 'expired', expirationDate: '2026-04-30' }));
    expect(movement.opening).toBe(0);
    expect(movement.closing).toBe(0);
    expect(blockContributesToMonth(movement)).toBe(false);
  });

  it('keeps the balance outstanding until an elapsed expiry is processed', () => {
    // Status still active: the nightly settlement job has not marked it yet.
    const movement = computeHourBlockMovement('2026-05', block({ expirationDate: '2026-04-30' }));
    expect(movement.opening).toBe(600000);
    expect(movement.expired).toBe(0);
    expect(movement.closing).toBe(600000);
  });
});

describe('computeHourBlocksRollforward aggregation', () => {
  it('sums movements per client×currency and keeps detail rows', () => {
    const rollforward = computeHourBlocksRollforward('2026-03', [
      block({ blockId: 'a', allocations: [{ createdAt: '2026-03-01', minutes: 60 }] }),
      block({
        blockId: 'b',
        purchasedAt: '2026-03-02',
        hourlyRate: 10000,
        totalMinutes: 600,
        allocations: [{ createdAt: '2026-03-20', minutes: 120 }],
      }),
      block({ blockId: 'other-client', clientId: 'client-2' }),
    ]);
    expect(rollforward.size).toBe(2);
    const acme = rollforward.get('client-1\u0000USD');
    expect(acme).toBeDefined();
    // a: opening 600000, applied −15000 · b: issued 100000, applied −20000
    expect(acme?.opening).toBe(600000);
    expect(acme?.issued).toBe(100000);
    expect(acme?.applied).toBe(-35000);
    expect(acme?.closing).toBe(600000 - 15000 + 100000 - 20000);
    expect(acme?.details.map((d) => d.blockId).sort()).toEqual(['a', 'b']);
  });

  it('omits clients whose blocks contribute nothing', () => {
    const rollforward = computeHourBlocksRollforward('2026-01', [block({})]);
    expect(rollforward.size).toBe(0);
  });
});
