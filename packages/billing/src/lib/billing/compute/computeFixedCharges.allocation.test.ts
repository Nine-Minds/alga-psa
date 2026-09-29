import { describe, expect, it } from "vitest";
import type { IClientContractLine } from "@alga-psa/types";
import {
  FIXED_LINE_RATE_UNRESOLVED,
  allocateFixedFeeWithoutCatalogPrice,
  computeFixedCharges,
  type FixedChargeComputeInputs,
  type FixedPlanServiceRow,
} from "./computeFixedCharges";
import type { ChargeComputeTaxPorts, ChargeComputeTiming } from "./types";

/**
 * A fixed-fee line whose services carry no catalog price (default_rate 0, no
 * contract-currency service_prices row) must still bill its full fee. These
 * cases pin the allocation fallback chain (stored shares → quantity → even
 * split), the cent-exact remainder handling, the coded "unresolved rate"
 * blocker and — separately — that a legitimate zero rate is NOT a blocker.
 */

const NO_TAX_PORTS: ChargeComputeTaxPorts = {
  getTaxInfoFromService: () => ({ taxRegion: null, isTaxable: false }),
  getLocationTaxRegionCode: () => null,
  getClientDefaultTaxRegionCode: () => null,
  isTaxExemptForProfile: () => false,
  calculateTax: () => ({ taxRate: 0, taxAmount: 0 }),
};

const PERIOD = { startDate: "2026-08-01", endDate: "2026-09-01" };
const CLIENT = { client_id: "client-1", is_tax_exempt: false };

function timing(overrides: Partial<ChargeComputeTiming> = {}): ChargeComputeTiming {
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

function line(currency: string, overrides: Partial<IClientContractLine> = {}): IClientContractLine {
  return {
    client_contract_line_id: "ccl-1",
    client_id: "client-1",
    contract_line_id: "cl-1",
    start_date: "2026-01-01",
    end_date: null,
    is_active: true,
    currency_code: currency,
    contract_line_name: "Essentials",
    contract_line_type: "Fixed",
    billing_timing: "arrears",
    ...overrides,
  };
}

function service(
  id: string,
  overrides: Partial<FixedPlanServiceRow> = {},
): FixedPlanServiceRow {
  return {
    service_id: id,
    service_name: `Service ${id}`,
    default_rate: 0,
    tax_rate_id: null,
    config_id: `cfg-${id}`,
    configuration_quantity: 1,
    service_base_rate: null,
    ...overrides,
  };
}

function inputs(
  currency: string,
  customRateCents: number | null,
  planServices: FixedPlanServiceRow[],
  overrides: Partial<FixedChargeComputeInputs> = {},
): FixedChargeComputeInputs {
  return {
    clientId: "client-1",
    billingPeriod: PERIOD,
    clientContractLine: line(currency),
    timing: timing(),
    client: CLIENT,
    contractLineDetails: {
      contract_line_type: "Fixed",
      custom_rate: customRateCents,
    },
    effectiveCustomRate: null,
    customRateSource: null,
    planServices,
    fallbackService: null,
    ...overrides,
  };
}

const totals = (result: { charges: Array<{ total?: number }> }) =>
  result.charges.map((charge) => charge.total);
const sum = (values: Array<number | undefined>) =>
  values.reduce<number>((acc, value) => acc + (value ?? 0), 0);

// Run every allocation case in more than one currency: allocation is in minor
// units and must not depend on a currency (JPY has no decimals, EUR does).
describe.each(["USD", "EUR", "JPY"])(
  "computeFixedCharges — zero-catalog-price allocation (%s)",
  (currency) => {
    it("allocates the full fee by stored per-service shares", () => {
      const result = computeFixedCharges(
        inputs(currency, 100000, [
          service("a", { service_base_rate: 30000 }),
          service("b", { service_base_rate: 10000 }),
        ]),
        NO_TAX_PORTS,
      );

      expect(totals(result)).toEqual([75000, 25000]);
      expect(sum(totals(result))).toBe(100000);
      expect(result.blockers).toBeUndefined();
      expect(result.charges.map((charge) => charge.proportion)).toEqual([0.75, 0.25]);
      for (const explanation of result.explanations) {
        expect(explanation.markers).toContain("fixed_fee_allocation_fallback");
        expect(explanation.markers).not.toContain("fmv_allocation");
        expect(JSON.stringify(explanation)).toContain("Stored per-service shares");
      }
    });

    it("treats stored shares as the member's share, not a per-unit rate", () => {
      const result = computeFixedCharges(
        inputs(currency, 90000, [
          service("a", { service_base_rate: 20000, configuration_quantity: 5 }),
          service("b", { service_base_rate: 10000, configuration_quantity: 1 }),
        ]),
        NO_TAX_PORTS,
      );

      // 2:1 by share — quantity (5:1) must not enter when shares exist.
      expect(totals(result)).toEqual([60000, 30000]);
    });

    it("falls back to service quantity when no shares are stored", () => {
      const result = computeFixedCharges(
        inputs(currency, 100000, [
          service("a", { configuration_quantity: 1 }),
          service("b", { configuration_quantity: 3 }),
        ]),
        NO_TAX_PORTS,
      );

      expect(totals(result)).toEqual([25000, 75000]);
      expect(sum(totals(result))).toBe(100000);
      expect(JSON.stringify(result.explanations)).toContain("Service quantity");
    });

    it("splits evenly when there are neither shares nor distinct quantities", () => {
      const result = computeFixedCharges(
        inputs(currency, 90000, [service("a"), service("b"), service("c")]),
        NO_TAX_PORTS,
      );

      expect(totals(result)).toEqual([30000, 30000, 30000]);
    });

    it("hands the rounding remainder out so parts sum exactly to the fee", () => {
      const result = computeFixedCharges(
        inputs(currency, 100, [service("a"), service("b"), service("c")]),
        NO_TAX_PORTS,
      );

      expect(sum(totals(result))).toBe(100);
      expect([...totals(result)].sort()).toEqual([33, 33, 34]);
      // Whole minor units only.
      expect(totals(result).every((value) => Number.isInteger(value))).toBe(true);
    });

    it("never drops a cent on an awkward share split", () => {
      const result = computeFixedCharges(
        inputs(currency, 99999, [
          service("a", { service_base_rate: 1 }),
          service("b", { service_base_rate: 1 }),
          service("c", { service_base_rate: 1 }),
          service("d", { service_base_rate: 7 }),
        ]),
        NO_TAX_PORTS,
      );

      expect(sum(totals(result))).toBe(99999);
      expect(totals(result).every((value) => (value ?? 0) >= 0)).toBe(true);
    });

    it("keeps unit-priced members billing and bills the bundle fee in full too", () => {
      const result = computeFixedCharges(
        inputs(currency, 60000, [
          service("seat", {
            pricing_basis: "unit",
            configuration_quantity: 5,
            service_base_rate: 2000,
          }),
          service("bundle-a", { service_base_rate: 1 }),
          service("bundle-b", { service_base_rate: 1 }),
        ]),
        NO_TAX_PORTS,
      );

      const byService = new Map(result.charges.map((charge) => [charge.serviceId, charge.total]));
      expect(byService.get("seat")).toBe(10000);
      expect(byService.get("bundle-a")).toBe(30000);
      expect(byService.get("bundle-b")).toBe(30000);
    });

    it("prorates the fee, then allocates it exactly", () => {
      const result = computeFixedCharges(
        inputs(
          currency,
          100000,
          [service("a"), service("b"), service("c")],
          {
            contractLineDetails: {
              contract_line_type: "Fixed",
              custom_rate: 100000,
              enable_proration: true,
            },
            timing: timing({ coverageRatio: 0.5 }),
          },
        ),
        NO_TAX_PORTS,
      );

      expect(sum(totals(result))).toBe(50000);
    });
  },
);

describe("computeFixedCharges — allocation currency handling", () => {
  it("renders explanations in the contract currency, never a hardcoded dollar", () => {
    const result = computeFixedCharges(
      inputs("EUR", 100000, [service("a"), service("b")]),
      NO_TAX_PORTS,
    );

    const text = JSON.stringify(result.explanations);
    expect(text).not.toContain("$");
    expect(text).toContain("€");
  });
});

describe("computeFixedCharges — unresolved rate versus zero rate", () => {
  it("returns a coded blocker, with line id and name, when the rate cannot be resolved", () => {
    const result = computeFixedCharges(
      inputs("USD", null, [service("a"), service("b")]),
      NO_TAX_PORTS,
    );

    expect(result.charges).toEqual([]);
    expect(result.blockers).toEqual([
      {
        code: FIXED_LINE_RATE_UNRESOLVED,
        message: "Fixed fee line Essentials has no rate",
        contractLineId: "cl-1",
        contractLineName: "Essentials",
      },
    ]);
  });

  it("treats an explicit $0 rate as zero, not as unresolved", () => {
    const result = computeFixedCharges(
      inputs("USD", 0, [service("a"), service("b")]),
      NO_TAX_PORTS,
    );

    expect(result.charges).toEqual([]);
    expect(result.blockers).toBeUndefined();
  });

  it("does not block a line whose unit-priced members can still bill", () => {
    const result = computeFixedCharges(
      inputs("USD", null, [
        service("seat", {
          pricing_basis: "unit",
          configuration_quantity: 2,
          service_base_rate: 1500,
        }),
      ]),
      NO_TAX_PORTS,
    );

    expect(result.blockers).toBeUndefined();
    expect(totals(result)).toEqual([3000]);
  });

  it("blocks a mixed line whose bundle members cannot be priced, keeping the seats", () => {
    const result = computeFixedCharges(
      inputs("USD", null, [
        service("seat", {
          pricing_basis: "unit",
          configuration_quantity: 2,
          service_base_rate: 1500,
        }),
        service("bundle"),
      ]),
      NO_TAX_PORTS,
    );

    expect(result.blockers?.map((blocker) => blocker.code)).toEqual([
      FIXED_LINE_RATE_UNRESOLVED,
    ]);
    expect(totals(result)).toEqual([3000]);
  });
});

describe("computeFixedCharges — FMV allocation is unchanged", () => {
  it.each(["USD", "EUR"])("still splits by catalog FMV when services are priced (%s)", (currency) => {
    const result = computeFixedCharges(
      inputs(currency, 50000, [
        service("a", { default_rate: 10000, currency_rate: 10000 }),
        service("b", { default_rate: 30000, currency_rate: 30000 }),
      ]),
      NO_TAX_PORTS,
    );

    expect(totals(result)).toEqual([12500, 37500]);
    expect(result.charges.map((charge) => charge.proportion)).toEqual([0.25, 0.75]);
    for (const explanation of result.explanations) {
      expect(explanation.markers).toContain("fmv_allocation");
      expect(explanation.markers).not.toContain("fixed_fee_allocation_fallback");
    }
  });

  it("keeps FMV weighting when stored shares disagree with catalog prices", () => {
    const result = computeFixedCharges(
      inputs("USD", 40000, [
        service("a", { default_rate: 10000, service_base_rate: 30000 }),
        service("b", { default_rate: 30000, service_base_rate: 10000 }),
      ]),
      NO_TAX_PORTS,
    );

    expect(totals(result)).toEqual([10000, 30000]);
  });

  it("keeps the existing behaviour for a negative (credit) FMV total", () => {
    const result = computeFixedCharges(
      inputs("USD", 50000, [
        service("credit", { default_rate: -10000, currency_rate: -10000 }),
        service("paid", { default_rate: 4000, currency_rate: 4000 }),
      ]),
      NO_TAX_PORTS,
    );

    // FMV total -6000: proportions 10000/6000 and -4000/6000, rounded per member.
    expect(totals(result)).toEqual([83333, -33333]);
    for (const explanation of result.explanations) {
      expect(explanation.markers).not.toContain("fixed_fee_allocation_fallback");
    }
  });
});

describe("allocateFixedFeeWithoutCatalogPrice", () => {
  it("chooses the basis by the fallback chain", () => {
    expect(
      allocateFixedFeeWithoutCatalogPrice(1000, [
        { service_id: "a", service_base_rate: 1, quantity: 9 },
        { service_id: "b", service_base_rate: 3, quantity: 1 },
      ]),
    ).toMatchObject({ basis: "stored_shares", amounts: [250, 750] });

    expect(
      allocateFixedFeeWithoutCatalogPrice(1000, [
        { service_id: "a", service_base_rate: 0, quantity: 1 },
        { service_id: "b", service_base_rate: null, quantity: 4 },
      ]),
    ).toMatchObject({ basis: "quantity", amounts: [200, 800] });

    expect(
      allocateFixedFeeWithoutCatalogPrice(1000, [
        { service_id: "a", quantity: 0 },
        { service_id: "b", quantity: 0 },
      ]),
    ).toMatchObject({ basis: "even_split", amounts: [500, 500] });
  });

  it("ignores negative or non-numeric weights", () => {
    const allocation = allocateFixedFeeWithoutCatalogPrice(900, [
      { service_id: "a", service_base_rate: -5, quantity: 1 },
      { service_id: "b", service_base_rate: "not-a-number", quantity: 2 },
    ]);

    expect(allocation.basis).toBe("quantity");
    expect(allocation.amounts).toEqual([300, 600]);
  });

  it("always sums to the fee, whatever the weights", () => {
    for (const fee of [1, 2, 7, 100, 9999, 1234567]) {
      for (const weights of [[1, 1, 1], [1, 2, 3, 4, 5], [3, 3], [1, 1000, 1]]) {
        const allocation = allocateFixedFeeWithoutCatalogPrice(
          fee,
          weights.map((weight, index) => ({
            service_id: `s${index}`,
            service_base_rate: weight,
            quantity: 1,
          })),
        );
        expect(sum(allocation.amounts)).toBe(fee);
        expect(allocation.amounts.every((amount) => amount >= 0)).toBe(true);
      }
    }
  });

  it("gives the leftover cent to the largest fraction, ties by service id", () => {
    const allocation = allocateFixedFeeWithoutCatalogPrice(100, [
      { service_id: "c", quantity: 1 },
      { service_id: "a", quantity: 1 },
      { service_id: "b", quantity: 1 },
    ]);

    // 33.33… each: the single leftover cent goes to the lowest service id.
    expect(allocation.amounts).toEqual([33, 34, 33]);
  });
});
