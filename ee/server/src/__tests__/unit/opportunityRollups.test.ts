import { describe, expect, it } from 'vitest';
import { buildSellerRollups, type RollupClosedRow, type RollupOpenRow } from '../../lib/opportunities/rollups';

const seller = '11111111-1111-4111-8111-111111111111';

function openRow(overrides: Partial<RollupOpenRow> = {}): RollupOpenRow {
  return {
    owner_id: seller,
    currency_code: 'USD',
    mrr_cents: 100000,
    nrr_cents: 60000,
    hardware_cents: 40000,
    ...overrides,
  };
}

function closedRow(id: string, overrides: Partial<RollupClosedRow> = {}): RollupClosedRow {
  return {
    opportunity_id: id,
    owner_id: seller,
    status: 'won',
    opportunity_type: 'new_logo',
    currency_code: 'USD',
    mrr_cents: 50000,
    nrr_cents: 20000,
    hardware_cents: 10000,
    ...overrides,
  };
}

function rollup(rows: ReturnType<typeof buildSellerRollups>, currency: string) {
  const found = rows.find((row) => row.currency_code === currency);
  if (!found) throw new Error(`no ${currency} rollup`);
  return found;
}

describe('seller rollup currencies', () => {
  it('splits won totals per currency instead of adding pounds to dollars', () => {
    const rows = buildSellerRollups(
      [],
      [
        closedRow('won-usd'),
        closedRow('won-gbp', { currency_code: 'GBP', mrr_cents: 30000, nrr_cents: 5000, hardware_cents: 0 }),
      ],
      new Map([[seller, 'Ada Seller']]),
      new Set(),
    );

    expect(rows).toHaveLength(2);
    expect(rollup(rows, 'USD').won_mrr_cents).toBe(50000);
    expect(rollup(rows, 'GBP').won_mrr_cents).toBe(30000);
    expect(rollup(rows, 'GBP').won_count).toBe(1);
  });
});

describe('seller rollup one-time value', () => {
  it('folds hardware into the one-time figure, tolerating bigint strings and nulls', () => {
    const rows = buildSellerRollups(
      [openRow({ nrr_cents: '60000', hardware_cents: null })],
      [closedRow('won-1')],
      new Map(),
      new Set(),
    );

    const [row] = rows;
    expect(row.open_one_time_cents).toBe(60000);
    // $200 NRR + $100 hardware must read as $300 one-time.
    expect(row.won_one_time_cents).toBe(30000);
  });
});

describe('seller rollup attach rate', () => {
  it('computes one owner-level rate across currencies and repeats it on each row', () => {
    const rows = buildSellerRollups(
      [],
      [
        closedRow('attached-usd'),
        closedRow('bare-eur', { currency_code: 'EUR' }),
      ],
      new Map(),
      new Set(['attached-usd']),
    );

    // One of two new logos attached — the EUR row must not read "0% attach"
    // just because its own cohort happens to be empty of attachments.
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.attach_rate).toBe(0.5);
    }
  });

  it('leaves the rate at zero for sellers with no new-logo cohort', () => {
    const rows = buildSellerRollups([], [closedRow('lost-1', { status: 'lost' })], new Map(), new Set());
    expect(rows[0].attach_rate).toBe(0);
  });
});
