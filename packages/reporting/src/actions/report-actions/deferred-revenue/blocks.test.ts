import { describe, expect, it } from 'vitest';

import {
  blockContributesToMonth,
  blockValuePerMinute,
  computeHourBlockMovement,
  computeHourBlocksRollforward,
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
    expiredAt: null,
    adjustments: [],
    allocations: [],
    ...over,
  };
}

/** opening + issued + applied + adjustments + expired must equal closing. */
function expectBalanced(movement: ReturnType<typeof computeHourBlockMovement>): void {
  expect(movement.opening + movement.issued + movement.applied + movement.adjustments + movement.expired)
    .toBeCloseTo(movement.closing, 6);
}

describe('blockValuePerMinute valuation', () => {
  it('spreads the purchase amount over the full allowance', () => {
    expect(blockValuePerMinute(600000, 2400)).toBeCloseTo(250, 6);
  });

  it('values comped/granted blocks (no cash) at zero regardless of rate', () => {
    expect(blockValuePerMinute(0, 2400)).toBe(0);
  });

  it('returns zero for missing or negative inputs', () => {
    expect(blockValuePerMinute(0, 0)).toBe(0);
    expect(blockValuePerMinute(-100, 2400)).toBe(0);
    expect(blockValuePerMinute(600000, -5)).toBe(0);
  });
});

describe('computeHourBlockMovement issuance', () => {
  it('issues the purchase amount in the purchase month', () => {
    const movement = computeHourBlockMovement('2026-02', block({}));
    // Valued at the cash billed, not hourly_rate × minutes.
    expect(movement.issued).toBe(600000);
    expect(movement.opening).toBe(0);
    expect(movement.applied).toBe(0);
    expect(movement.closing).toBe(600000);
    expect(movement.detail.purchasedAt).toBe('2026-02-05');
    expectBalanced(movement);
  });

  it('opens with the carried balance in later months without re-issuing', () => {
    const movement = computeHourBlockMovement('2026-03', block({}));
    expect(movement.opening).toBe(600000);
    expect(movement.issued).toBe(0);
    expect(movement.closing).toBe(600000);
    expectBalanced(movement);
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

  it('issues zero liability for a comped block with a rate set', () => {
    const movement = computeHourBlockMovement('2026-02', block({ purchaseAmount: 0, hourlyRate: 15000 }));
    expect(movement.issued).toBe(0);
    expect(movement.closing).toBe(0);
    expect(blockContributesToMonth(movement)).toBe(false);
    // The allowance still tracks burn for the detail view.
    const burned = computeHourBlockMovement('2026-02', block({
      purchaseAmount: 0,
      hourlyRate: 15000,
      allocations: [{ date: '2026-02-10', minutes: 240 }],
    }));
    expect(burned.detail.minutesBurned).toBe(240);
    expect(burned.applied).toBe(0);
    expect(burned.detail.valueRemaining).toBe(0);
  });
});

describe('computeHourBlockMovement burn', () => {
  it('recognises in-month burn as a negative applied movement at purchase value', () => {
    const movement = computeHourBlockMovement('2026-03', block({ allocations: [{ date: '2026-03-10', minutes: 240 }] }));
    expect(movement.applied).toBe(-240 * 250);
    expect(movement.closing).toBe(600000 - 60000);
    expect(movement.detail.minutesBurned).toBe(240);
    expect(movement.detail.remainingMinutes).toBe(2160);
    expectBalanced(movement);
  });

  it('attributes each allocation to its own month', () => {
    const allocations = [
      { date: '2026-02-20', minutes: 120 },
      { date: '2026-03-05', minutes: 60 },
    ];
    const feb = computeHourBlockMovement('2026-02', block({ allocations }));
    const mar = computeHourBlockMovement('2026-03', block({ allocations }));
    expect(feb.applied).toBe(-120 * 250);
    expect(feb.closing).toBe(600000 - 30000);
    expect(mar.opening).toBe(feb.closing);
    expect(mar.applied).toBe(-60 * 250);
    expect(mar.closing).toBe(600000 - 45000);
    expectBalanced(feb);
    expectBalanced(mar);
  });

  it('recognises burn recorded before issuance in the issuance month', () => {
    // Draws made while the issuance invoice was still pending: the block
    // first appears when finalized, so the gap burn lands in `applied` there.
    const movement = computeHourBlockMovement('2026-02', block({
      allocations: [
        { date: '2026-01-15', minutes: 180 },
        { date: '2026-02-20', minutes: 60 },
      ],
    }));
    expect(movement.issued).toBe(600000);
    expect(movement.applied).toBe(-240 * 250);
    expect(movement.closing).toBe(600000 - 60000);
    expectBalanced(movement);
    // Later months are unaffected by the pre-issuance draw.
    const mar = computeHourBlockMovement('2026-03', block({
      allocations: [
        { date: '2026-01-15', minutes: 180 },
        { date: '2026-02-20', minutes: 60 },
      ],
    }));
    expect(mar.opening).toBe(540000);
    expect(mar.applied).toBe(0);
    expectBalanced(mar);
  });

  it('caps recognition at the minutes the block actually holds', () => {
    // Allocations in excess of the allowance must not drive the balance negative.
    const movement = computeHourBlockMovement('2026-02', block({ allocations: [{ date: '2026-02-01', minutes: 4800 }] }));
    expect(movement.issued).toBe(600000);
    expect(movement.applied).toBe(-600000);
    expect(movement.closing).toBe(0);
    expect(movement.detail.remainingMinutes).toBe(0);
    expectBalanced(movement);
  });

  it('ignores burn dated after the reported month', () => {
    const movement = computeHourBlockMovement('2026-03', block({ allocations: [{ date: '2026-04-02', minutes: 240 }] }));
    expect(movement.applied).toBe(0);
    expect(movement.closing).toBe(600000);
    expect(movement.detail.remainingMinutes).toBe(2400);
    expectBalanced(movement);
  });
});

describe('computeHourBlockMovement adjustments', () => {
  it('recognises an in-month decrease as a negative adjustments movement', () => {
    const movement = computeHourBlockMovement('2026-03', block({
      adjustments: [{ date: '2026-03-12', minutes: -180 }],
    }));
    expect(movement.opening).toBe(600000);
    expect(movement.adjustments).toBe(-180 * 250);
    expect(movement.closing).toBe(600000 - 45000);
    expectBalanced(movement);
  });

  it('adds no liability for a comped increase beyond the purchased allowance', () => {
    // Liability is capped at the cash billed: free minutes carry no deferred
    // revenue (same rule as comped blocks valuing at zero).
    const movement = computeHourBlockMovement('2026-03', block({
      adjustments: [{ date: '2026-03-12', minutes: 120 }],
    }));
    expect(movement.adjustments).toBe(0);
    expect(movement.closing).toBe(600000);
    expectBalanced(movement);
  });

  it('recognises a reversal of an earlier write-down up to the burned amount', () => {
    // 240 burned, then +120 back: restores 120 minutes of liability.
    const movement = computeHourBlockMovement('2026-03', block({
      allocations: [{ date: '2026-03-05', minutes: 240 }],
      adjustments: [{ date: '2026-03-20', minutes: 120 }],
    }));
    expect(movement.applied).toBe(-240 * 250);
    expect(movement.adjustments).toBe(120 * 250);
    expect(movement.closing).toBe(600000 - 60000 + 30000);
    expectBalanced(movement);
  });

  it('clamps a decrease at zero liability', () => {
    const movement = computeHourBlockMovement('2026-03', block({
      adjustments: [{ date: '2026-03-12', minutes: -4800 }],
    }));
    expect(movement.adjustments).toBe(-600000);
    expect(movement.closing).toBe(0);
    expectBalanced(movement);
  });

  it('leaves adjustments before the reported month out of the month columns', () => {
    const movement = computeHourBlockMovement('2026-03', block({
      adjustments: [{ date: '2026-02-15', minutes: -120 }],
    }));
    expect(movement.adjustments).toBe(0);
    expect(movement.opening).toBe(600000 - 30000);
    expect(movement.closing).toBe(570000);
    expectBalanced(movement);
  });
});

describe('computeHourBlockMovement extinction', () => {
  it('writes off unburned value in the expiration month', () => {
    const movement = computeHourBlockMovement(
      '2026-04',
      block({ status: 'expired', expirationDate: '2026-04-30', allocations: [{ date: '2026-04-10', minutes: 240 }] }),
    );
    expect(movement.opening).toBe(600000);
    expect(movement.applied).toBe(-60000);
    expect(movement.expired).toBe(-(2160 * 250));
    expect(movement.closing).toBe(0);
    expectBalanced(movement);
  });

  it('writes off unburned value in the void month', () => {
    const movement = computeHourBlockMovement('2026-03', block({ status: 'voided', voidedAt: '2026-03-15T10:00:00Z' }));
    expect(movement.opening).toBe(600000);
    expect(movement.expired).toBe(-600000);
    expect(movement.closing).toBe(0);
    expectBalanced(movement);
  });

  it('writes off a manually expired block on its settled audit date even without expiration_date', () => {
    // The expire action may not set expiration_date; the manual_expiration
    // audit row (loader-supplied expiredAt) carries the settlement date.
    const movement = computeHourBlockMovement('2026-03', block({ status: 'expired', expiredAt: '2026-03-18' }));
    expect(movement.opening).toBe(600000);
    expect(movement.expired).toBe(-600000);
    expect(movement.closing).toBe(0);
    expectBalanced(movement);
    const apr = computeHourBlockMovement('2026-04', block({ status: 'expired', expiredAt: '2026-03-18' }));
    expect(blockContributesToMonth(apr)).toBe(false);
  });

  it('writes off at the earlier of expiration_date and the settled expiry date', () => {
    // Manual expiry before the scheduled date: the block stopped being usable
    // when it was manually expired, not when its date would have passed.
    const movement = computeHourBlockMovement('2026-03', block({
      status: 'expired',
      expirationDate: '2026-05-31',
      expiredAt: '2026-03-18',
      allocations: [{ date: '2026-03-01', minutes: 120 }],
    }));
    expect(movement.opening).toBe(600000);
    expect(movement.applied).toBe(-120 * 250);
    expect(movement.expired).toBe(-(2280 * 250));
    expect(movement.closing).toBe(0);
    expectBalanced(movement);
  });

  it('freezes burn after the settled expiry date', () => {
    const movement = computeHourBlockMovement('2026-03', block({
      status: 'expired',
      expiredAt: '2026-03-10',
      allocations: [
        { date: '2026-03-05', minutes: 120 },
        { date: '2026-03-20', minutes: 240 }, // after write-off — ignored
      ],
    }));
    expect(movement.applied).toBe(-120 * 250);
    expect(movement.detail.minutesBurned).toBe(120);
    expectBalanced(movement);
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
      block({ blockId: 'a', allocations: [{ date: '2026-03-01', minutes: 60 }] }),
      block({
        blockId: 'b',
        purchasedAt: '2026-03-02',
        hourlyRate: 10000,
        totalMinutes: 600,
        purchaseAmount: 100000,
        allocations: [{ date: '2026-03-20', minutes: 120 }],
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
    expect(acme?.adjustments).toBe(0);
    expect(acme?.closing).toBe(600000 - 15000 + 100000 - 20000);
    expect(acme?.details.map((d) => d.blockId).sort()).toEqual(['a', 'b']);
  });

  it('aggregates adjustment movements alongside burn', () => {
    const rollforward = computeHourBlocksRollforward('2026-03', [
      block({ blockId: 'a', allocations: [{ date: '2026-03-01', minutes: 240 }], adjustments: [{ date: '2026-03-05', minutes: 120 }] }),
      block({ blockId: 'b', purchasedAt: '2026-03-02', purchaseAmount: 100000, totalMinutes: 600, hourlyRate: 10000, adjustments: [{ date: '2026-03-10', minutes: -120 }] }),
    ]);
    const acme = rollforward.get('client-1\u0000USD');
    // a: 240 burned then 120 restored = +30000 · b: −120 × (100000/600) = −20000
    expect(acme?.adjustments).toBe(30000 - 20000);
    expect(acme!.opening + acme!.issued + acme!.applied + acme!.adjustments + acme!.expired)
      .toBe(acme!.closing);
  });

  it('omits clients whose blocks contribute nothing', () => {
    const rollforward = computeHourBlocksRollforward('2026-01', [block({})]);
    expect(rollforward.size).toBe(0);
  });
});
