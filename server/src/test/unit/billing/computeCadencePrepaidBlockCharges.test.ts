import { describe, expect, it } from "vitest";
import {
  computeCadencePrepaidBlockCharges,
  type CadencePrepaidBlockInput,
} from "@alga-psa/billing/lib/billing/compute";

const taxContext = {
  getTaxInfoFromService: () => ({ taxRegion: "R1", isTaxable: true }),
  getClientDefaultTaxRegionCode: () => "R1",
  isTaxExemptForProfile: () => false,
  calculateTax: (_c: string, amount: number) => ({
    taxRate: 0.1,
    taxAmount: Math.round(amount * 0.1),
  }),
} as any;

const block = (overrides: Partial<CadencePrepaidBlockInput> = {}): CadencePrepaidBlockInput => ({
  contractLineId: "cl-1",
  clientContractLineId: "ccl-1",
  clientContractId: "cc-1",
  contractName: "Support",
  tenant: "t",
  blockMinutes: 600,
  blockPrice: 150000,
  rolloverPeriods: 0,
  scopeServiceIds: ["svc-a"],
  soldAsServiceId: "svc-sold",
  serviceName: "Support block",
  soldAsTaxRateId: null,
  currencyCode: "USD",
  taxDate: "2026-11-01",
  servicePeriodStart: "2026-11-01",
  servicePeriodEnd: "2026-11-30",
  servicePeriodRecordId: "rec-1",
  coverageRatio: 1,
  enableProration: true,
  validFrom: "2026-11-01",
  expirationDate: "2026-11-30",
  ...overrides,
});

const run = (b: CadencePrepaidBlockInput) =>
  computeCadencePrepaidBlockCharges({ client: { clientId: "c" } as any, block: b }, taxContext);

describe("computeCadencePrepaidBlockCharges", () => {
  it("bills the whole block in advance with its validity and period link", () => {
    const [charge] = run(block()).charges;
    expect(charge).toMatchObject({
      type: "prepaid_block",
      issuance_id: null,
      block_minutes: 600,
      block_price: 150000,
      rate: 15000,
      total: 150000,
      tax_amount: 15000,
      billingTiming: "advance",
      servicePeriodRecordId: "rec-1",
      valid_from: "2026-11-01",
      expiration_date: "2026-11-30",
      rollover_periods: 0,
      config_id: "cl-1",
      currency_code: "USD",
    });
  });

  it("scales hours and price together when a period is part covered", () => {
    const result = run(block({ coverageRatio: 0.5 }));
    const [charge] = result.charges;
    expect(charge.block_minutes).toBe(300);
    expect(charge.block_price).toBe(75000);
    expect(charge.total).toBe(75000);
    expect(charge.rate).toBe(15000);
    expect(result.explanations[0].markers).toContain("proration");
  });

  it("bills the whole block when proration is off", () => {
    const [charge] = run(block({ coverageRatio: 0.25, enableProration: false })).charges;
    expect(charge.block_minutes).toBe(600);
    expect(charge.total).toBe(150000);
  });

  it("keeps the total authoritative when the price does not divide by the hours", () => {
    // 10 h for 100001 cents: rate 10000 (rounded) but the total is the price.
    const [charge] = run(block({ blockPrice: 100001 })).charges;
    expect(charge.rate).toBe(10000);
    expect(charge.total).toBe(100001);
    // Indivisible after proration: ceil(100001 * 17/30) = 56668, 340 min.
    const [part] = run(block({ blockPrice: 100001, coverageRatio: 17 / 30 })).charges;
    expect(part.block_minutes).toBe(340);
    expect(part.total).toBe(56668);
    expect(part.rate).toBe(Math.round(56668 / (340 / 60)));
  });

  it("formats the explanation in the contract currency's minor units", () => {
    const jpy = run(block({ currencyCode: "JPY", blockPrice: 150000 }));
    expect(jpy.explanations[0].inputs.find((i) => i.label === "Block price")?.value).toContain("150,000");
    const kwd = run(block({ currencyCode: "KWD", blockPrice: 150000 }));
    expect(kwd.explanations[0].inputs.find((i) => i.label === "Block price")?.value).toContain("150.000");
    const usd = run(block());
    expect(usd.explanations[0].inputs.find((i) => i.label === "Block price")?.value).toBe("$1,500.00");
  });
});
