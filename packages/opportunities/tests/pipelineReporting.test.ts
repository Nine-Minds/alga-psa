import { describe, expect, it } from 'vitest';
import {
  currentQuarterRange,
  mapPipelineStageRows,
  oneTimeCents,
  summarizePipelineReport,
} from '../src/lib/pipelineReporting';

describe('one-time value definition', () => {
  it('always folds hardware into the one-time number', () => {
    expect(oneTimeCents({ nrr_cents: 60000, hardware_cents: 40000 })).toBe(100000);
  });

  it('tolerates the bigint strings knex hands back and null hardware', () => {
    expect(oneTimeCents({ nrr_cents: '60000', hardware_cents: null })).toBe(60000);
  });
});

describe('dashboard snapshot stage rows', () => {
  it('carries hardware through so the snapshot matches the pipeline table', () => {
    const rows = mapPipelineStageRows([
      {
        stage: 'qualified',
        currency_code: 'USD',
        opportunity_count: '1',
        mrr_cents: '100000',
        nrr_cents: '60000',
        hardware_cents: '40000',
      },
    ]);
    expect(rows).toEqual([{
      stage: 'qualified',
      currency_code: 'USD',
      opportunity_count: 1,
      mrr_cents: 100000,
      nrr_cents: 60000,
      hardware_cents: 40000,
    }]);
    // The exact regression: $600 NRR + $400 hardware must read as $1,000 one-time.
    expect(oneTimeCents(rows[0])).toBe(100000);
  });

  it('defaults missing sums to zero rather than NaN', () => {
    expect(mapPipelineStageRows([{ stage: 'identified', currency_code: 'USD' }])[0]).toEqual({
      stage: 'identified',
      currency_code: 'USD',
      opportunity_count: 0,
      mrr_cents: 0,
      nrr_cents: 0,
      hardware_cents: 0,
    });
  });
});

describe('pipeline report summary', () => {
  const now = new Date('2026-08-03T00:00:00.000Z');

  it('totals open pipeline, weights it by stage base rate, and counts the next 30 days', () => {
    const [usd] = summarizePipelineReport(
      [
        {
          stage: 'qualified',
          currency_code: 'USD',
          opportunity_count: 2,
          mrr_cents: 100000,
          one_time_cents: 100000,
          expected_close_date: '2026-08-20',
        },
        {
          stage: 'verbal',
          currency_code: 'USD',
          opportunity_count: 1,
          mrr_cents: 50000,
          one_time_cents: 0,
          expected_close_date: '2026-12-01',
        },
      ],
      [{ currency_code: 'USD', mrr_cents: 25000, one_time_cents: 5000 }],
      now,
    );

    expect(usd.open_count).toBe(3);
    expect(usd.open_mrr_cents).toBe(150000);
    expect(usd.open_one_time_cents).toBe(100000);
    // 100000 * 0.15 + 50000 * 0.8
    expect(usd.weighted_mrr_cents).toBe(55000);
    expect(usd.weighted_one_time_cents).toBe(15000);
    expect(usd.closing_30d_count).toBe(2);
    expect(usd.closing_30d_mrr_cents).toBe(100000);
    expect(usd.won_quarter_count).toBe(1);
    expect(usd.won_quarter_mrr_cents).toBe(25000);
    expect(usd.won_quarter_one_time_cents).toBe(5000);
  });

  it('never mixes currencies into one total', () => {
    const result = summarizePipelineReport(
      [
        { stage: 'proposed', currency_code: 'USD', opportunity_count: 1, mrr_cents: 100000, one_time_cents: 0 },
        { stage: 'proposed', currency_code: 'EUR', opportunity_count: 1, mrr_cents: 10000, one_time_cents: 0 },
      ],
      [],
      now,
    );
    expect(result.map((row) => row.currency_code)).toEqual(['USD', 'EUR']);
    expect(result[0].open_mrr_cents).toBe(100000);
    expect(result[1].open_mrr_cents).toBe(10000);
  });

  it('excludes deals whose expected close has already passed', () => {
    const [usd] = summarizePipelineReport(
      [{
        stage: 'proposed',
        currency_code: 'USD',
        opportunity_count: 1,
        mrr_cents: 100000,
        one_time_cents: 0,
        expected_close_date: '2026-07-01',
      }],
      [],
      now,
    );
    expect(usd.closing_30d_count).toBe(0);
  });
});

describe('current quarter range', () => {
  it('brackets the calendar quarter containing the date', () => {
    expect(currentQuarterRange(new Date('2026-08-03T12:00:00.000Z'))).toEqual({
      start: '2026-07-01T00:00:00.000Z',
      endExclusive: '2026-10-01T00:00:00.000Z',
      label: 'Q3 2026',
    });
  });
});
