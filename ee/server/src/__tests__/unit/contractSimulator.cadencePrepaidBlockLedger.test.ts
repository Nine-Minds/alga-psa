/**
 * Pure unit tests for the simulator's cadence Prepaid Block ledger (plan
 * section 8): block validity counted in cadence periods, oldest-expiry-first
 * draws, and the share of demand the blocks absorbed. No database access.
 */

import { describe, expect, it } from 'vitest';
import { buildCadencePrepaidBlockLedger } from '@ee/lib/billing/simulator/prepaidBlockLedger';

const timing = (start: string, end: string, ratio = 1) =>
  ({ servicePeriodStart: start, servicePeriodEnd: end, coverageRatio: ratio, duePosition: 'advance' }) as any;

const MONTHS = [
  ['2026-11-01', '2026-11-30'],
  ['2026-12-01', '2026-12-31'],
  ['2027-01-01', '2027-01-31'],
];

function ledgerFor(opts: { rollover: number; hours: Record<number, number>; enableProration?: boolean; ratios?: number[] }) {
  const scenario = {
    contract_start_date: '2026-11-01T00:00:00Z',
    horizon: { start_date: '2026-11-01T00:00:00Z', period_count: 3 },
    invoice_schedule: { anchor: { day_of_month: 1, month_of_year: null, day_of_week: null, reference_date: null } },
    assumptions: {
      'line-1:svc-h': { flat: 0, overrides: opts.hours },
    },
  } as any;
  const line = {
    key: 'line-1',
    billing_frequency: 'monthly',
    cadence_owner: 'contract',
    enable_proration: opts.enableProration ?? true,
    services: [
      {
        service_id: 'svc-h',
        service_name: 'Support',
        item_kind: 'service',
        configuration: { configuration_type: 'Hourly' },
      },
    ],
    prepaid_block: {
      block_minutes: 600,
      block_price: 150000,
      sold_as_service_id: 'svc-h',
      issue_mode: 'cadence',
      rollover_periods: opts.rollover,
    },
  } as any;
  const diagnostics: any[] = [];
  const ledger = buildCadencePrepaidBlockLedger({
    scenario,
    line,
    // One block per month, billed in window i.
    blockTimings: MONTHS.map(([s, e], i) => ({ periodIndex: i, timing: timing(s, e, opts.ratios?.[i] ?? 1) })),
    // Arrears hourly: window i bills month i-1 and carries window i's assumption.
    hourlyTimings: MONTHS.slice(0, 2).map(([s, e], i) => ({ periodIndex: i + 1, timing: timing(s, e) })),
    diagnostics,
  });
  return { ledger: ledger!, diagnostics };
}

describe('buildCadencePrepaidBlockLedger', () => {
  it('draws the block first and leaves the excess as uncovered demand', () => {
    const { ledger } = ledgerFor({ rollover: 0, hours: { 1: 14 } });
    expect(ledger.drawsByPeriod.get(1)).toEqual([
      { periodIndex: 1, blockOrdinal: 1, minutes: 600, remainingMinutes: 0 },
    ]);
    expect(ledger.demandCoverage.get(1)).toBeCloseTo(600 / 840, 10);
  });

  it('absorbs a smaller demand fully and keeps the balance on the block', () => {
    const { ledger } = ledgerFor({ rollover: 0, hours: { 1: 8 } });
    expect(ledger.drawsByPeriod.get(1)?.[0]).toMatchObject({ minutes: 480, remainingMinutes: 120 });
    expect(ledger.demandCoverage.get(1)).toBe(1);
  });

  it('rollover of one period lets unused hours serve the next month', () => {
    // Month 1 uses 6 h; month 2 uses 13 h: 4 h left of block 1 + 10 h of block 2.
    const { ledger } = ledgerFor({ rollover: 1, hours: { 1: 6, 2: 13 } });
    expect(ledger.drawsByPeriod.get(2)).toEqual([
      { periodIndex: 2, blockOrdinal: 1, minutes: 240, remainingMinutes: 0 },
      { periodIndex: 2, blockOrdinal: 2, minutes: 540, remainingMinutes: 60 },
    ]);
    expect(ledger.demandCoverage.get(2)).toBe(1);
  });

  it('without rollover the unused hours expire with their period', () => {
    const { ledger } = ledgerFor({ rollover: 0, hours: { 1: 6, 2: 13 } });
    expect(ledger.drawsByPeriod.get(2)).toEqual([
      { periodIndex: 2, blockOrdinal: 2, minutes: 600, remainingMinutes: 0 },
    ]);
    expect(ledger.demandCoverage.get(2)).toBeCloseTo(600 / 780, 10);
  });

  it('scales a part-covered first block with proration, not without', () => {
    const prorated = ledgerFor({ rollover: 0, hours: { 1: 14 }, ratios: [0.5, 1, 1] }).ledger;
    expect(prorated.drawsByPeriod.get(1)?.[0].minutes).toBe(300);
    const whole = ledgerFor({ rollover: 0, hours: { 1: 14 }, ratios: [0.5, 1, 1], enableProration: false }).ledger;
    expect(whole.drawsByPeriod.get(1)?.[0].minutes).toBe(600);
  });

  it('records the cadence the rollover was counted on', () => {
    const { ledger } = ledgerFor({ rollover: 0, hours: {} });
    expect(ledger.cadenceRule).toMatchObject({ owner: 'contract', billingCycle: 'monthly', anchorDate: '2026-11-01' });
  });
});
