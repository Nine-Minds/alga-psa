/**
 * Pure unit tests for the contract simulator's hypothetical timeline layer
 * (ee/server/src/lib/billing/simulator/). No database access: the cadence
 * materialization and period-assignment logic under test is DB-free by
 * construction.
 */

import { describe, expect, it } from 'vitest';
import type { ScenarioLine, SimulationHorizon } from '@alga-psa/types';
import {
  assignServicePeriodsToInvoicePeriods,
  buildInvoicePeriods,
  generateLineServicePeriods,
  normalizeBillingCycle,
} from '@ee/lib/billing/simulator/hypotheticalPeriods';
import {
  buildSyntheticTimeEntry,
  resolveAssumedQuantity,
} from '@ee/lib/billing/simulator/syntheticActivity';

const HORIZON: SimulationHorizon = {
  start_date: '2026-08-01T00:00:00Z',
  period_count: 3,
};

function buildLine(overrides: Partial<ScenarioLine> = {}): ScenarioLine {
  return {
    key: 'line-1',
    origin_contract_line_id: 'line-1',
    contract_line_name: 'Managed Services',
    contract_line_type: 'Fixed',
    billing_frequency: 'monthly',
    billing_timing: 'arrears',
    cadence_owner: 'contract',
    custom_rate: null,
    enable_proration: false,
    services: [],
    ...overrides,
  };
}

describe('normalizeBillingCycle', () => {
  it('maps supported frequencies and defaults unknown values to monthly', () => {
    expect(normalizeBillingCycle('monthly')).toBe('monthly');
    expect(normalizeBillingCycle('Quarterly')).toBe('quarterly');
    expect(normalizeBillingCycle('semi-annually')).toBe('semi-annually');
    expect(normalizeBillingCycle('annually')).toBe('annually');
    expect(normalizeBillingCycle('weekly')).toBe('monthly');
    expect(normalizeBillingCycle(null)).toBe('monthly');
  });
});

describe('buildInvoicePeriods', () => {
  it('builds consecutive periods of the contract billing frequency', () => {
    const periods = buildInvoicePeriods(HORIZON, 'monthly');

    expect(periods).toEqual([
      { index: 0, startDate: '2026-08-01', endDateExclusive: '2026-09-01' },
      { index: 1, startDate: '2026-09-01', endDateExclusive: '2026-10-01' },
      { index: 2, startDate: '2026-10-01', endDateExclusive: '2026-11-01' },
    ]);
  });

  it('sizes periods by the contract cadence', () => {
    const periods = buildInvoicePeriods(
      { ...HORIZON, period_count: 2 },
      'quarterly',
    );

    expect(periods).toEqual([
      { index: 0, startDate: '2026-08-01', endDateExclusive: '2026-11-01' },
      { index: 1, startDate: '2026-11-01', endDateExclusive: '2027-02-01' },
    ]);
  });

  it('fails fast on a non-positive period count', () => {
    expect(() => buildInvoicePeriods({ ...HORIZON, period_count: 0 }, 'monthly'))
      .toThrow(/positive integer period_count/);
  });
});

describe('generateLineServicePeriods + assignServicePeriodsToInvoicePeriods', () => {
  it('assigns arrears service periods to the invoice period containing their end boundary', () => {
    const line = buildLine();
    const records = generateLineServicePeriods({
      line,
      horizon: HORIZON,
      contractBillingFrequency: 'monthly',
      contractStartDate: '2026-08-01T00:00:00Z',
      scenarioId: 'scenario-1',
    });
    const invoicePeriods = buildInvoicePeriods(HORIZON, 'monthly');
    const assignments = assignServicePeriodsToInvoicePeriods(
      records,
      invoicePeriods,
    );

    // Aug service period closes Sep 1 -> bills in the Sep invoice period;
    // nothing has closed yet inside the first period.
    const byIndex = new Map(
      assignments.map(({ periodIndex, record }) => [
        periodIndex,
        record.servicePeriod,
      ]),
    );
    expect(byIndex.get(0)).toBeUndefined();
    expect(byIndex.get(1)).toEqual(
      expect.objectContaining({ start: '2026-08-01', end: '2026-09-01' }),
    );
    expect(byIndex.get(2)).toEqual(
      expect.objectContaining({ start: '2026-09-01', end: '2026-10-01' }),
    );
    expect(assignments).toHaveLength(2);
  });

  it('assigns advance service periods to the invoice period containing their start', () => {
    const line = buildLine({ billing_timing: 'advance' });
    const records = generateLineServicePeriods({
      line,
      horizon: HORIZON,
      contractBillingFrequency: 'monthly',
      contractStartDate: '2026-08-01T00:00:00Z',
      scenarioId: 'scenario-1',
    });
    const invoicePeriods = buildInvoicePeriods(HORIZON, 'monthly');
    const assignments = assignServicePeriodsToInvoicePeriods(
      records,
      invoicePeriods,
    );

    const byIndex = new Map(
      assignments.map(({ periodIndex, record }) => [
        periodIndex,
        record.servicePeriod,
      ]),
    );
    expect(byIndex.get(0)).toEqual(
      expect.objectContaining({ start: '2026-08-01', end: '2026-09-01' }),
    );
    expect(byIndex.get(1)).toEqual(
      expect.objectContaining({ start: '2026-09-01', end: '2026-10-01' }),
    );
    expect(byIndex.get(2)).toEqual(
      expect.objectContaining({ start: '2026-10-01', end: '2026-11-01' }),
    );
    expect(assignments).toHaveLength(3);
  });

  it('drops a cadence that never lands a due boundary inside the horizon', () => {
    // Annual arrears anchored at the horizon start: the first service period
    // closes a year out, well past a 3-month horizon.
    const line = buildLine({ billing_frequency: 'annually' });
    const records = generateLineServicePeriods({
      line,
      horizon: HORIZON,
      contractBillingFrequency: 'monthly',
      contractStartDate: '2026-08-01T00:00:00Z',
      scenarioId: 'scenario-1',
    });
    const invoicePeriods = buildInvoicePeriods(HORIZON, 'monthly');

    expect(
      assignServicePeriodsToInvoicePeriods(records, invoicePeriods),
    ).toHaveLength(0);
  });
});

describe('resolveAssumedQuantity', () => {
  const assumptions = {
    'line-1:svc-1': { flat: 20, overrides: { 2: 35 } },
  };

  it('prefers the sparse per-period override over the flat value', () => {
    expect(resolveAssumedQuantity(assumptions, 'line-1', 'svc-1', 0)).toBe(20);
    expect(resolveAssumedQuantity(assumptions, 'line-1', 'svc-1', 2)).toBe(35);
  });

  it('returns zero for services without an assumption entry', () => {
    expect(resolveAssumedQuantity(assumptions, 'line-1', 'svc-2', 0)).toBe(0);
  });
});

describe('buildSyntheticTimeEntry', () => {
  const line = buildLine({ contract_line_type: 'Hourly' });
  const service = {
    service_id: 'svc-1',
    service_name: 'Remote Support',
    quantity: 1,
    custom_rate: 15000,
    default_rate: 18000,
    tax_rate_id: null,
    configuration: {
      configuration_type: 'Hourly' as const,
      hourly_rate: 17500,
      minimum_billable_time: 15,
      round_up_to_nearest: 15,
      user_type_rates: [],
    },
  };

  it('spans exactly the assumed hours from the service period start', () => {
    const entry = buildSyntheticTimeEntry({
      line,
      service,
      periodIndex: 1,
      assumedHours: 12,
      servicePeriodStart: '2026-09-01',
    });

    expect(entry.entry_id).toBe('sim-line-1-svc-1-1');
    expect(entry.start_time.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(entry.end_time.getTime() - entry.start_time.getTime()).toBe(
      12 * 3_600_000,
    );
    // Contract hourly rate wins over the service custom rate; the
    // currency-resolved catalog rate rides along as the compute fallback.
    expect(entry.custom_rate).toBe(17500);
    expect(entry.currency_rate).toBe(18000);
  });

  it('falls back to the service custom rate when the hourly config has none', () => {
    const entry = buildSyntheticTimeEntry({
      line,
      service: {
        ...service,
        configuration: { ...service.configuration, hourly_rate: null },
      },
      periodIndex: 0,
      assumedHours: 1,
      servicePeriodStart: '2026-08-01',
    });

    expect(entry.custom_rate).toBe(15000);
  });

  it('fails fast on non-positive assumed hours', () => {
    expect(() =>
      buildSyntheticTimeEntry({
        line,
        service,
        periodIndex: 0,
        assumedHours: 0,
        servicePeriodStart: '2026-08-01',
      }),
    ).toThrow(/positive assumed hours/);
  });
});
