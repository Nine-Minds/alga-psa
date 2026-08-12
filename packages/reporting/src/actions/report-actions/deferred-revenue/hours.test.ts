import { describe, expect, it } from 'vitest';

import {
  computeBucketPeriodMovement,
  computeHoursRollforward,
  perMinuteRate,
  type BucketPeriodInput,
} from './hours';

function period(over: Partial<BucketPeriodInput>): BucketPeriodInput {
  return {
    usageId: 'usage-1',
    contractLineId: 'line-1',
    contractLineName: 'Block Hours',
    clientId: 'client-1',
    serviceId: 'svc-1',
    serviceName: 'Engineering',
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    totalMinutes: 6000,
    rolledOverMinutes: 0,
    minutesUsed: 0,
    allowRollover: false,
    currencyCode: 'USD',
    periodFee: 100000,
    feeSource: 'billed',
    ...over,
  };
}

describe('perMinuteRate valuation', () => {
  it('values an unburned minute as period fee ÷ included minutes', () => {
    expect(perMinuteRate(6000, 100000)).toBeCloseTo(100000 / 6000, 6);
  });

  it('returns zero when fee or allowance is missing', () => {
    expect(perMinuteRate(0, 100000)).toBe(0);
    expect(perMinuteRate(6000, 0)).toBe(0);
  });

  it('does not inflate the denominator with rollover minutes', () => {
    expect(perMinuteRate(6000, 100000)).toBe(perMinuteRate(6000, 100000));
  });
});

describe('bucket period fully inside a month', () => {
  it('rolls the period forward: issued = fee, applied = -burn, expired = -forfeited leftover', () => {
    // 100 hrs included, fee $1000 → $10/hr. 40 hrs burned, 60 hrs left, no rollover.
    const movement = computeBucketPeriodMovement('2026-02', period({
      totalMinutes: 6000,
      periodFee: 100000,
      minutesUsed: 2400,
      allowRollover: false,
    }));

    expect(movement.opening).toBe(0);
    expect(movement.issued).toBe(100000);
    expect(movement.applied).toBe(-(2400 * (100000 / 6000)));
    expect(movement.expired).toBe(-(3600 * (100000 / 6000)));
    expect(movement.closing).toBe(0);
    // Movement columns close arithmetically: 0 + 100000 - 40000 - 60000 = 0.
    expect(movement.opening + movement.issued + movement.applied + movement.expired).toBeCloseTo(movement.closing, 6);
    expect(movement.detail.remainingMinutes).toBe(3600);
    expect(movement.detail.valueRemaining).toBeCloseTo(3600 * (100000 / 6000), 6);
  });

  it('non-rollover forfeiture is recognized only at the period end', () => {
    const jan = computeBucketPeriodMovement('2026-01', period({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      totalMinutes: 6000,
      minutesUsed: 0,
    }));
    const feb = computeBucketPeriodMovement('2026-02', period({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      totalMinutes: 6000,
      minutesUsed: 0,
    }));
    expect(jan.closing).toBe(0); // period does not exist in January
    expect(feb.issued).toBe(100000);
    expect(feb.applied).toBe(0);
    expect(feb.expired).toBe(-100000); // the whole allowance forfeits at period end
    expect(feb.closing).toBe(0);
  });

  it('rollover: carry opens the next month, leftover base carries, rolled-in minutes lapse', () => {
    // Included 100h, rolled over 20h (carried from Jan), 50h burned in Feb.
    const movement = computeBucketPeriodMovement('2026-02', period({
      totalMinutes: 6000,
      rolledOverMinutes: 1200,
      minutesUsed: 3000,
      allowRollover: true,
    }));
    const rate = 100000 / 6000;

    // The 20h carry crossed the Jan→Feb boundary: it opens February's balance.
    expect(movement.opening).toBe(1200 * rate);
    expect(movement.issued).toBe(100000);
    expect(movement.applied).toBe(-(3000 * rate));
    // Leftover = 7200 - 3000 = 4200. Carry to Mar = max(0, 6000-3000) = 3000.
    // Lapsed = 4200 - 3000 = 1200 (the rolled-in minutes never compound).
    expect(movement.expired).toBe(-(1200 * rate));
    expect(movement.closing).toBe(3000 * rate);
    expect(movement.opening + movement.issued + movement.applied + movement.expired).toBeCloseTo(movement.closing, 6);
    expect(movement.detail.remainingMinutes).toBe(4200);
  });

  it('rollover clamps to unused base allowance when overage consumed the carry', () => {
    const movement = computeBucketPeriodMovement('2026-02', period({
      totalMinutes: 6000,
      rolledOverMinutes: 1200,
      minutesUsed: 6600, // 6600 of 7200 available
      allowRollover: true,
    }));
    const rate = 100000 / 6000;
    // Leftover = 600, carry = max(0, 6000-6600) = 0 → all 600 lapse.
    expect(movement.expired).toBe(-(600 * rate));
    expect(movement.closing).toBe(0);
  });

  it('caps applied value at the period fee (overage is billed separately)', () => {
    const movement = computeBucketPeriodMovement('2026-02', period({
      totalMinutes: 6000,
      minutesUsed: 9000, // 50% over the allowance
      allowRollover: false,
    }));
    // burn × rate = 9000 × (100000/6000) = 150000 > fee 100000 → capped.
    expect(movement.applied).toBe(-100000);
    expect(movement.expired).toBe(0); // nothing left to forfeit
    expect(movement.closing).toBe(0);
  });
});

describe('mid-period month boundaries (spanning periods)', () => {
  it('attributes a spanning period\'s burn to the month it ends in (v1 fallback)', () => {
    // Feb 15 – Mar 14, 40h burned of 100h, non-rollover.
    const base = period({
      periodStart: '2026-02-15',
      periodEnd: '2026-03-14',
      totalMinutes: 6000,
      minutesUsed: 2400,
      allowRollover: false,
    });
    const rate = 100000 / 6000;

    const feb = computeBucketPeriodMovement('2026-02', base);
    expect(feb.opening).toBe(0); // starts in Feb
    expect(feb.issued).toBe(100000);
    expect(feb.applied).toBe(0); // burn lands in March
    expect(feb.expired).toBe(0);
    expect(feb.closing).toBe(100000); // full allowance still on the books

    const mar = computeBucketPeriodMovement('2026-03', base);
    expect(mar.opening).toBe(100000); // period still active at Mar 1
    expect(mar.issued).toBe(0);
    expect(mar.applied).toBe(-(2400 * rate));
    expect(mar.expired).toBe(-(3600 * rate));
    expect(mar.closing).toBe(0);
  });

  it('month in the middle of a spanning period carries the full allowance through', () => {
    // Dec 15 – Mar 14 spanning period; January sits in the middle.
    const base = period({
      periodStart: '2025-12-15',
      periodEnd: '2026-03-14',
      totalMinutes: 6000,
      minutesUsed: 2400,
      allowRollover: false,
    });
    const jan = computeBucketPeriodMovement('2026-01', base);
    expect(jan.opening).toBe(100000);
    expect(jan.issued).toBe(0);
    expect(jan.applied).toBe(0);
    expect(jan.expired).toBe(0);
    expect(jan.closing).toBe(100000);
  });

  it('spanning rollover period: rolled-in minutes lapse at the end, base carries', () => {
    const base = period({
      periodStart: '2026-02-15',
      periodEnd: '2026-03-14',
      totalMinutes: 6000,
      rolledOverMinutes: 1200,
      minutesUsed: 3000,
      allowRollover: true,
    });
    const rate = 100000 / 6000;

    const feb = computeBucketPeriodMovement('2026-02', base);
    expect(feb.opening).toBe(0); // starts mid-Feb, no carry pending at Feb 1
    expect(feb.closing).toBe((6000 + 1200) * rate);

    const mar = computeBucketPeriodMovement('2026-03', base);
    // Leftover = 4200; carry = max(0, 6000-3000) = 3000; lapsed = 1200.
    expect(mar.expired).toBe(-(1200 * rate));
    expect(mar.closing).toBe(3000 * rate);
  });

  it('recognizes a carry that crosses a month boundary in both closing and opening', () => {
    // Period 1 ends Feb 14 with 600 unused minutes that roll into period 2
    // (which starts Mar 1 — after February, so the carry is pending at Feb
    // 28 and must remain on the books).
    const periodOne = period({
      usageId: 'u1',
      periodStart: '2026-01-15',
      periodEnd: '2026-02-14',
      totalMinutes: 3000,
      minutesUsed: 2400,
      allowRollover: true,
      periodFee: 60000,
    });
    const feb = computeBucketPeriodMovement('2026-02', periodOne, { successorStart: '2026-03-01' });
    expect(feb.expired).toBe(0); // leftover (600) all carries
    expect(feb.closing).toBe(600 * perMinuteRate(3000, 60000)); // carry still outstanding

    const mar = computeBucketPeriodMovement('2026-03', periodOne, { successorStart: '2026-03-01' });
    expect(mar.opening).toBe(0); // period ended Feb 14, contributes nothing in Mar

    // The successor period (period 2) opens March with the carried-in value.
    const periodTwo = period({
      usageId: 'u2',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      totalMinutes: 3000,
      rolledOverMinutes: 600,
      minutesUsed: 0,
      allowRollover: true,
      periodFee: 60000,
    });
    const marTwo = computeBucketPeriodMovement('2026-03', periodTwo);
    expect(marTwo.opening).toBe(600 * perMinuteRate(3000, 60000));
    // Period 2 ends in March: the rolled-in 600 minutes lapse (no compounding)
    // and the unused 3000-minute base carries to April.
    expect(marTwo.expired).toBe(-(600 * perMinuteRate(3000, 60000)));
    expect(marTwo.closing).toBe(3000 * perMinuteRate(3000, 60000));
    expect(marTwo.opening + marTwo.issued + marTwo.applied + marTwo.expired).toBeCloseTo(marTwo.closing, 6);
  });

  it('hands a within-month carry to the successor instead of counting it twice', () => {
    // Period 1 ends Feb 14 and period 2 starts Feb 15 — the carry is owned by
    // the already-active successor by Feb 28, so period 1 closes at zero and
    // the carry lives inside period 2's closing balance.
    const periodOne = period({
      usageId: 'u1',
      periodStart: '2026-01-15',
      periodEnd: '2026-02-14',
      totalMinutes: 3000,
      minutesUsed: 2400,
      allowRollover: true,
      periodFee: 60000,
    });
    const feb = computeBucketPeriodMovement('2026-02', periodOne, { successorStart: '2026-02-15' });
    expect(feb.expired).toBe(0);
    expect(feb.closing).toBe(0); // carry already inside the successor

    const periodTwo = period({
      usageId: 'u2',
      periodStart: '2026-02-15',
      periodEnd: '2026-03-14',
      totalMinutes: 3000,
      rolledOverMinutes: 600,
      minutesUsed: 0,
      allowRollover: true,
      periodFee: 60000,
    });
    const febTwo = computeBucketPeriodMovement('2026-02', periodTwo, { successorStart: '2026-03-14' });
    const rate = perMinuteRate(3000, 60000);
    expect(febTwo.closing).toBe(3600 * rate); // base + the received carry
  });
});

describe('configured (not yet billed) fee', () => {
  it('marks the detail row as not yet billed and uses the configured fee', () => {
    const movement = computeBucketPeriodMovement('2026-02', period({
      totalMinutes: 6000,
      periodFee: 80000,
      feeSource: 'configured',
      minutesUsed: 1200,
    }));
    expect(movement.detail.notYetBilled).toBe(true);
    expect(movement.detail.feeSource).toBe('configured');
    expect(movement.detail.periodFee).toBe(80000);
    expect(movement.issued).toBe(80000);
  });
});

describe('hours rollforward aggregation', () => {
  it('merges multiple periods per client×currency', () => {
    const periods: BucketPeriodInput[] = [
      period({ usageId: 'u1', totalMinutes: 6000, minutesUsed: 2400, periodFee: 100000 }),
      period({ usageId: 'u2', contractLineId: 'line-2', totalMinutes: 3000, minutesUsed: 600, periodFee: 50000 }),
    ];
    const rollforward = computeHoursRollforward('2026-02', periods).get('client-1\u0000USD');
    expect(rollforward?.issued).toBe(150000);
    expect(rollforward?.applied).toBe(-(2400 * (100000 / 6000) + 600 * (50000 / 3000)));
    expect(rollforward?.details).toHaveLength(2);
  });

  it('groups by client and currency independently', () => {
    const periods: BucketPeriodInput[] = [
      period({ clientId: 'client-1', currencyCode: 'USD', periodFee: 100000 }),
      period({ clientId: 'client-1', currencyCode: 'EUR', periodFee: 90000 }),
      period({ clientId: 'client-2', currencyCode: 'USD', periodFee: 70000 }),
    ];
    const rollforward = computeHoursRollforward('2026-02', periods);
    expect(rollforward.get('client-1\u0000USD')?.issued).toBe(100000);
    expect(rollforward.get('client-1\u0000EUR')?.issued).toBe(90000);
    expect(rollforward.get('client-2\u0000USD')?.issued).toBe(70000);
  });

  it('closes arithmetically and carries the rollover across consecutive monthly periods', () => {
    // Monthly cadence with rollover: Jan 1–31 burns 4800 of 6000 (carry 1200
    // rolls to Feb), Feb 1–28 opens with that carry and burns 3000 of 7200.
    const rate = 100000 / 6000;
    const periods: BucketPeriodInput[] = [
      period({
        usageId: 'u1',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        totalMinutes: 6000,
        minutesUsed: 4800,
        allowRollover: true,
      }),
      period({
        usageId: 'u2',
        periodStart: '2026-02-01',
        periodEnd: '2026-02-28',
        totalMinutes: 6000,
        rolledOverMinutes: 1200,
        minutesUsed: 3000,
        allowRollover: true,
      }),
    ];

    const jan = computeHoursRollforward('2026-01', periods).get('client-1\u0000USD')!;
    // Jan: issued 100000, burn 48000, carry 1200 min (20000) still outstanding
    // at Jan 31 (the successor starts Feb 1, after the month end).
    expect(jan.opening).toBe(0);
    expect(jan.issued).toBe(100000);
    expect(jan.applied).toBe(-(4800 * rate));
    expect(jan.expired).toBe(0);
    expect(jan.closing).toBe(1200 * rate);
    expect(jan.opening + jan.issued + jan.applied + jan.expired).toBeCloseTo(jan.closing, 6);

    const feb = computeHoursRollforward('2026-02', periods).get('client-1\u0000USD')!;
    // Feb opens with the 1200-minute carry (20000), issues the new allowance,
    // burns 50000 and lapses the rolled-in minutes (20000).
    expect(feb.opening).toBe(jan.closing);
    expect(feb.issued).toBe(100000);
    expect(feb.applied).toBe(-(3000 * rate));
    expect(feb.expired).toBe(-(1200 * rate));
    expect(feb.closing).toBe(3000 * rate);
    expect(feb.opening + feb.issued + feb.applied + feb.expired).toBeCloseTo(feb.closing, 6);
  });
});
