import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { IBillingResult, IClientContractLine } from "@alga-psa/types";
import {
  computeBucketCharges,
  computeDiscountsAndAdjustments,
  computeFixedCharges,
  computeRecurringQuantityCharges,
  computeTimeBasedCharges,
  computeUsageBasedCharges,
  type ChargeComputeTaxContext,
  type ChargeComputeTiming,
} from ".";

const TAX_CONTEXT: ChargeComputeTaxContext = {
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
const CLIENT = { client_id: "client-1", is_tax_exempt: false };

function contractLine(
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
    contract_line_name: "Golden contract",
    contract_line_type: "Fixed",
    billing_timing: "arrears",
    ...overrides,
  };
}

function timing(): ChargeComputeTiming {
  return {
    duePosition: "arrears",
    servicePeriodStart: "2026-08-01",
    servicePeriodEnd: "2026-08-31",
    servicePeriodStartExclusive: "2026-08-01",
    servicePeriodEndExclusive: "2026-09-01",
    coverageRatio: 1,
  };
}

function chargeEnvelope(chargeValue: unknown) {
  const charge = chargeValue as Record<string, unknown>;
  return {
    type: charge.type,
    serviceId: charge.serviceId ?? null,
    quantity: charge.quantity ?? null,
    duration: charge.duration ?? null,
    overageHours: charge.overageHours ?? null,
    rate: charge.rate ?? null,
    total: charge.total,
    tax_amount: charge.tax_amount ?? 0,
    servicePeriodStart: charge.servicePeriodStart ?? null,
    servicePeriodEnd: charge.servicePeriodEnd ?? null,
  };
}

describe("production compute extraction golden", () => {
  it("keeps representative charge-family output bytes stable", () => {
    const fixed = computeFixedCharges(
      {
        clientId: "client-1",
        billingPeriod: PERIOD,
        clientContractLine: contractLine(),
        timing: timing(),
        client: CLIENT,
        contractLineDetails: {
          contract_line_type: "Fixed",
          custom_rate: 10_000,
        },
        effectiveCustomRate: null,
        customRateSource: null,
        planServices: [
          {
            service_id: "svc-fixed",
            service_name: "Managed service",
            default_rate: 10_000,
            tax_rate_id: "tax-1",
            config_id: "cfg-fixed",
            configuration_quantity: 1,
            service_base_rate: null,
          },
        ],
        fallbackService: null,
      },
      TAX_CONTEXT,
    );
    const time = computeTimeBasedCharges(
      {
        billingPeriod: PERIOD,
        clientContractLine: contractLine({ contract_line_type: "Hourly" }),
        timing: timing(),
        client: CLIENT,
        plan: {},
        serviceConfigMap: new Map([
          [
            "svc-time",
            {
              config: {
                config_id: "cfg-time",
                hourly_rate: 5_000,
                minimum_billable_time: 0,
                round_up_to_nearest: 0,
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
            end_time: new Date("2026-08-05T12:00:00Z"),
            service_id: "svc-time",
            service_name: "Engineering",
            tax_rate_id: "tax-1",
            custom_rate: null,
            currency_rate: 5_000,
            billable_duration: 120,
          },
        ],
        contractCurrency: "USD",
      },
      TAX_CONTEXT,
    );
    const usage = computeUsageBasedCharges(
      {
        billingPeriod: PERIOD,
        clientContractLine: contractLine({ contract_line_type: "Usage" }),
        timing: timing(),
        client: CLIENT,
        serviceConfigMap: new Map([
          [
            "svc-usage",
            {
              config: {
                config_id: "cfg-usage",
                custom_rate: 200,
                minimum_usage: 0,
                enable_tiered_pricing: false,
              },
              rateTiers: [],
            },
          ],
        ]),
        usageRecords: [
          {
            usage_id: "usage-1",
            service_id: "svc-usage",
            service_name: "Cloud backup",
            quantity: 12,
            tax_rate_id: "tax-1",
            currency_rate: 200,
          },
        ],
        contractCurrency: "USD",
      },
      TAX_CONTEXT,
    );
    const bucket = computeBucketCharges(
      {
        billingPeriod: PERIOD,
        clientContractLine: contractLine({ contract_line_type: "Hourly" }),
        client: CLIENT,
        config: {
          config_id: "cfg-bucket",
          service_id: "svc-bucket",
          service_name: "Support bucket",
          tax_rate_id: "tax-1",
          total_minutes: 60,
          overage_rate: 1_000,
          allow_rollover: false,
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
      TAX_CONTEXT,
    );
    const product = computeRecurringQuantityCharges(
      {
        clientContractLine: contractLine(),
        client: CLIENT,
        timing: timing(),
        chargeType: "product",
        services: [
          {
            service_id: "svc-product",
            service_name: "Managed appliance",
            default_rate: 2_500,
            tax_rate_id: "tax-1",
            config_id: "cfg-product",
            service_quantity: 2,
            service_line_custom_rate: null,
            configuration_quantity: 2,
            configuration_custom_rate: null,
            price_rate: 2_500,
          },
        ],
        contractCurrency: "USD",
      },
      TAX_CONTEXT,
    );
    const license = computeRecurringQuantityCharges(
      {
        clientContractLine: contractLine(),
        client: CLIENT,
        timing: timing(),
        chargeType: "license",
        services: [
          {
            service_id: "svc-license",
            service_name: "Security license",
            default_rate: 1_000,
            tax_rate_id: "tax-1",
            config_id: "cfg-license",
            service_quantity: 5,
            service_line_custom_rate: null,
            configuration_quantity: 5,
            configuration_custom_rate: null,
            price_rate: 1_000,
          },
        ],
        contractCurrency: "USD",
      },
      TAX_CONTEXT,
    );
    const billingResult: IBillingResult = {
      charges: fixed.charges,
      totalAmount: 10_000,
      discounts: [],
      adjustments: [],
      finalAmount: 10_000,
      currency_code: "USD",
    };
    const discounts = computeDiscountsAndAdjustments({
      billingResult,
      billingPeriod: PERIOD,
      discountCandidates: [
        {
          discount_id: "discount-1",
          discount_name: "Ten percent",
          discount_type: "percentage",
          value: 0.1,
          start_date: "2026-01-01",
        },
      ],
      adjustments: [{ description: "Credit", amount: -250 }],
    });

    const actualBytes = JSON.stringify({
      fixed: fixed.charges.map((charge) => chargeEnvelope(charge)),
      time: time.charges.map((charge) => chargeEnvelope(charge)),
      usage: usage.charges.map((charge) => chargeEnvelope(charge)),
      bucket: bucket.charges.map((charge) => chargeEnvelope(charge)),
      product: product.charges.map((charge) => chargeEnvelope(charge)),
      license: license.charges.map((charge) => chargeEnvelope(charge)),
      discounts: discounts.billingResult.discounts.map((discount) => ({
        type: discount.discount_type,
        amount: discount.amount,
      })),
      adjustments: discounts.billingResult.adjustments,
      finalAmount: discounts.billingResult.finalAmount,
    });

    expect(actualBytes).toBe(
      '{"fixed":[{"type":"fixed","serviceId":"svc-fixed","quantity":1,"duration":null,"overageHours":null,"rate":10000,"total":10000,"tax_amount":1000,"servicePeriodStart":"2026-08-01","servicePeriodEnd":"2026-08-31"}],"time":[{"type":"time","serviceId":"svc-time","quantity":2,"duration":2,"overageHours":null,"rate":5000,"total":10000,"tax_amount":1000,"servicePeriodStart":"2026-08-01","servicePeriodEnd":"2026-08-31"}],"usage":[{"type":"usage","serviceId":"svc-usage","quantity":12,"duration":null,"overageHours":null,"rate":200,"total":2400,"tax_amount":240,"servicePeriodStart":"2026-08-01","servicePeriodEnd":"2026-08-31"}],"bucket":[{"type":"bucket","serviceId":"svc-bucket","quantity":null,"duration":null,"overageHours":2,"rate":1000,"total":2000,"tax_amount":200,"servicePeriodStart":"2026-08-01","servicePeriodEnd":"2026-08-31"}],"product":[{"type":"product","serviceId":"svc-product","quantity":2,"duration":null,"overageHours":null,"rate":2500,"total":5000,"tax_amount":500,"servicePeriodStart":"2026-08-01","servicePeriodEnd":"2026-08-31"}],"license":[{"type":"license","serviceId":"svc-license","quantity":5,"duration":null,"overageHours":null,"rate":1000,"total":5000,"tax_amount":500,"servicePeriodStart":"2026-08-01","servicePeriodEnd":"2026-08-31"}],"discounts":[{"type":"percentage","amount":1000}],"adjustments":[{"description":"Credit","amount":-250}],"finalAmount":8750}',
    );
  });

  it("keeps shared compute free of database access and production delegated to it", () => {
    const computeFiles = [
      "computeFixedCharges.ts",
      "computeTimeBasedCharges.ts",
      "computeUsageBasedCharges.ts",
      "computeBucketCharges.ts",
      "computeRecurringQuantityCharges.ts",
      "computeDiscountsAndAdjustments.ts",
      "taxContext.ts",
    ];
    for (const file of computeFiles) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(
        /(?:tenantDb|createTenantKnex|from ["']knex["']|@alga-psa\/db)/,
      );
    }

    const domainDispatcher = readFileSync(
      new URL("../domain/calculateContractCharge.ts", import.meta.url),
      "utf8",
    );
    const engine = readFileSync(
      new URL("../billingEngine.ts", import.meta.url),
      "utf8",
    );
    const simulator = readFileSync(
      new URL(
        "../../../../../../ee/server/src/lib/billing/simulator/simulateContractScenario.ts",
        import.meta.url,
      ),
      "utf8",
    );
    for (const computeName of [
      "computeFixedCharges",
      "computeTimeBasedCharges",
      "computeUsageBasedCharges",
      "computeBucketCharges",
      "computeRecurringQuantityCharges",
      "computeDiscountsAndAdjustments",
    ]) {
      expect(domainDispatcher).toContain(`${computeName}(`);
      expect(engine).not.toContain(`${computeName}(`);
    }
    expect(engine).toContain("calculateContractBilling({");
    expect(engine).not.toContain("calculateContractCharge(");
    expect(simulator).toContain("calculateContractBilling({");
    expect(simulator).not.toMatch(
      /calculateContractCharge\(|pushChargeLine|applyScenarioDiscountsAndAdjustments/,
    );
    expect(engine).toContain("loadChargeComputeTaxContext");
    expect(engine).toContain("loadPersistedRecurringTimingSelections");
    expect(engine).toContain("hasExistingServicePeriodCharge");
    expect(engine).toContain(
      'table("client_billing_cycles").insert(defaultCycle)',
    );
  });
});
