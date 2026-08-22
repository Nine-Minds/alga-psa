import { describe, expect, it } from "vitest";
import { calculateContractBilling, type ContractBillingCalculationInput } from "../src/lib/billing/domain";

const input = (mode: "simulate" | "live"): ContractBillingCalculationInput => ({
  schemaVersion: 1,
  execution: { mode, tenantId: "tenant-a", calculationId: "calc-1", asOf: "2026-08-21T00:00:00Z" },
  document: { clientId: "client-a", currencyCode: "USD", invoiceWindow: { start: "2026-08-01", endExclusive: "2026-09-01" } },
  obligations: [
    { obligationId: "fixed", tenantId: "tenant-a", chargeFamily: "fixed", line: { description: "Fixed", quantity: 1, unitRate: 10001, netAmount: 10001, taxAmount: 750, currencyCode: "USD" } },
    { obligationId: "hourly", tenantId: "tenant-a", chargeFamily: "hourly", line: { description: "Hourly", quantity: 1.25, unitRate: 999, netAmount: 1249, taxAmount: 94, currencyCode: "USD" } },
    { obligationId: "usage", tenantId: "tenant-a", chargeFamily: "usage", line: { description: "Usage", quantity: 3, unitRate: 333, netAmount: 999, taxAmount: 75, currencyCode: "USD" } },
    { obligationId: "adjustment", tenantId: "tenant-a", chargeFamily: "other", line: { description: "Adjustment", quantity: 1, unitRate: -100, netAmount: -100, taxAmount: 0, currencyCode: "USD" } },
  ],
});

describe("calculateContractBilling", () => {
  it("returns identical financial results for simulation and live execution", () => {
    const simulated = calculateContractBilling(input("simulate"));
    const live = calculateContractBilling(input("live"));
    expect({ ...simulated, mode: undefined }).toEqual({ ...live, mode: undefined });
    expect(simulated).toMatchObject({ subtotal: 12149, taxTotal: 919, total: 13068 });
  });

  it("is pure and rejects tenant, currency, window, and fractional-money violations", () => {
    expect(() => calculateContractBilling({ ...input("simulate"), obligations: [{ ...input("simulate").obligations[0], tenantId: "tenant-b" }] })).toThrow("Cross-tenant");
    expect(() => calculateContractBilling({ ...input("simulate"), document: { ...input("simulate").document, invoiceWindow: { start: "2026-09-01", endExclusive: "2026-09-01" } } })).toThrow("half-open");
    expect(() => calculateContractBilling({ ...input("simulate"), obligations: [{ ...input("simulate").obligations[0], line: { ...input("simulate").obligations[0].line, currencyCode: "CAD" } }] })).toThrow("Mixed currency");
    expect(() => calculateContractBilling({ ...input("simulate"), obligations: [{ ...input("simulate").obligations[0], line: { ...input("simulate").obligations[0].line, netAmount: 1.5 } }] })).toThrow("integer minor units");
  });
});
