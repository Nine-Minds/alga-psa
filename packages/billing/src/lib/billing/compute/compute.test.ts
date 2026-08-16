import { describe, expect, it } from "vitest";
import type { IBillingResult, IClientContractLine } from "@alga-psa/types";
import { computeFixedCharges } from "./computeFixedCharges";
import { computeTimeBasedCharges } from "./computeTimeBasedCharges";
import {
  computeUsageBasedCharges,
  type UsageServiceConfigEntry,
} from "./computeUsageBasedCharges";
import {
  computeBucketCharges,
  computeBucketPeriodState,
} from "./computeBucketCharges";
import { computeRecurringQuantityCharges } from "./computeRecurringQuantityCharges";
import { computeDiscountsAndAdjustments } from "./computeDiscountsAndAdjustments";
import type { ChargeComputeTaxPorts, ChargeComputeTiming } from "./types";

const TEN_PERCENT_PORTS: ChargeComputeTaxPorts = {
  getTaxInfoFromService: (service) => ({
    taxRegion: service.tax_rate_id ? "US-TEST" : null,
    isTaxable: Boolean(service.tax_rate_id),
  }),
  getLocationTaxRegionCode: () => null,
  getClientDefaultTaxRegionCode: () => "US-TEST",
  // No profile dimension in these fixtures: the client-level answer applies,
  // which is exactly what a single-profile client gets in production.
  isTaxExemptForProfile: () => false,
  calculateTax: (_clientId, netAmountInCents) => ({
    taxRate: 10,
    taxAmount: Math.round(netAmountInCents * 0.1),
  }),
};

const PERIOD = { startDate: "2026-08-01", endDate: "2026-09-01" };

function timing(
  overrides: Partial<ChargeComputeTiming> = {},
): ChargeComputeTiming {
  return {
    duePosition: "arrears",
    servicePeriodStart: "2026-08-01",
    servicePeriodEnd: "2026-08-31",
    servicePeriodStartExclusive: "2026-08-01",
    servicePeriodEndExclusive: "2026-09-01",
    coverageRatio: 1,
    ...overrides,
  };
}

function line(
  overrides: Partial<IClientContractLine> = {},
): IClientContractLine {
  return {
    client_contract_line_id: "ccl-1",
    client_id: "client-1",
    contract_line_id: "cl-1",
    start_date: "2026-01-01",
    end_date: null,
    is_active: true,
    currency_code: "USD",
    contract_line_name: "Managed services",
    contract_line_type: "Fixed",
    billing_timing: "arrears",
    ...overrides,
  };
}

const CLIENT = { client_id: "client-1", is_tax_exempt: false };

describe("computeFixedCharges", () => {
  it("bills the full plan rate for a single-service fixed plan", async () => {
    const result = await computeFixedCharges(
      {
        clientId: "client-1",
        billingPeriod: PERIOD,
        clientContractLine: line(),
        timing: timing(),
        client: CLIENT,
        contractLineDetails: {
          contract_line_type: "Fixed",
          custom_rate: 240000,
        },
        effectiveCustomRate: null,
        customRateSource: null,
        planServices: [
          {
            service_id: "svc-1",
            service_name: "Managed workstations",
            default_rate: 240000,
            tax_rate_id: "tax-1",
            config_id: "cfg-1",
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
    expect(result.explanations[0].steps.at(-1)).toContain("$2,400.00");
  });

  it("allocates the plan fee across services by FMV proportion", async () => {
    const result = await computeFixedCharges(
      {
        clientId: "client-1",
        billingPeriod: PERIOD,
        clientContractLine: line(),
        timing: timing(),
        client: CLIENT,
        contractLineDetails: {
          contract_line_type: "Fixed",
          custom_rate: 50000,
        },
        effectiveCustomRate: null,
        customRateSource: null,
        planServices: [
          {
            service_id: "svc-a",
            service_name: "Service A",
            default_rate: 10000,
            tax_rate_id: "tax-1",
            config_id: "cfg-a",
            configuration_quantity: 1,
            service_base_rate: null,
          },
          {
            service_id: "svc-b",
            service_name: "Service B",
            default_rate: 30000,
            tax_rate_id: "tax-1",
            config_id: "cfg-b",
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
      result.explanations.every((e) => e.markers.includes("fmv_allocation")),
    ).toBe(true);
  });

  it("prorates by coverage ratio when proration is enabled", async () => {
    const coverageRatio = 22 / 31;
    const result = await computeFixedCharges(
      {
        clientId: "client-1",
        billingPeriod: PERIOD,
        clientContractLine: line(),
        timing: timing({ coverageRatio }),
        client: CLIENT,
        contractLineDetails: {
          contract_line_type: "Fixed",
          custom_rate: 240000,
          enable_proration: true,
        },
        effectiveCustomRate: null,
        customRateSource: null,
        planServices: [
          {
            service_id: "svc-1",
            service_name: "Managed workstations",
            default_rate: 240000,
            tax_rate_id: "tax-1",
            config_id: "cfg-1",
            configuration_quantity: 1,
            service_base_rate: null,
          },
        ],
        fallbackService: null,
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].total).toBe(Math.round(240000 * coverageRatio));
    expect(result.explanations[0].markers).toContain("proration");
  });

  it("suppresses advance billing for a line that ended before the service period", async () => {
    const result = await computeFixedCharges(
      {
        clientId: "client-1",
        billingPeriod: PERIOD,
        clientContractLine: line({
          billing_timing: "advance",
          end_date: "2026-07-15",
        }),
        timing: timing({ duePosition: "advance" }),
        client: CLIENT,
        contractLineDetails: {
          contract_line_type: "Fixed",
          custom_rate: 240000,
        },
        effectiveCustomRate: null,
        customRateSource: null,
        planServices: [
          {
            service_id: "svc-1",
            service_name: "Managed workstations",
            default_rate: 240000,
            tax_rate_id: "tax-1",
            config_id: "cfg-1",
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

  it("flags a persisted-charge guard for live advance periods", async () => {
    const result = await computeFixedCharges(
      {
        clientId: "client-1",
        billingPeriod: PERIOD,
        clientContractLine: line({ billing_timing: "advance" }),
        timing: timing({ duePosition: "advance" }),
        client: CLIENT,
        contractLineDetails: {
          contract_line_type: "Fixed",
          custom_rate: 240000,
        },
        effectiveCustomRate: null,
        customRateSource: null,
        planServices: [
          {
            service_id: "svc-1",
            service_name: "Managed workstations",
            default_rate: 240000,
            tax_rate_id: "tax-1",
            config_id: "cfg-1",
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
      servicePeriodStart: "2026-08-01",
      servicePeriodEnd: "2026-08-31",
    });
  });
});

describe("computeTimeBasedCharges", () => {
  const HOURLY_CONFIG = {
    config: {
      config_id: "cfg-h",
      hourly_rate: 15000,
      minimum_billable_time: 0,
      round_up_to_nearest: 0,
    },
    userTypeRates: new Map<string, number>(),
  };

  function timeInputs(overrides: {
    serviceConfigMap?: Map<string, typeof HOURLY_CONFIG>;
    timeEntries?: any[];
    plan?: {
      enable_overtime?: boolean;
      overtime_threshold?: number;
      overtime_rate?: number;
    };
  }) {
    return {
      billingPeriod: PERIOD,
      clientContractLine: line({ contract_line_type: "Hourly" }),
      timing: timing(),
      client: CLIENT,
      plan: overrides.plan ?? {},
      serviceConfigMap:
        overrides.serviceConfigMap ?? new Map([["svc-h", HOURLY_CONFIG]]),
      timeEntries: overrides.timeEntries ?? [],
      contractCurrency: "USD",
    };
  }

  function entry(overrides: Record<string, unknown> = {}) {
    return {
      entry_id: "entry-1",
      user_id: "user-1",
      user_type: "technician",
      start_time: new Date("2026-08-05T10:00:00Z"),
      end_time: new Date("2026-08-05T12:00:00Z"),
      service_id: "svc-h",
      service_name: "Remote support",
      tax_rate_id: "tax-1",
      custom_rate: null,
      currency_rate: 15000,
      billable_duration: 120,
      ...overrides,
    };
  }

  it("bills duration times the currency rate", async () => {
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

  it("applies minimum billable time and round-up increments", async () => {
    const config = {
      config: {
        ...HOURLY_CONFIG.config,
        minimum_billable_time: 30,
        round_up_to_nearest: 15,
      },
      userTypeRates: new Map<string, number>(),
    };
    const result = await computeTimeBasedCharges(
      timeInputs({
        serviceConfigMap: new Map([["svc-h", config]]),
        timeEntries: [
          entry({
            // 70 billable minutes -> round up to 75 -> 1.25 hrs
            end_time: new Date("2026-08-05T11:10:00Z"),
            billable_duration: 70,
          }),
        ],
      }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].duration).toBe(1.25);
    expect(result.charges[0].total).toBe(Math.round(1.25 * 15000));
    expect(result.explanations[0].markers).toContain("rounding_applied");
  });

  it("uses billable minutes, not elapsed start/end time, as the charge quantity", async () => {
    const result = await computeTimeBasedCharges(
      timeInputs({
        timeEntries: [
          entry({
            // Elapsed span is 2 hours but only 45 minutes are billable.
            billable_duration: 45,
          }),
        ],
      }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].duration).toBe(0.75);
    expect(result.charges[0].total).toBe(Math.round(0.75 * 15000));
  });

  it("prefers user-type rates over the currency price and entry custom rates over both", async () => {
    const config = {
      config: { ...HOURLY_CONFIG.config },
      userTypeRates: new Map([["technician", 18000]]),
    };
    const byUserType = await computeTimeBasedCharges(
      timeInputs({
        serviceConfigMap: new Map([["svc-h", config]]),
        timeEntries: [entry()],
      }),
      TEN_PERCENT_PORTS,
    );
    expect(byUserType.charges[0].rate).toBe(18000);

    const byCustomRate = await computeTimeBasedCharges(
      timeInputs({
        serviceConfigMap: new Map([["svc-h", config]]),
        timeEntries: [entry({ custom_rate: 20000 })],
      }),
      TEN_PERCENT_PORTS,
    );
    expect(byCustomRate.charges[0].rate).toBe(20000);
  });

  it("splits hours over the overtime threshold at the overtime rate", async () => {
    const result = await computeTimeBasedCharges(
      timeInputs({
        plan: {
          enable_overtime: true,
          overtime_threshold: 1,
          overtime_rate: 22500,
        },
        timeEntries: [entry()],
      }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].total).toBe(Math.round(1 * 15000 + 1 * 22500));
    expect(result.explanations[0].markers).toContain("overtime");
  });

  it("throws when no rate can be resolved", async () => {
    expect(() =>
      computeTimeBasedCharges(
        timeInputs({ timeEntries: [entry({ currency_rate: null })] }),
        TEN_PERCENT_PORTS,
      ),
    ).toThrow(/Missing pricing for time entry/);
  });
});

describe("computeUsageBasedCharges", () => {
  const USAGE_CONFIG: UsageServiceConfigEntry = {
    config: {
      config_id: "cfg-u",
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

  function usageInputs(
    overrides: {
      serviceConfigMap?: Map<string, UsageServiceConfigEntry>;
      usageRecords?: any[];
      clientContractLine?: IClientContractLine;
    } = {},
  ) {
    return {
      billingPeriod: PERIOD,
      clientContractLine:
        overrides.clientContractLine ?? line({ contract_line_type: "Usage" }),
      timing: timing(),
      client: CLIENT,
      serviceConfigMap:
        overrides.serviceConfigMap ?? new Map([["svc-u", USAGE_CONFIG]]),
      usageRecords: overrides.usageRecords ?? [usageRecord()],
      contractCurrency: "USD",
    };
  }

  function usageRecord(overrides: Record<string, unknown> = {}) {
    return {
      usage_id: "usage-1",
      service_id: "svc-u",
      service_name: "Managed endpoints",
      quantity: 10,
      tax_rate_id: "tax-1",
      currency_rate: 300,
      ...overrides,
    };
  }

  it("prefers the configured custom rate and emits an arithmetic explanation", async () => {
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
    expect(result.explanations[0].steps.at(-1)).toContain("$25.00");
  });

  it("applies minimum usage before flat-rate pricing", async () => {
    const config = {
      ...USAGE_CONFIG,
      config: { ...USAGE_CONFIG.config, minimum_usage: 25 },
    };
    const result = await computeUsageBasedCharges(
      usageInputs({ serviceConfigMap: new Map([["svc-u", config]]) }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].quantity).toBe(25);
    expect(result.charges[0].total).toBe(6250);
    expect(result.explanations[0].markers).toContain("minimum_applied");
  });

  it("prices progressively across configured tiers", async () => {
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
        serviceConfigMap: new Map([["svc-u", config]]),
        usageRecords: [usageRecord({ quantity: 15, currency_rate: null })],
      }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].total).toBe(1375);
    expect(result.explanations[0].markers).toContain("rate_tier");
    expect(result.explanations[0].steps).toHaveLength(3);
  });

  it("uses currency pricing and ignores authored overrides for a system-managed default line", async () => {
    const result = await computeUsageBasedCharges(
      usageInputs({
        clientContractLine: line({
          contract_line_type: "Usage",
          is_system_managed_default: true,
        }),
      }),
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0].rate).toBe(300);
    expect(result.charges[0].total).toBe(3000);
  });

  it("throws when neither a currency rate nor tier pricing can resolve an amount", async () => {
    const config = {
      ...USAGE_CONFIG,
      config: { ...USAGE_CONFIG.config, custom_rate: null },
    };
    expect(() =>
      computeUsageBasedCharges(
        usageInputs({
          serviceConfigMap: new Map([["svc-u", config]]),
          usageRecords: [usageRecord({ currency_rate: null })],
        }),
        TEN_PERCENT_PORTS,
      ),
    ).toThrow(/Missing pricing for usage/);
  });
});

describe("computeBucketCharges", () => {
  it("threads one-period rollover through a deterministic state chain", () => {
    const first = computeBucketPeriodState({
      includedQuantity: 600,
      consumedQuantity: 360,
      allowRollover: true,
    });
    const second = computeBucketPeriodState({
      includedQuantity: 600,
      consumedQuantity: 900,
      allowRollover: true,
      previousState: first,
    });
    const third = computeBucketPeriodState({
      includedQuantity: 600,
      consumedQuantity: 660,
      allowRollover: true,
      previousState: second,
    });

    expect(first).toMatchObject({ rolledOverQuantity: 0, overageQuantity: 0 });
    expect(second).toMatchObject({
      rolledOverQuantity: 240,
      availableQuantity: 840,
      overageQuantity: 60,
    });
    // Rollover uses unused base allowance only; period two exhausted its base,
    // so period one's carried allowance does not compound into period three.
    expect(third).toMatchObject({
      rolledOverQuantity: 0,
      availableQuantity: 600,
      overageQuantity: 60,
    });
  });

  it("prices time-bucket overage in hours and explains allowance plus rollover", async () => {
    const result = await computeBucketCharges(
      {
        billingPeriod: PERIOD,
        clientContractLine: line({ contract_line_type: "Hourly" }),
        client: CLIENT,
        config: {
          config_id: "cfg-b",
          service_id: "svc-b",
          service_name: "Support bucket",
          tax_rate_id: "tax-1",
          total_minutes: 600,
          overage_rate: 15000,
          allow_rollover: true,
        },
        usageRecords: [
          {
            period_start: "2026-08-01",
            period_end: "2026-08-31",
            minutes_used: 900,
            rolled_over_minutes: 120,
            // Persisted zero must not trigger the old base-only fallback; the
            // shared state derives overage from base + rollover.
            overage_minutes: 0,
          },
        ],
        contractCurrency: "USD",
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0]).toMatchObject({
      hoursUsed: 15,
      overageHours: 3,
      rate: 15000,
      total: 45000,
      tax_amount: 4500,
    });
    expect(result.explanations[0].markers).toContain("bucket_overage");
    expect(result.explanations[0].steps[0]).toContain("15 − (10 + 2) = 3 hrs");
  });

  it("prices usage buckets in catalog units rather than converting to hours", async () => {
    const result = await computeBucketCharges(
      {
        billingPeriod: PERIOD,
        clientContractLine: line({ contract_line_type: "Usage" }),
        client: CLIENT,
        config: {
          config_id: "cfg-bu",
          service_id: "svc-bu",
          service_name: "Transfer bucket",
          unit_of_measure: "GB",
          billing_method: "usage",
          total_minutes: 1000,
          overage_rate: 20,
        },
        usageRecords: [
          {
            period_start: "2026-08-01",
            period_end: "2026-08-31",
            minutes_used: 1250,
          },
        ],
        contractCurrency: "USD",
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0]).toMatchObject({
      isUsageBucket: true,
      unitOfMeasure: "GB",
      unitsUsed: 1250,
      includedUnits: 1000,
      overageUnits: 250,
      quantity: 250,
      total: 5000,
    });
  });

  it("emits no charge when allowance and rollover cover consumption", async () => {
    const result = await computeBucketCharges(
      {
        billingPeriod: PERIOD,
        clientContractLine: line({ contract_line_type: "Hourly" }),
        client: CLIENT,
        config: {
          config_id: "cfg-b",
          service_id: "svc-b",
          service_name: "Support bucket",
          total_minutes: 600,
          overage_rate: 15000,
          allow_rollover: true,
        },
        usageRecords: [
          {
            period_start: "2026-08-01",
            period_end: "2026-08-31",
            minutes_used: 700,
            rolled_over_minutes: 120,
          },
        ],
        contractCurrency: "USD",
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges).toEqual([]);
    expect(result.states[0]).toMatchObject({
      availableQuantity: 720,
      consumedQuantity: 700,
      overageQuantity: 0,
    });
  });
});

describe("computeRecurringQuantityCharges", () => {
  const service = {
    service_id: "product-1",
    service_name: "Managed Endpoint",
    default_rate: 2900,
    tax_rate_id: "tax-1",
    config_id: "cfg-product-1",
    service_quantity: 7,
    service_line_custom_rate: null,
    configuration_quantity: 2,
    configuration_custom_rate: null,
    price_rate: 3100,
  };

  it("prices recurring products from configuration quantity and currency catalog rate", async () => {
    const result = await computeRecurringQuantityCharges(
      {
        clientContractLine: line({ contract_line_type: "Fixed" }),
        client: CLIENT,
        timing: timing(),
        chargeType: "product",
        services: [service],
        contractCurrency: "USD",
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0]).toMatchObject({
      type: "product",
      quantity: 2,
      rate: 3100,
      total: 6200,
      tax_amount: 620,
    });
    expect(result.explanations[0].inputs).toContainEqual({
      label: "Rate source",
      value: "currency catalog price",
    });
  });

  it("preserves configuration then service override precedence", async () => {
    const configurationOverride = await computeRecurringQuantityCharges(
      {
        clientContractLine: line(),
        client: CLIENT,
        timing: timing(),
        chargeType: "product",
        services: [
          {
            ...service,
            configuration_custom_rate: 4500,
            service_line_custom_rate: 4200,
          },
        ],
        contractCurrency: "USD",
      },
      TEN_PERCENT_PORTS,
    );
    expect(configurationOverride.charges[0]).toMatchObject({
      rate: 4500,
      total: 9000,
    });

    const serviceOverride = await computeRecurringQuantityCharges(
      {
        clientContractLine: line(),
        client: CLIENT,
        timing: timing(),
        chargeType: "product",
        services: [
          {
            ...service,
            configuration_custom_rate: null,
            service_line_custom_rate: 4200,
          },
        ],
        contractCurrency: "USD",
      },
      TEN_PERCENT_PORTS,
    );
    expect(serviceOverride.charges[0].rate).toBe(4200);
  });

  it("prorates product rate, total, and tax with production rounding", async () => {
    const result = await computeRecurringQuantityCharges(
      {
        clientContractLine: line({ enable_proration: true }),
        client: CLIENT,
        timing: timing({ coverageRatio: 22 / 31 }),
        chargeType: "product",
        services: [service],
        contractCurrency: "USD",
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0]).toMatchObject({
      rate: 2200,
      total: 4400,
      tax_amount: 440,
    });
    expect(result.explanations[0].markers).toContain("proration");
  });

  it("emits license period metadata and classification", async () => {
    const result = await computeRecurringQuantityCharges(
      {
        clientContractLine: line(),
        client: CLIENT,
        timing: timing(),
        chargeType: "license",
        services: [{ ...service, tax_rate_id: null }],
        contractCurrency: "USD",
      },
      TEN_PERCENT_PORTS,
    );

    expect(result.charges[0]).toMatchObject({
      type: "license",
      period_start: "2026-08-01",
      period_end: "2026-08-31",
    });
  });

  it("rejects a legacy default rate without a currency price or override", async () => {
    expect(() =>
      computeRecurringQuantityCharges(
        {
          clientContractLine: line(),
          client: CLIENT,
          timing: timing(),
          chargeType: "product",
          services: [
            {
              ...service,
              price_rate: null,
              configuration_custom_rate: null,
              service_line_custom_rate: null,
            },
          ],
          contractCurrency: "USD",
        },
        TEN_PERCENT_PORTS,
      ),
    ).toThrow(/Missing pricing for product/);
  });
});

describe("computeDiscountsAndAdjustments", () => {
  function billingResult(): IBillingResult {
    return {
      charges: [
        {
          type: "fixed",
          client_contract_line_id: "line-a",
          serviceId: "svc-a",
          serviceName: "Managed service",
          quantity: 1,
          rate: 10000,
          total: 10000,
          tax_amount: 0,
          tax_rate: 0,
          servicePeriodStart: "2026-07-01",
          servicePeriodEnd: "2026-07-31",
        },
      ],
      totalAmount: 10000,
      discounts: [],
      adjustments: [],
      finalAmount: 10000,
      currency_code: "USD",
    };
  }

  it("applies percentage then fixed discounts and explicit adjustments in order", () => {
    const result = computeDiscountsAndAdjustments({
      billingResult: billingResult(),
      billingPeriod: PERIOD,
      discountCandidates: [
        {
          discount_id: "pct",
          discount_name: "Ten percent",
          discount_type: "percentage",
          value: 0.1,
          start_date: "2026-01-01",
        },
        {
          discount_id: "fixed",
          discount_name: "Loyalty credit",
          discount_type: "fixed",
          value: 500,
          start_date: "2026-01-01",
        },
      ],
      adjustments: [{ description: "Manual credit", amount: -250 }],
    });

    expect(
      result.billingResult.discounts.map((discount) => discount.amount),
    ).toEqual([1000, 500]);
    expect(result.billingResult.finalAmount).toBe(8250);
    expect(
      result.explanations.map((explanation) => explanation.chargeType),
    ).toEqual(["discount", "discount", "adjustment"]);
  });

  it("evaluates line discounts against canonical service periods and deduplicates links", () => {
    const result = computeDiscountsAndAdjustments({
      billingResult: billingResult(),
      billingPeriod: PERIOD,
      discountCandidates: [
        {
          discount_id: "july",
          discount_name: "July service discount",
          discount_type: "fixed",
          value: 700,
          contract_line_id: "line-a",
          start_date: "2026-07-01",
          end_date: "2026-08-01",
        },
        {
          discount_id: "july",
          discount_name: "July service discount",
          discount_type: "fixed",
          value: 700,
          contract_line_id: "line-a",
          start_date: "2026-07-01",
          end_date: "2026-08-01",
        },
        {
          discount_id: "september",
          discount_name: "Future discount",
          discount_type: "fixed",
          value: 900,
          contract_line_id: "line-a",
          start_date: "2026-09-01",
        },
      ],
      adjustments: [],
    });

    expect(result.billingResult.discounts).toHaveLength(1);
    expect(result.billingResult.discounts[0]).toMatchObject({
      discount_id: "july",
      amount: 700,
    });
    expect(result.billingResult.finalAmount).toBe(9300);
  });
});
