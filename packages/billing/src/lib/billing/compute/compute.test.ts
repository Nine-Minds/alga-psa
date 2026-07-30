import { describe, expect, it } from 'vitest';
import type { IClientContractLine } from '@alga-psa/types';
import { computeFixedCharges } from './computeFixedCharges';
import { computeTimeBasedCharges } from './computeTimeBasedCharges';
import { computeUsageBasedCharges } from './computeUsageBasedCharges';
import type { ChargeComputeTaxPorts, ChargeComputeTiming } from './types';

const TEN_PERCENT_PORTS: ChargeComputeTaxPorts = {
  getTaxInfoFromService: async (service) => ({
    taxRegion: service.tax_rate_id ? 'US-TEST' : null,
    isTaxable: Boolean(service.tax_rate_id),
  }),
  getLocationTaxRegionCode: async () => null,
  getClientDefaultTaxRegionCode: async () => 'US-TEST',
  calculateTax: async (_clientId, netAmountInCents) => ({
    taxRate: 10,
    taxAmount: Math.round(netAmountInCents * 0.1),
  }),
};

const PERIOD = { startDate: '2026-08-01', endDate: '2026-09-01' };

function timing(overrides: Partial<ChargeComputeTiming> = {}): ChargeComputeTiming {
  return {
    duePosition: 'arrears',
    servicePeriodStart: '2026-08-01',
    servicePeriodEnd: '2026-08-31',
    servicePeriodStartExclusive: '2026-08-01',
    servicePeriodEndExclusive: '2026-09-01',
    coverageRatio: 1,
    ...overrides,
  };
}

function line(overrides: Partial<IClientContractLine> = {}): IClientContractLine {
  return {
    client_contract_line_id: 'ccl-1',
    client_id: 'client-1',
    contract_line_id: 'cl-1',
    start_date: '2026-01-01',
    end_date: null,
    is_active: true,
    currency_code: 'USD',
    contract_line_name: 'Managed services',
    contract_line_type: 'Fixed',
    billing_timing: 'arrears',
    ...overrides,
  };
}

const CLIENT = { client_id: 'client-1', is_tax_exempt: false };

describe('computeFixedCharges', () => {
  it('bills the full plan rate for a single-service fixed plan', async () => {
    const result = await computeFixedCharges(
      {
        clientId: 'client-1',
        billingPeriod: PERIOD,
        clientContractLine: line(),
        timing: timing(),
        client: CLIENT,
        contractLineDetails: { contract_line_type: 'Fixed', custom_rate: 240000 },
        effectiveCustomRate: null,
        customRateSource: null,
        planServices: [
          {
            service_id: 'svc-1',
            service_name: 'Managed workstations',
            default_rate: 240000,
            tax_rate_id: 'tax-1',
            config_id: 'cfg-1',
            configuration_quantity: 1,
            service_base_rate: null,
          },
        ],
        fallbackService: null,
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges).toHaveLength(1);
    expect(result.charges[0].total).toBe(240000);
    expect(result.charges[0].tax_amount).toBe(24000);
    expect(result.charges[0].proportion).toBe(1);
    expect(result.advanceGuard).toBeNull();
    expect(result.explanations).toHaveLength(1);
    expect(result.explanations[0].steps.at(-1)).toContain('$2,400.00');
  });

  it('allocates the plan fee across services by FMV proportion', async () => {
    const result = await computeFixedCharges(
      {
        clientId: 'client-1',
        billingPeriod: PERIOD,
        clientContractLine: line(),
        timing: timing(),
        client: CLIENT,
        contractLineDetails: { contract_line_type: 'Fixed', custom_rate: 50000 },
        effectiveCustomRate: null,
        customRateSource: null,
        planServices: [
          {
            service_id: 'svc-a',
            service_name: 'Service A',
            default_rate: 10000,
            tax_rate_id: 'tax-1',
            config_id: 'cfg-a',
            configuration_quantity: 1,
            service_base_rate: null,
          },
          {
            service_id: 'svc-b',
            service_name: 'Service B',
            default_rate: 30000,
            tax_rate_id: 'tax-1',
            config_id: 'cfg-b',
            configuration_quantity: 1,
            service_base_rate: null,
          },
        ],
        fallbackService: null,
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges.map((c) => c.total)).toEqual([12500, 37500]);
    expect(result.charges.map((c) => c.proportion)).toEqual([0.25, 0.75]);
    expect(
      result.explanations.every((e) => e.markers.includes('fmv_allocation')),
    ).toBe(true);
  });

  it('prorates by coverage ratio when proration is enabled', async () => {
    const coverageRatio = 22 / 31;
    const result = await computeFixedCharges(
      {
        clientId: 'client-1',
        billingPeriod: PERIOD,
        clientContractLine: line(),
        timing: timing({ coverageRatio }),
        client: CLIENT,
        contractLineDetails: {
          contract_line_type: 'Fixed',
          custom_rate: 240000,
          enable_proration: true,
        },
        effectiveCustomRate: null,
        customRateSource: null,
        planServices: [
          {
            service_id: 'svc-1',
            service_name: 'Managed workstations',
            default_rate: 240000,
            tax_rate_id: 'tax-1',
            config_id: 'cfg-1',
            configuration_quantity: 1,
            service_base_rate: null,
          },
        ],
        fallbackService: null,
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].total).toBe(Math.round(240000 * coverageRatio));
    expect(result.explanations[0].markers).toContain('proration');
  });

  it('suppresses advance billing for a line that ended before the service period', async () => {
    const result = await computeFixedCharges(
      {
        clientId: 'client-1',
        billingPeriod: PERIOD,
        clientContractLine: line({
          billing_timing: 'advance',
          end_date: '2026-07-15',
        }),
        timing: timing({ duePosition: 'advance' }),
        client: CLIENT,
        contractLineDetails: { contract_line_type: 'Fixed', custom_rate: 240000 },
        effectiveCustomRate: null,
        customRateSource: null,
        planServices: [
          {
            service_id: 'svc-1',
            service_name: 'Managed workstations',
            default_rate: 240000,
            tax_rate_id: 'tax-1',
            config_id: 'cfg-1',
            configuration_quantity: 1,
            service_base_rate: null,
          },
        ],
        fallbackService: null,
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges).toHaveLength(0);
    expect(result.advanceGuard).toBeNull();
  });

  it('flags a persisted-charge guard for live advance periods', async () => {
    const result = await computeFixedCharges(
      {
        clientId: 'client-1',
        billingPeriod: PERIOD,
        clientContractLine: line({ billing_timing: 'advance' }),
        timing: timing({ duePosition: 'advance' }),
        client: CLIENT,
        contractLineDetails: { contract_line_type: 'Fixed', custom_rate: 240000 },
        effectiveCustomRate: null,
        customRateSource: null,
        planServices: [
          {
            service_id: 'svc-1',
            service_name: 'Managed workstations',
            default_rate: 240000,
            tax_rate_id: 'tax-1',
            config_id: 'cfg-1',
            configuration_quantity: 1,
            service_base_rate: null,
          },
        ],
        fallbackService: null,
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges).toHaveLength(1);
    expect(result.advanceGuard).toEqual({
      servicePeriodStart: '2026-08-01',
      servicePeriodEnd: '2026-08-31',
    });
  });
});

describe('computeTimeBasedCharges', () => {
  const HOURLY_CONFIG = {
    config: {
      config_id: 'cfg-h',
      hourly_rate: 15000,
      minimum_billable_time: 0,
      round_up_to_nearest: 0,
    },
    userTypeRates: new Map<string, number>(),
  };

  function timeInputs(overrides: {
    serviceConfigMap?: Map<string, typeof HOURLY_CONFIG>;
    timeEntries?: any[];
    plan?: { enable_overtime?: boolean; overtime_threshold?: number; overtime_rate?: number };
  }) {
    return {
      billingPeriod: PERIOD,
      clientContractLine: line({ contract_line_type: 'Hourly' }),
      timing: timing(),
      client: CLIENT,
      plan: overrides.plan ?? {},
      serviceConfigMap: overrides.serviceConfigMap ?? new Map([[
        'svc-h',
        HOURLY_CONFIG,
      ]]),
      timeEntries: overrides.timeEntries ?? [],
      contractCurrency: 'USD',
    };
  }

  function entry(overrides: Record<string, unknown> = {}) {
    return {
      entry_id: 'entry-1',
      user_id: 'user-1',
      user_type: 'technician',
      start_time: new Date('2026-08-05T10:00:00Z'),
      end_time: new Date('2026-08-05T12:00:00Z'),
      service_id: 'svc-h',
      service_name: 'Remote support',
      tax_rate_id: 'tax-1',
      custom_rate: null,
      currency_rate: 15000,
      ...overrides,
    };
  }

  it('bills duration times the currency rate', async () => {
    const result = await computeTimeBasedCharges(
      timeInputs({ timeEntries: [entry()] }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges).toHaveLength(1);
    expect(result.charges[0].duration).toBe(2);
    expect(result.charges[0].rate).toBe(15000);
    expect(result.charges[0].total).toBe(30000);
    expect(result.charges[0].tax_amount).toBe(3000);
  });

  it('applies minimum billable time and round-up increments', async () => {
    const config = {
      config: { ...HOURLY_CONFIG.config, minimum_billable_time: 30, round_up_to_nearest: 15 },
      userTypeRates: new Map<string, number>(),
    };
    const result = await computeTimeBasedCharges(
      timeInputs({
        serviceConfigMap: new Map([['svc-h', config]]),
        timeEntries: [
          entry({
            // 70 minutes -> round up to 75 -> 1.25 hrs
            end_time: new Date('2026-08-05T11:10:00Z'),
          }),
        ],
      }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].duration).toBe(1.25);
    expect(result.charges[0].total).toBe(Math.round(1.25 * 15000));
    expect(result.explanations[0].markers).toContain('rounding_applied');
  });

  it('prefers user-type rates over the currency price and entry custom rates over both', async () => {
    const config = {
      config: { ...HOURLY_CONFIG.config },
      userTypeRates: new Map([['technician', 18000]]),
    };
    const byUserType = await computeTimeBasedCharges(
      timeInputs({
        serviceConfigMap: new Map([['svc-h', config]]),
        timeEntries: [entry()],
      }),
      TEN_PERCENT_PORTS,
    );
    expect(byUserType.charges[0].rate).toBe(18000);

    const byCustomRate = await computeTimeBasedCharges(
      timeInputs({
        serviceConfigMap: new Map([['svc-h', config]]),
        timeEntries: [entry({ custom_rate: 20000 })],
      }),
      TEN_PERCENT_PORTS,
    );
    expect(byCustomRate.charges[0].rate).toBe(20000);
  });

  it('splits hours over the overtime threshold at the overtime rate', async () => {
    const result = await computeTimeBasedCharges(
      timeInputs({
        plan: { enable_overtime: true, overtime_threshold: 1, overtime_rate: 22500 },
        timeEntries: [entry()],
      }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].total).toBe(Math.round(1 * 15000 + 1 * 22500));
    expect(result.explanations[0].markers).toContain('overtime');
  });

  it('throws when no rate can be resolved', async () => {
    await expect(
      computeTimeBasedCharges(
        timeInputs({ timeEntries: [entry({ currency_rate: null })] }),
        TEN_PERCENT_PORTS,
      ),
    ).rejects.toThrow(/Missing pricing for time entry/);
  });
});

describe('computeUsageBasedCharges', () => {
  const USAGE_CONFIG = {
    config: {
      config_id: 'cfg-u',
      custom_rate: 250,
      minimum_usage: 0,
      enable_tiered_pricing: false,
    },
    rateTiers: [] as Array<{
      min_quantity: number;
      max_quantity: number | null;
      rate: number;
    }>,
  };

  function usageInputs(overrides: {
    serviceConfigMap?: Map<string, typeof USAGE_CONFIG>;
    usageRecords?: any[];
    clientContractLine?: IClientContractLine;
  } = {}) {
    return {
      billingPeriod: PERIOD,
      clientContractLine:
        overrides.clientContractLine ?? line({ contract_line_type: 'Usage' }),
      timing: timing(),
      client: CLIENT,
      serviceConfigMap:
        overrides.serviceConfigMap ?? new Map([['svc-u', USAGE_CONFIG]]),
      usageRecords: overrides.usageRecords ?? [usageRecord()],
      contractCurrency: 'USD',
    };
  }

  function usageRecord(overrides: Record<string, unknown> = {}) {
    return {
      usage_id: 'usage-1',
      service_id: 'svc-u',
      service_name: 'Managed endpoints',
      quantity: 10,
      tax_rate_id: 'tax-1',
      currency_rate: 300,
      ...overrides,
    };
  }

  it('prefers the configured custom rate and emits an arithmetic explanation', async () => {
    const result = await computeUsageBasedCharges(
      usageInputs(),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0]).toMatchObject({
      quantity: 10,
      rate: 250,
      total: 2500,
      tax_amount: 250,
    });
    expect(result.explanations[0].steps.at(-1)).toContain('$25.00');
  });

  it('applies minimum usage before flat-rate pricing', async () => {
    const config = {
      ...USAGE_CONFIG,
      config: { ...USAGE_CONFIG.config, minimum_usage: 25 },
    };
    const result = await computeUsageBasedCharges(
      usageInputs({ serviceConfigMap: new Map([['svc-u', config]]) }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].quantity).toBe(25);
    expect(result.charges[0].total).toBe(6250);
    expect(result.explanations[0].markers).toContain('minimum_applied');
  });

  it('prices progressively across configured tiers', async () => {
    const config = {
      config: {
        ...USAGE_CONFIG.config,
        custom_rate: null,
        enable_tiered_pricing: true,
      },
      rateTiers: [
        { min_quantity: 1, max_quantity: 10, rate: 100 },
        { min_quantity: 11, max_quantity: null, rate: 75 },
      ],
    };
    const result = await computeUsageBasedCharges(
      usageInputs({
        serviceConfigMap: new Map([['svc-u', config]]),
        usageRecords: [usageRecord({ quantity: 15, currency_rate: null })],
      }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].total).toBe(1375);
    expect(result.explanations[0].markers).toContain('rate_tier');
    expect(result.explanations[0].steps).toHaveLength(3);
  });

  it('uses currency pricing and ignores authored overrides for a system-managed default line', async () => {
    const result = await computeUsageBasedCharges(
      usageInputs({
        clientContractLine: line({
          contract_line_type: 'Usage',
          is_system_managed_default: true,
        }),
      }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].rate).toBe(300);
    expect(result.charges[0].total).toBe(3000);
  });

  it('throws when neither a currency rate nor tier pricing can resolve an amount', async () => {
    const config = {
      ...USAGE_CONFIG,
      config: { ...USAGE_CONFIG.config, custom_rate: null },
    };
    await expect(
      computeUsageBasedCharges(
        usageInputs({
          serviceConfigMap: new Map([['svc-u', config]]),
          usageRecords: [usageRecord({ currency_rate: null })],
        }),
        TEN_PERCENT_PORTS,
      ),
    ).rejects.toThrow(/Missing pricing for usage/);
  });
});
