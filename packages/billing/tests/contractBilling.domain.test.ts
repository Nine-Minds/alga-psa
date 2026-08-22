import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { IClientContractLine } from "@alga-psa/types";
import {
  assertLiveContractBillingResult,
  applyCanonicalLiveBillingResult,
  calculateContractBilling,
  calculateContractCharge,
  calculateContractDiscountsAndAdjustments,
  type ContractBillingCalculationInput,
  type ResolvedContractChargeObligation,
} from "../src/lib/billing/domain";
import type { ChargeComputeTaxContext } from "../src/lib/billing/compute";

const input = (mode: "simulate" | "live"): ContractBillingCalculationInput => ({
  schemaVersion: 1,
  execution: {
    mode,
    tenantId: "tenant-a",
    calculationId: "calc-1",
    asOf: "2026-08-21T00:00:00Z",
  },
  document: {
    clientId: "client-a",
    currencyCode: "USD",
    invoiceWindow: { start: "2026-08-01", endExclusive: "2026-09-01" },
  },
  obligations: [
    {
      obligationId: "fixed",
      tenantId: "tenant-a",
      chargeFamily: "fixed",
      charge: fixedObligation(mode),
    },
  ],
  discountsAndAdjustments: {
    billingPeriod: {
      tenant: "tenant-a",
      startDate: "2026-08-01",
      endDate: "2026-09-01",
    },
    discountCandidates: [],
    adjustments: [{ description: "Adjustment", amount: -100 }],
  },
});

describe("calculateContractBilling", () => {
  it("owns dispatch, proration, tax, rounding, and explanations for unpriced obligations", () => {
    const calculate = (mode: "simulate" | "live") =>
      calculateContractBilling({
        schemaVersion: 1,
        execution: {
          mode,
          tenantId: "tenant-a",
          calculationId: "unpriced-fixed",
          asOf: "2026-08-01T00:00:00Z",
        },
        document: {
          clientId: "client-a",
          currencyCode: "USD",
          invoiceWindow: { start: "2026-08-01", endExclusive: "2026-09-01" },
        },
        obligations: [
          {
            obligationId: "fixed-1",
            tenantId: "tenant-a",
            contractLineId: "ccl-1",
            chargeFamily: "fixed",
            charge: fixedObligation(mode),
          },
        ],
      });
    const simulated = calculate("simulate");
    const live = calculate("live");
    expect({ ...simulated, mode: undefined }).toEqual({
      ...live,
      mode: undefined,
    });
    expect(simulated.lines[0]).toMatchObject({
      netAmount: 5_001,
      taxAmount: 500,
      grossAmount: 5_501,
      markers: ["proration"],
    });
    expect(simulated.lines[0].lineKey).toBe(
      simulated.lines[0].explanation?.chargeKey,
    );
  });

  it("returns identical financial results for simulation and live execution", () => {
    const simulated = calculateContractBilling(input("simulate"));
    const live = calculateContractBilling(input("live"));
    expect({ ...simulated, mode: undefined }).toEqual({
      ...live,
      mode: undefined,
    });
    expect(simulated).toMatchObject({
      subtotal: 4901,
      taxTotal: 500,
      total: 5401,
    });
  });

  it("is pure and rejects tenant and window violations", () => {
    expect(() =>
      calculateContractBilling({
        ...input("simulate"),
        obligations: [
          { ...input("simulate").obligations[0], tenantId: "tenant-b" },
        ],
      }),
    ).toThrow("Cross-tenant");
    expect(() =>
      calculateContractBilling({
        ...input("simulate"),
        document: {
          ...input("simulate").document,
          invoiceWindow: { start: "2026-09-01", endExclusive: "2026-09-01" },
        },
      }),
    ).toThrow("half-open");
  });

  it("rejects a simulated document at the persistence boundary", () => {
    const simulated = calculateContractBilling(input("simulate"));
    expect(() => assertLiveContractBillingResult(simulated)).toThrow(
      "cannot enter live persistence",
    );
    const live = calculateContractBilling(input("live"));
    expect(() => assertLiveContractBillingResult(live)).not.toThrow();
  });

  it("hands canonical live totals to production without rebuilding source rows", () => {
    const source = {
      tenant: "tenant-a",
      charges: [{ type: "fixed", serviceName: "Fixed", total: 10001 }],
      totalAmount: 1,
      discounts: [],
      adjustments: [],
      finalAmount: 1,
      currency_code: "USD",
    } as never;
    const live = calculateContractBilling(input("live"));
    const handedOff = applyCanonicalLiveBillingResult(source, live);
    expect(handedOff.charges).toEqual(live.sourceCharges);
    expect(handedOff.totalAmount).toBe(5_001);
    expect(handedOff.finalAmount).toBe(live.subtotal);
    expect(() =>
      applyCanonicalLiveBillingResult(
        source,
        calculateContractBilling(input("simulate")),
      ),
    ).toThrow("cannot enter live persistence");
  });
});

const TAX_CONTEXT: ChargeComputeTaxContext = {
  getTaxInfoFromService: (service) => ({
    taxRegion: service.tax_rate_id ? "US-TEST" : null,
    isTaxable: Boolean(service.tax_rate_id),
  }),
  getLocationTaxRegionCode: () => null,
  getClientDefaultTaxRegionCode: () => "US-TEST",
  isTaxExemptForProfile: () => false,
  calculateTax: (_clientId, amount) => ({
    taxRate: 10,
    taxAmount: Math.round(amount * 0.1),
  }),
};

const CONTRACT_LINE: IClientContractLine = {
  client_contract_line_id: "ccl-1",
  client_id: "client-a",
  contract_line_id: "cl-1",
  start_date: "2026-01-01",
  end_date: null,
  is_active: true,
  currency_code: "USD",
  contract_line_name: "Shared fixed charge",
  contract_line_type: "Fixed",
  billing_timing: "arrears",
};

function fixedObligation(
  mode: "simulate" | "live",
): ResolvedContractChargeObligation {
  return {
    executionMode: mode,
    kind: "fixed",
    taxContext: TAX_CONTEXT,
    inputs: {
      clientId: "client-a",
      billingPeriod: { startDate: "2026-08-01", endDate: "2026-09-01" },
      clientContractLine: CONTRACT_LINE,
      timing: {
        duePosition: "arrears",
        servicePeriodStart: "2026-08-01",
        servicePeriodEnd: "2026-08-31",
        servicePeriodStartExclusive: "2026-08-01",
        servicePeriodEndExclusive: "2026-09-01",
        coverageRatio: 0.5,
      },
      client: { client_id: "client-a", is_tax_exempt: false },
      contractLineDetails: {
        contract_line_type: "Fixed",
        custom_rate: 10_001,
        enable_proration: true,
      },
      effectiveCustomRate: null,
      customRateSource: null,
      planServices: [
        {
          service_id: "svc-1",
          service_name: "Managed service",
          default_rate: 10_001,
          tax_rate_id: "tax-1",
          config_id: "cfg-1",
          configuration_quantity: 1,
          service_base_rate: null,
        },
      ],
      fallbackService: null,
    },
  };
}

describe("shared contract charge-family dispatcher", () => {
  it("runs the same fixed pricing, proration, rounding, tax, and explanation path in both modes", () => {
    const simulated = calculateContractCharge(
      fixedObligation("simulate") as Extract<
        ResolvedContractChargeObligation,
        { kind: "fixed" }
      >,
    );
    const live = calculateContractCharge(
      fixedObligation("live") as Extract<
        ResolvedContractChargeObligation,
        { kind: "fixed" }
      >,
    );
    expect({ ...simulated, executionMode: undefined }).toEqual({
      ...live,
      executionMode: undefined,
    });
    expect(simulated.charges[0]).toMatchObject({
      total: 5_001,
      tax_amount: 500,
    });
    expect(simulated.explanations[0].markers).toContain("proration");
  });

  it("keeps production and simulator callers from directly dispatching compute families", () => {
    const production = readFileSync(
      new URL("../src/lib/billing/billingEngine.ts", import.meta.url),
      "utf8",
    );
    const simulator = readFileSync(
      new URL(
        "../../../ee/server/src/lib/billing/simulator/simulateContractScenario.ts",
        import.meta.url,
      ),
      "utf8",
    );
    for (const source of [production, simulator]) {
      const executableSource = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(executableSource).not.toMatch(
        /\bcompute(?:Fixed|TimeBased|UsageBased|Bucket|RecurringQuantity)Charges\s*\(/,
      );
      expect(executableSource).not.toMatch(
        /\bcomputeDiscountsAndAdjustments\s*\(/,
      );
    }
    expect(simulator).not.toContain("fixedChargeExplanationKey");
    expect(simulator).not.toContain("timeChargeExplanationKey");
  });

  it("carries calculation-owned charge/explanation associations", () => {
    const result = calculateContractCharge(
      fixedObligation("simulate") as Extract<
        ResolvedContractChargeObligation,
        { kind: "fixed" }
      >,
    );
    expect(result.chargeExplanations).toHaveLength(result.charges.length);
    expect(result.chargeExplanations[0]).toEqual({
      charge: result.charges[0],
      explanation: result.explanations[0],
    });
  });

  it("returns identical hourly, usage, bucket, product, and license results in both modes", () => {
    const period = { startDate: "2026-08-01", endDate: "2026-09-01" };
    const timing = {
      duePosition: "arrears" as const,
      servicePeriodStart: "2026-08-01",
      servicePeriodEnd: "2026-08-31",
      servicePeriodStartExclusive: "2026-08-01",
      servicePeriodEndExclusive: "2026-09-01",
      coverageRatio: 0.5,
    };
    const client = { client_id: "client-a", is_tax_exempt: false };
    const obligations: ResolvedContractChargeObligation[] = [
      {
        kind: "hourly",
        executionMode: "simulate",
        taxContext: TAX_CONTEXT,
        inputs: {
          billingPeriod: period,
          clientContractLine: {
            ...CONTRACT_LINE,
            contract_line_type: "Hourly",
          },
          timing,
          client,
          plan: {},
          serviceConfigMap: new Map([
            [
              "svc-hourly",
              {
                config: {
                  config_id: "cfg-hourly",
                  hourly_rate: 5_000,
                  minimum_billable_time: 15,
                  round_up_to_nearest: 15,
                },
                userTypeRates: new Map<string, number>(),
              },
            ],
          ]),
          timeEntries: [
            {
              entry_id: "entry-1",
              user_id: "user-1",
              user_type: "technician",
              start_time: new Date("2026-08-05T10:00:00Z"),
              end_time: new Date("2026-08-05T11:07:00Z"),
              service_id: "svc-hourly",
              service_name: "Engineering",
              tax_rate_id: "tax-1",
              custom_rate: null,
              currency_rate: 5_000,
              billable_duration: 67,
            },
          ],
          contractCurrency: "USD",
        },
      },
      {
        kind: "usage",
        executionMode: "simulate",
        taxContext: TAX_CONTEXT,
        inputs: {
          billingPeriod: period,
          clientContractLine: { ...CONTRACT_LINE, contract_line_type: "Usage" },
          timing,
          client,
          serviceConfigMap: new Map([
            [
              "svc-usage",
              {
                config: {
                  config_id: "cfg-usage",
                  custom_rate: 200,
                  minimum_usage: 2,
                  enable_tiered_pricing: true,
                },
                rateTiers: [
                  { min_quantity: 0, max_quantity: 10, rate: 200 },
                  { min_quantity: 10, max_quantity: null, rate: 150 },
                ],
              },
            ],
          ]),
          usageRecords: [
            {
              usage_id: "usage-1",
              service_id: "svc-usage",
              service_name: "Backup",
              quantity: 12,
              tax_rate_id: "tax-1",
              currency_rate: 200,
            },
          ],
          contractCurrency: "USD",
        },
      },
      {
        kind: "bucket",
        executionMode: "simulate",
        taxContext: TAX_CONTEXT,
        inputs: {
          billingPeriod: period,
          clientContractLine: {
            ...CONTRACT_LINE,
            contract_line_type: "Hourly",
          },
          client,
          config: {
            config_id: "cfg-bucket",
            service_id: "svc-bucket",
            service_name: "Support bucket",
            tax_rate_id: "tax-1",
            total_minutes: 60,
            overage_rate: 1_000,
            allow_rollover: true,
          },
          usageRecords: [
            {
              period_start: "2026-08-01",
              period_end: "2026-08-31",
              minutes_used: 180,
            },
          ],
          contractCurrency: "USD",
        },
      },
      ...(["product", "license"] as const).map((kind) => ({
        kind,
        executionMode: "simulate" as const,
        taxContext: TAX_CONTEXT,
        inputs: {
          clientContractLine: CONTRACT_LINE,
          client,
          timing,
          chargeType: kind,
          services: [
            {
              service_id: `svc-${kind}`,
              service_name: kind,
              default_rate: 1_000,
              tax_rate_id: "tax-1",
              config_id: `cfg-${kind}`,
              service_quantity: 3,
              service_line_custom_rate: null,
              configuration_quantity: 3,
              configuration_custom_rate: null,
              price_rate: 1_000,
            },
          ],
          contractCurrency: "USD",
        },
      })),
    ];

    for (const simulatedObligation of obligations) {
      const simulated = calculateContractCharge(simulatedObligation as never);
      const live = calculateContractCharge({
        ...simulatedObligation,
        executionMode: "live",
      } as never);
      expect({ ...simulated, executionMode: undefined }).toEqual({
        ...live,
        executionMode: undefined,
      });
      expect(simulated.charges.length).toBeGreaterThan(0);
      expect(simulated.chargeExplanations).toHaveLength(
        simulated.charges.length,
      );
    }
  });

  it("returns identical discount and adjustment results in both modes", () => {
    const adjustmentInput = {
      billingResult: {
        tenant: "tenant-a",
        charges: calculateContractCharge(
          fixedObligation("simulate") as Extract<
            ResolvedContractChargeObligation,
            { kind: "fixed" }
          >,
        ).charges,
        totalAmount: 5_001,
        discounts: [],
        adjustments: [],
        finalAmount: 5_001,
        currency_code: "USD",
      },
      billingPeriod: { startDate: "2026-08-01", endDate: "2026-09-01" },
      discountCandidates: [
        {
          discount_id: "discount-1",
          discount_name: "Ten percent",
          discount_type: "percentage" as const,
          value: 0.1,
          start_date: "2026-01-01",
        },
      ],
      adjustments: [{ description: "Credit", amount: -250 }],
    };
    const simulated = calculateContractDiscountsAndAdjustments(
      "simulate",
      adjustmentInput,
    );
    const live = calculateContractDiscountsAndAdjustments(
      "live",
      adjustmentInput,
    );
    expect({ ...simulated, executionMode: undefined }).toEqual({
      ...live,
      executionMode: undefined,
    });
    expect(simulated.billingResult.discounts).toHaveLength(1);
    expect(simulated.billingResult.adjustments).toEqual([
      { description: "Credit", amount: -250 },
    ]);
  });
});
