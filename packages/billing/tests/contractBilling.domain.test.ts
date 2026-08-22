import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { IClientContractLine } from "@alga-psa/types";
import {
  assertLiveContractBillingResult,
  calculateContractBilling,
  calculateContractCharge,
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
      line: {
        description: "Fixed",
        quantity: 1,
        unitRate: 10001,
        netAmount: 10001,
        taxAmount: 750,
        currencyCode: "USD",
      },
    },
    {
      obligationId: "hourly",
      tenantId: "tenant-a",
      chargeFamily: "hourly",
      line: {
        description: "Hourly",
        quantity: 1.25,
        unitRate: 999,
        netAmount: 1249,
        taxAmount: 94,
        currencyCode: "USD",
      },
    },
    {
      obligationId: "usage",
      tenantId: "tenant-a",
      chargeFamily: "usage",
      line: {
        description: "Usage",
        quantity: 3,
        unitRate: 333,
        netAmount: 999,
        taxAmount: 75,
        currencyCode: "USD",
      },
    },
    {
      obligationId: "adjustment",
      tenantId: "tenant-a",
      chargeFamily: "other",
      line: {
        description: "Adjustment",
        quantity: 1,
        unitRate: -100,
        netAmount: -100,
        taxAmount: 0,
        currencyCode: "USD",
      },
    },
  ],
});

describe("calculateContractBilling", () => {
  it("returns identical financial results for simulation and live execution", () => {
    const simulated = calculateContractBilling(input("simulate"));
    const live = calculateContractBilling(input("live"));
    expect({ ...simulated, mode: undefined }).toEqual({
      ...live,
      mode: undefined,
    });
    expect(simulated).toMatchObject({
      subtotal: 12149,
      taxTotal: 919,
      total: 13068,
    });
  });

  it("is pure and rejects tenant, currency, window, and fractional-money violations", () => {
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
    expect(() =>
      calculateContractBilling({
        ...input("simulate"),
        obligations: [
          {
            ...input("simulate").obligations[0],
            line: {
              ...input("simulate").obligations[0].line,
              currencyCode: "CAD",
            },
          },
        ],
      }),
    ).toThrow("Mixed currency");
    expect(() =>
      calculateContractBilling({
        ...input("simulate"),
        obligations: [
          {
            ...input("simulate").obligations[0],
            line: { ...input("simulate").obligations[0].line, netAmount: 1.5 },
          },
        ],
      }),
    ).toThrow("integer minor units");
  });

  it("rejects a simulated document at the persistence boundary", () => {
    const simulated = calculateContractBilling(input("simulate"));
    expect(() => assertLiveContractBillingResult(simulated)).toThrow(
      "cannot enter live persistence",
    );
    const live = calculateContractBilling(input("live"));
    expect(() => assertLiveContractBillingResult(live)).not.toThrow();
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
  });
});
