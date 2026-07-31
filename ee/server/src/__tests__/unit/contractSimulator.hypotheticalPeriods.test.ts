/**
 * Pure unit tests for the contract simulator's hypothetical timeline layer
 * (ee/server/src/lib/billing/simulator/). No database access: the cadence
 * materialization and period-assignment logic under test is DB-free by
 * construction.
 */

import { describe, expect, it } from 'vitest';
import type {
  ContractSimulationResult,
  ScenarioLine,
  SimulationHorizon,
} from '@alga-psa/types';
import { compareSimulations } from '@ee/lib/billing/simulator/compareSimulations';
import {
  aggregateActivityAssumptions,
  buildRecentAssumptionPeriods,
} from '@ee/lib/billing/simulator/activityAssumptions';
import {
  assignServicePeriodsToInvoicePeriods,
  buildInvoicePeriods,
  generateLineServicePeriods,
  normalizeBillingCycle,
} from '@ee/lib/billing/simulator/hypotheticalPeriods';
import {
  buildSyntheticTimeEntry,
  buildSyntheticUsageRecord,
  buildUsageServiceConfigMap,
  resolveAssumedQuantity,
} from '@ee/lib/billing/simulator/syntheticActivity';

const HORIZON: SimulationHorizon = {
  start_date: '2026-08-01T00:00:00Z',
  period_count: 3,
};

const MONTHLY_FIRST = {
  billing_cycle: 'monthly' as const,
  anchor: {
    day_of_month: 1,
    month_of_year: null,
    day_of_week: null,
    reference_date: null,
  },
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
    location_id: null,
    enable_overtime: false,
    overtime_threshold: null,
    overtime_rate: null,
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
    const periods = buildInvoicePeriods(HORIZON, MONTHLY_FIRST);

    expect(periods).toEqual([
      { index: 0, startDate: '2026-08-01', endDateExclusive: '2026-09-01' },
      { index: 1, startDate: '2026-09-01', endDateExclusive: '2026-10-01' },
      { index: 2, startDate: '2026-10-01', endDateExclusive: '2026-11-01' },
    ]);
  });

  it('sizes periods by the contract cadence', () => {
    const periods = buildInvoicePeriods(
      { ...HORIZON, period_count: 2 },
      {
        billing_cycle: 'quarterly',
        anchor: {
          day_of_month: 1,
          month_of_year: 1,
          day_of_week: null,
          reference_date: null,
        },
      },
    );

    expect(periods).toEqual([
      { index: 0, startDate: '2026-07-01', endDateExclusive: '2026-10-01' },
      { index: 1, startDate: '2026-10-01', endDateExclusive: '2027-01-01' },
    ]);
  });

  it('fails fast on a non-positive period count', () => {
    expect(() => buildInvoicePeriods({ ...HORIZON, period_count: 0 }, MONTHLY_FIRST))
      .toThrow(/positive integer period_count/);
  });

  it('aligns the first window to the client billing anchor containing the horizon start', () => {
    const periods = buildInvoicePeriods(
      { start_date: '2026-08-12T00:00:00Z', period_count: 2 },
      {
        billing_cycle: 'monthly',
        anchor: {
          day_of_month: 15,
          month_of_year: null,
          day_of_week: null,
          reference_date: null,
        },
      },
    );

    expect(periods).toEqual([
      { index: 0, startDate: '2026-07-15', endDateExclusive: '2026-08-15' },
      { index: 1, startDate: '2026-08-15', endDateExclusive: '2026-09-15' },
    ]);
  });
});

describe('generateLineServicePeriods + assignServicePeriodsToInvoicePeriods', () => {
  it('assigns arrears service periods to the invoice period containing their end boundary', () => {
    const line = buildLine();
    const records = generateLineServicePeriods({
      line,
      horizon: HORIZON,
      invoiceSchedule: MONTHLY_FIRST,
      contractStartDate: '2026-08-01T00:00:00Z',
      scenarioId: 'scenario-1',
    });
    const invoicePeriods = buildInvoicePeriods(HORIZON, MONTHLY_FIRST);
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
      invoiceSchedule: MONTHLY_FIRST,
      contractStartDate: '2026-08-01T00:00:00Z',
      scenarioId: 'scenario-1',
    });
    const invoicePeriods = buildInvoicePeriods(HORIZON, MONTHLY_FIRST);
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
      invoiceSchedule: MONTHLY_FIRST,
      contractStartDate: '2026-08-01T00:00:00Z',
      scenarioId: 'scenario-1',
    });
    const invoicePeriods = buildInvoicePeriods(HORIZON, MONTHLY_FIRST);

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
    item_kind: 'service',
    is_license: false,
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

describe('synthetic usage', () => {
  const line = buildLine({ contract_line_type: 'Usage' });
  const service = {
    service_id: 'svc-usage',
    service_name: 'Managed devices',
    quantity: 1,
    custom_rate: 225,
    default_rate: 250,
    tax_rate_id: null,
    item_kind: 'service',
    is_license: false,
    configuration: {
      configuration_type: 'Usage' as const,
      unit_of_measure: 'device',
      enable_tiered_pricing: false,
      minimum_usage: 5,
      base_rate: 200,
      tiers: [],
    },
  };

  it('builds a stable aggregate usage record from the assumption', () => {
    expect(
      buildSyntheticUsageRecord({
        line,
        service,
        periodIndex: 2,
        assumedQuantity: 18,
      }),
    ).toEqual({
      usage_id: 'sim-line-1-svc-usage-2',
      service_id: 'svc-usage',
      service_name: 'Managed devices',
      quantity: 18,
      tax_rate_id: null,
      currency_rate: 250,
    });
  });

  it('maps scenario pricing, minimums, and tiers into shared compute inputs', () => {
    const map = buildUsageServiceConfigMap({ ...line, services: [service] });
    expect(map.get('svc-usage')).toEqual({
      config: {
        config_id: 'line-1:svc-usage',
        custom_rate: 225,
        minimum_usage: 5,
        enable_tiered_pricing: false,
      },
      rateTiers: [],
    });
  });
});

describe('compareSimulations', () => {
  const result = (
    lines: ContractSimulationResult['periods'][number]['lines'],
  ): ContractSimulationResult => ({
    scenario_id: 'scenario',
    currency_code: 'USD',
    horizon: { start_date: '2026-08-01', period_count: 1 },
    diagnostics: [],
    periods: [
      {
        index: 0,
        period_start: '2026-08-01',
        period_end: '2026-08-31',
        label: 'Aug 2026',
        lines,
        subtotal: lines.reduce((sum, line) => sum + line.net_amount, 0),
        tax: lines.reduce((sum, line) => sum + line.tax_amount, 0),
        total: lines.reduce((sum, line) => sum + line.total, 0),
        markers: [],
        invoice_view_model: {
          invoiceNumber: 'SIM-1',
          issueDate: '2026-08-01',
          dueDate: '2026-08-31',
          tenantClient: null,
          customer: { name: 'Acme', address: 'N/A' },
          items: [],
          subtotal: 0,
          tax: 0,
          total: 0,
          currencyCode: 'USD',
        },
      },
    ],
  });
  const line = (overrides: Record<string, unknown> = {}) => ({
    line_key: 'line-1',
    service_id: 'svc-1',
    service_name: 'Managed service',
    charge_type: 'fixed',
    quantity_label: '1 month',
    rate_label: '$100.00',
    net_amount: 10000,
    tax_amount: 0,
    total: 10000,
    explanation: null,
    ...overrides,
  });

  it('reports changed, added, and removed lines with period and horizon deltas', () => {
    const baseline = result([
      line(),
      line({
        line_key: 'removed-line',
        service_id: 'removed',
        service_name: 'Removed service',
        total: 2500,
        net_amount: 2500,
      }),
    ]);
    const scenario = result([
      line({ total: 12500, net_amount: 12500 }),
      line({
        line_key: 'added-line',
        service_id: 'added',
        service_name: 'Added service',
        total: 4000,
        net_amount: 4000,
      }),
    ]);

    const comparison = compareSimulations(baseline, scenario);
    expect(comparison.periods[0].lines).toEqual([
      expect.objectContaining({ kind: 'added', delta: 4000 }),
      expect.objectContaining({ kind: 'changed', delta: 2500 }),
      expect.objectContaining({ kind: 'removed', delta: -2500 }),
    ]);
    expect(comparison.periods[0].total_delta).toBe(4000);
    expect(comparison.horizon_total_delta).toBe(4000);
  });
});

describe('historical activity assumptions', () => {
  const scenario = {
    scenario_id: 'scenario-history',
    name: 'History',
    contract_id: 'contract-1',
    is_system_managed_default: false,
    client_binding: { kind: 'client' as const, client_id: 'client-1', client_name: 'Acme' },
    invoice_schedule: MONTHLY_FIRST,
    billing_frequency: 'monthly',
    contract_start_date: '2026-01-01',
    contract_end_date: null,
    currency_code: 'USD',
    pricing_schedules: [],
    assumptions: {},
    horizon: { start_date: '2026-08-12', period_count: 3 },
    lines: [
      buildLine({
        key: 'hourly-line',
        origin_contract_line_id: 'hourly-origin',
        contract_line_type: 'Hourly',
        services: [
          {
            service_id: 'shared-service',
            service_name: 'Remote support',
            quantity: 1,
            custom_rate: 15000,
            default_rate: 15000,
            tax_rate_id: null,
            item_kind: 'service',
            is_license: false,
            configuration: {
              configuration_type: 'Hourly',
              hourly_rate: 15000,
              minimum_billable_time: 0,
              round_up_to_nearest: 0,
              user_type_rates: [],
            },
          },
        ],
      }),
      buildLine({
        key: 'second-hourly-line',
        origin_contract_line_id: 'second-hourly-origin',
        contract_line_type: 'Hourly',
        services: [
          {
            service_id: 'shared-service',
            service_name: 'Remote support',
            quantity: 1,
            custom_rate: 15000,
            default_rate: 15000,
            tax_rate_id: null,
            item_kind: 'service',
            is_license: false,
            configuration: {
              configuration_type: 'Hourly',
              hourly_rate: 15000,
              minimum_billable_time: 0,
              round_up_to_nearest: 0,
              user_type_rates: [],
            },
          },
        ],
      }),
      buildLine({
        key: 'usage-line',
        origin_contract_line_id: 'usage-origin',
        contract_line_type: 'Usage',
        services: [
          {
            service_id: 'usage-service',
            service_name: 'Devices',
            quantity: 1,
            custom_rate: 100,
            default_rate: 100,
            tax_rate_id: null,
            item_kind: 'service',
            is_license: false,
            configuration: {
              configuration_type: 'Usage',
              unit_of_measure: 'device',
              enable_tiered_pricing: false,
              minimum_usage: null,
              base_rate: 100,
              tiers: [],
            },
          },
        ],
      }),
    ],
  };
  const periods = [
    { start: '2026-05-01', endExclusive: '2026-06-01' },
    { start: '2026-06-01', endExclusive: '2026-07-01' },
    { start: '2026-07-01', endExclusive: '2026-08-01' },
  ];

  it('builds the prior production-anchored invoice windows', () => {
    expect(buildRecentAssumptionPeriods(scenario, 3)).toEqual(periods.map((period) => ({
      start: `${period.start}T00:00:00Z`,
      endExclusive: `${period.endExclusive}T00:00:00Z`,
    })));
  });

  it('aggregates assigned time and usage while rejecting ambiguous unassigned activity', () => {
    const assumptions = aggregateActivityAssumptions({
      scenario,
      periods,
      mode: 'average',
      timeRows: [
        {
          contract_line_id: 'hourly-origin',
          service_id: 'shared-service',
          entry_date: '2026-05-15',
          billable_duration: 120,
        },
        {
          contract_line_id: null,
          service_id: 'shared-service',
          entry_date: '2026-06-15',
          billable_duration: 600,
        },
      ],
      usageRows: [
        {
          contract_line_id: 'usage-origin',
          service_id: 'usage-service',
          usage_date: '2026-07-15',
          quantity: 30,
        },
      ],
    });

    expect(assumptions['hourly-line:shared-service'].flat).toBeCloseTo(2 / 3);
    expect(assumptions['second-hourly-line:shared-service']).toBeUndefined();
    expect(assumptions['usage-line:usage-service'].flat).toBe(10);
  });

  it('populates replay overrides period by period', () => {
    const assumptions = aggregateActivityAssumptions({
      scenario,
      periods,
      mode: 'replay',
      timeRows: [
        {
          contract_line_id: 'hourly-origin',
          service_id: 'shared-service',
          entry_date: '2026-05-15',
          billable_duration: 60,
        },
        {
          contract_line_id: 'hourly-origin',
          service_id: 'shared-service',
          entry_date: '2026-07-15',
          billable_duration: 180,
        },
      ],
      usageRows: [],
    });
    expect(assumptions['hourly-line:shared-service']).toEqual({
      flat: 0,
      overrides: { 0: 1, 1: 0, 2: 3 },
    });
  });
});
