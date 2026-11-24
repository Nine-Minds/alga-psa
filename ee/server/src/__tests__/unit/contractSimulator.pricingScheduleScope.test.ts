/**
 * A pricing schedule carries a line scope (contract_pricing_schedules.
 * contract_line_id), and the engine honours it: a line-scoped row reprices its
 * own line only and wins there over a whole-contract row. The simulator reads
 * the same scenario schedules through the same shared selector, so a scoped
 * schedule must not reprice a sibling line — otherwise "Simulate contract"
 * projects a contract with lines of 500 and 300 and a 900 schedule on one line
 * as 1,800 a period while billing invoices 1,200. No database access.
 */

import { describe, expect, it } from 'vitest';
import { ScenarioChargeSource } from '@ee/lib/billing/simulator/scenarioChargeSource';
import type { ScenarioPricingSchedule } from '@alga-psa/types';

const timing = {
  servicePeriodStart: '2026-11-01',
  servicePeriodEnd: '2026-11-30',
  servicePeriodStartExclusive: '2026-11-01',
  servicePeriodEndExclusive: '2026-12-01',
} as any;

function fixedLine(key: string, assignmentRate: number) {
  return {
    key,
    contract_line_type: 'Fixed',
    billing_frequency: 'monthly',
    custom_rate: assignmentRate,
    enable_proration: false,
    enable_overtime: false,
    services: [
      {
        service_id: `svc-${key}`,
        service_name: 'Managed bundle',
        item_kind: 'service',
        default_rate: assignmentRate,
        quantity: 1,
        configuration: { configuration_type: 'Fixed', base_rate: assignmentRate },
      },
    ],
  } as any;
}

async function resolveRate(
  line: ReturnType<typeof fixedLine>,
  pricingSchedules: ScenarioPricingSchedule[],
) {
  const source = new ScenarioChargeSource({
    scenario: { pricing_schedules: pricingSchedules, assumptions: {} } as any,
    line,
    lineFacts: {} as any,
    client: { client_id: 'client-1' },
    billingPeriod: { startDate: '2026-11-01', endDate: '2026-12-01' } as any,
    timings: {},
    periodIndex: 1,
    taxPorts: {} as any,
    currencyCode: 'USD',
    lineCycle: 'monthly',
    diagnostics: [],
    run: { poolStates: new Map(), prepaidLedgers: new Map() },
  });
  const charge = await source.fixed(timing);
  return {
    effectiveCustomRate: charge!.facts.effectiveCustomRate,
    customRateSource: charge!.facts.customRateSource,
  };
}

const schedule = (
  overrides: Partial<ScenarioPricingSchedule> = {},
): ScenarioPricingSchedule => ({
  effective_date: '2026-06-01T00:00:00Z',
  end_date: null,
  custom_rate: 90_000,
  contract_line_key: null,
  ...overrides,
});

describe('contract simulator: pricing schedule line scope', () => {
  it('reprices only the scoped line, leaving its sibling on the assignment rate', async () => {
    const schedules = [schedule({ contract_line_key: 'line-a' })];

    await expect(resolveRate(fixedLine('line-a', 50_000), schedules)).resolves.toEqual({
      effectiveCustomRate: 90_000,
      customRateSource: 'pricing_schedule',
    });
    await expect(resolveRate(fixedLine('line-b', 30_000), schedules)).resolves.toEqual({
      effectiveCustomRate: 30_000,
      customRateSource: 'assignment',
    });
  });

  it('keeps a whole-contract schedule applying to every fixed line', async () => {
    const schedules = [schedule()];

    await expect(resolveRate(fixedLine('line-a', 50_000), schedules)).resolves.toEqual({
      effectiveCustomRate: 90_000,
      customRateSource: 'pricing_schedule',
    });
    await expect(resolveRate(fixedLine('line-b', 30_000), schedules)).resolves.toEqual({
      effectiveCustomRate: 90_000,
      customRateSource: 'pricing_schedule',
    });
  });

  it('prefers the line-scoped rate over a whole-contract rate on the same period', async () => {
    const schedules = [
      schedule({ custom_rate: 90_000 }),
      schedule({ contract_line_key: 'line-a', custom_rate: 70_000 }),
    ];

    await expect(resolveRate(fixedLine('line-a', 50_000), schedules)).resolves.toEqual({
      effectiveCustomRate: 70_000,
      customRateSource: 'pricing_schedule',
    });
    await expect(resolveRate(fixedLine('line-b', 30_000), schedules)).resolves.toEqual({
      effectiveCustomRate: 90_000,
      customRateSource: 'pricing_schedule',
    });
  });

  it('treats a schedule with no scope field (a scenario saved before line scope) as whole-contract', async () => {
    const legacy = [
      { effective_date: '2026-06-01T00:00:00Z', end_date: null, custom_rate: 90_000 },
    ] as ScenarioPricingSchedule[];

    await expect(resolveRate(fixedLine('line-a', 50_000), legacy)).resolves.toEqual({
      effectiveCustomRate: 90_000,
      customRateSource: 'pricing_schedule',
    });
  });
});
