/**
 * Hourly and Usage lines always bill in arrears, including in the unsaved
 * contract simulator. A contract-wide "advance" timing applies to Fixed lines
 * only. DB access is stubbed: only the timing normalisation is under test.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ContractDraftSimulationInput } from '@alga-psa/types';

const SERVICE_ID = 'svc-1';

vi.mock('@alga-psa/db', () => {
  const catalogRows = [
    {
      service_id: 'svc-1',
      service_name: 'Service',
      default_rate: 10000,
      tax_rate_id: null,
      item_kind: 'service',
      is_license: false,
      currency_rate: 10000,
    },
  ];
  const query: any = {
    where: () => query,
    first: async () => ({ client_id: 'client-1', client_name: 'Client' }),
    select: async () => catalogRows,
  };
  return {
    tenantDb: () => ({
      table: () => query,
      tenantJoin: () => undefined,
    }),
  };
});

vi.mock('@alga-psa/shared/billingClients/billingSchedule', () => ({
  getClientBillingCycleAnchor: async () => ({
    billingCycle: 'monthly',
    anchor: { dayOfMonth: 1, monthOfYear: null, dayOfWeek: null, referenceDate: null },
  }),
  loadClientBillingCycleHistory: async () => [],
}));

import { draftContractToScenario } from '@ee/lib/billing/simulator/draftContractToScenario';
import {
  assignServicePeriodsToInvoicePeriods,
  buildInvoicePeriods,
  generateLineServicePeriods,
} from '@ee/lib/billing/simulator/hypotheticalPeriods';

const draft: ContractDraftSimulationInput = {
  client_id: 'client-1',
  contract_name: 'Mixed',
  start_date: '2026-08-01T00:00:00Z',
  billing_frequency: 'monthly',
  currency_code: 'USD',
  billing_timing: 'advance',
  cadence_owner: 'contract',
  enable_proration: false,
  fixed_lines: [
    {
      line_key: 'fixed-1',
      enable_proration: false,
      services: [{ service_id: SERVICE_ID, quantity: 1 }] as any,
    },
  ],
  product_services: [],
  hourly_services: [{ service_id: SERVICE_ID, hourly_rate: 10000 }],
  usage_services: [{ service_id: SERVICE_ID, unit_rate: 100 }],
};

describe('draftContractToScenario timing invariant', () => {
  it('applies contract-wide advance to Fixed lines only', async () => {
    const scenario = await draftContractToScenario({} as any, 'tenant-1', draft);
    const byType = Object.fromEntries(
      scenario.lines.map((line) => [line.contract_line_type, line.billing_timing]),
    );
    expect(byType).toEqual({ Fixed: 'advance', Hourly: 'arrears', Usage: 'arrears' });
  });

  it('bills the previous service period for the Hourly line', async () => {
    const scenario = await draftContractToScenario({} as any, 'tenant-1', draft);
    const hourly = scenario.lines.find((line) => line.contract_line_type === 'Hourly')!;
    const horizon = { start_date: '2026-08-01T00:00:00Z', period_count: 3 };
    const schedule = {
      billing_cycle: 'monthly' as const,
      anchor: { day_of_month: 1, month_of_year: null, day_of_week: null, reference_date: null },
    };
    const records = generateLineServicePeriods({
      line: hourly,
      horizon,
      invoiceSchedule: schedule,
      contractStartDate: '2026-08-01T00:00:00Z',
      scenarioId: 'scenario-1',
    }).flatMap((streamPeriods) => streamPeriods.records);
    const assignments = assignServicePeriodsToInvoicePeriods(
      records,
      buildInvoicePeriods(horizon, schedule),
    );
    const byIndex = new Map(assignments.map(({ periodIndex, record }) => [periodIndex, record.servicePeriod]));
    // First invoice bills nothing yet; the second bills August.
    expect(byIndex.get(0)).toBeUndefined();
    expect(byIndex.get(1)).toEqual(expect.objectContaining({ start: '2026-08-01', end: '2026-09-01' }));
  });

  it('normalises a stale advance value on an Hourly scenario line at the period layer', () => {
    const horizon = { start_date: '2026-08-01T00:00:00Z', period_count: 3 };
    const schedule = {
      billing_cycle: 'monthly' as const,
      anchor: { day_of_month: 1, month_of_year: null, day_of_week: null, reference_date: null },
    };
    const records = generateLineServicePeriods({
      line: { contract_line_type: 'Hourly', billing_timing: 'advance', billing_frequency: 'monthly', cadence_owner: 'contract', key: 'h' } as any,
      horizon,
      invoiceSchedule: schedule,
      contractStartDate: '2026-08-01T00:00:00Z',
      scenarioId: 's',
    }).flatMap((streamPeriods) => streamPeriods.records);
    const assignments = assignServicePeriodsToInvoicePeriods(records, buildInvoicePeriods(horizon, schedule));
    expect(assignments.find((a) => a.periodIndex === 0)).toBeUndefined();
  });
});
