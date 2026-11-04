import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingEngine } from "@alga-psa/billing/services";
import { DatabaseChargeSource } from "@alga-psa/billing/lib/billing/chargeResolution";

// The engine path of the shared resolver's totality: a line whose
// contract_line_type or service configuration_type no charge family handles
// resolves the way it did before the check existed, and the engine only warns.
// (The simulator's source throws for the same input: scenarioChargeSource.test.ts.)
// The seam is the DatabaseChargeSource prototype plus the engine's own loaders,
// so no database is involved.

const TIMING = {
  servicePeriodStart: "2026-07-01",
  servicePeriodEnd: "2026-08-01",
} as any;

function stubbedEngine() {
  const engine = new BillingEngine();
  (engine as any).tenant = "tenant-1";
  (engine as any).knex = {};
  vi.spyOn(engine as any, "initKnex").mockResolvedValue(undefined);
  for (const loader of [
    "loadFixedPriceObligation",
    "loadTimeBasedObligation",
    "loadUsageBasedObligation",
    "loadRecurringQuantityObligation",
  ]) {
    vi.spyOn(engine as any, loader).mockResolvedValue(undefined);
  }
  vi.spyOn(DatabaseChargeSource.prototype, "pools").mockResolvedValue([]);
  return engine;
}

const resolve = (engine: BillingEngine, contractLineType: string) =>
  (engine as any).resolveLineCharges({
    clientId: "client-1",
    billingPeriod: { startDate: "2026-07-01", endDate: "2026-08-01" },
    line: {
      client_contract_line_id: "ccl-1",
      contract_line_id: "cl-1",
      contract_line_type: contractLineType,
    },
    timings: { line: TIMING },
    timingSource: "derived",
    families: new Set(["fixed", "hourly", "usage", "product", "license"]),
  });

describe("billing engine with a line no charge family handles", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns and still resolves for an unknown contract_line_type", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await resolve(stubbedEngine(), "Weird");
    expect(result.charges).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/ccl-1/);
    expect(warn.mock.calls[0][1]).toEqual({
      unhandledLineType: "Weird",
      unhandledServices: [],
    });
  });

  it("warns and still resolves for a service of an unknown configuration_type", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = stubbedEngine();
    vi.spyOn(DatabaseChargeSource.prototype, "configuredServices").mockResolvedValue([
      { serviceId: "svc-h", configurationType: "Hourly" },
      { serviceId: "svc-x", configurationType: "Mystery" },
    ]);
    await expect(resolve(engine, "Hourly")).resolves.toMatchObject({ charges: [] });
    expect(warn.mock.calls[0][1]).toEqual({
      unhandledLineType: null,
      unhandledServices: [{ serviceId: "svc-x", configurationType: "Mystery" }],
    });
  });

  it("does not warn for a fully handled line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await resolve(stubbedEngine(), "Hourly");
    expect(warn).not.toHaveBeenCalled();
  });
});
