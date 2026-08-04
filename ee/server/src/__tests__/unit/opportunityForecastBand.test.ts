import { describe, expect, it } from 'vitest';
import { calculateForecastBand, type ForecastOpportunityRow } from '../../lib/opportunities/forecast';

function row(overrides: Partial<ForecastOpportunityRow> = {}): ForecastOpportunityRow {
  return {
    opportunity_id: 'opportunity-1',
    opportunity_number: 'OPP-1042',
    title: 'Phone system refresh',
    owner_id: 'user-1',
    status: 'open',
    stage: 'verbal',
    mrr_cents: 100000,
    nrr_cents: 60000,
    hardware_cents: 40000,
    currency_code: 'USD',
    ...overrides,
  };
}

function usd(band: ReturnType<typeof calculateForecastBand>) {
  const found = band.by_currency.find((entry) => entry.currency_code === 'USD');
  if (!found) throw new Error('no USD band');
  return found;
}

describe('forecast band one-time value', () => {
  it('counts hardware as part of the non-recurring number', () => {
    const band = usd(calculateForecastBand([row()], new Map()));
    expect(band.floor_nrr_cents).toBe(100000);
    expect(band.ceiling_nrr_cents).toBe(100000);
  });

  it('weights hardware alongside NRR for non-floor stages', () => {
    const band = usd(calculateForecastBand([row({ stage: 'qualified' })], new Map()));
    expect(band.floor_nrr_cents).toBe(0);
    // (60000 + 40000) * 0.15
    expect(band.ceiling_nrr_cents).toBe(15000);
  });

  it('treats a missing hardware column as zero', () => {
    const band = usd(calculateForecastBand([row({ hardware_cents: null })], new Map()));
    expect(band.ceiling_nrr_cents).toBe(60000);
  });
});

describe('forecast band currencies', () => {
  it('never adds pounds to dollars', () => {
    const band = calculateForecastBand(
      [row(), row({ opportunity_id: 'opportunity-2', currency_code: 'GBP', mrr_cents: 50000 })],
      new Map(),
    );

    expect(band.by_currency).toHaveLength(2);
    expect(usd(band).floor_mrr_cents).toBe(100000);
    expect(band.by_currency.find((entry) => entry.currency_code === 'GBP')?.floor_mrr_cents).toBe(50000);
  });
});
