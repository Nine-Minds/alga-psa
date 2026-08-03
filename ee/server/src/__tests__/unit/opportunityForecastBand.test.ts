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

describe('forecast band one-time value', () => {
  it('counts hardware as part of the non-recurring number', () => {
    const band = calculateForecastBand([row()], new Map());
    expect(band.floor_nrr_cents).toBe(100000);
    expect(band.ceiling_nrr_cents).toBe(100000);
  });

  it('weights hardware alongside NRR for non-floor stages', () => {
    const band = calculateForecastBand([row({ stage: 'qualified' })], new Map());
    expect(band.floor_nrr_cents).toBe(0);
    // (60000 + 40000) * 0.15
    expect(band.ceiling_nrr_cents).toBe(15000);
  });

  it('treats a missing hardware column as zero', () => {
    const band = calculateForecastBand([row({ hardware_cents: null })], new Map());
    expect(band.ceiling_nrr_cents).toBe(60000);
  });
});
