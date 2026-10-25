import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ContractDraftSimulationInput } from "@alga-psa/types";
import { TestContext } from "@main-test-utils/testContext";
import { createTestService } from "@main-test-utils/billingTestHelpers";
import {
  draftContractToScenario,
  simulateContractScenario,
} from "@ee/lib/billing/simulator";
import { assumptionKey } from "@ee/lib/billing/simulator/syntheticActivity";

process.env.DB_PORT =
  process.env.DB_PORT === "6432" ? "5432" : process.env.DB_PORT;

describe("Draft contract simulation – wizard bucket pools", () => {
  const helpers = TestContext.createHelpers();
  let context: TestContext;
  let premiumSupport: string;

  beforeAll(async () => {
    context = await helpers.beforeAll({
      runSeeds: true,
      clientName: "Draft pool client",
      userType: "internal",
    });
  }, 180_000);

  beforeEach(async () => {
    context = await helpers.beforeEach();
    premiumSupport = await createTestService(context, {
      service_name: "Premium Support",
      default_rate: 15_000,
    });
  }, 60_000);

  afterAll(async () => {
    await helpers.afterAll();
  }, 60_000);

  const draft = (withPool: boolean): ContractDraftSimulationInput => ({
    client_id: context.clientId,
    contract_name: "Draft with pool",
    start_date: "2025-05-01T00:00:00Z",
    billing_frequency: "monthly",
    currency_code: "USD",
    enable_proration: false,
    fixed_lines: [],
    product_services: [],
    hourly_services: [{ service_id: premiumSupport, hourly_rate: 15_000 }],
    usage_services: [],
    bucket_pools: withPool
      ? [
          {
            line_key: "hourly",
            total_minutes: 600,
            overage_rate: 15_000,
            allow_rollover: false,
            covers_all_services: false,
            members: [{ service_id: premiumSupport, burn_multiplier: 1 }],
          },
        ]
      : [],
  });

  async function simulate(input: ContractDraftSimulationInput, hours: number) {
    const scenario = await draftContractToScenario(context.db, context.tenantId, input);
    scenario.assumptions[assumptionKey("draft-hourly", premiumSupport)] = { flat: hours };
    const result = await simulateContractScenario(context.db, context.tenantId, scenario);
    return result.periods.flatMap((period) => period.lines);
  }

  it("a 10h pool with 14 assumed hours bills one $600 pool charge and no plain hourly line", async () => {
    const lines = await simulate(draft(true), 14);
    const bucketLines = lines.filter((line) => line.charge_type === "bucket");
    const hourlyLines = lines.filter(
      (line) => line.charge_type === "time" || line.charge_type === "hourly",
    );
    expect(hourlyLines.filter((line) => line.service_id === premiumSupport)).toHaveLength(0);
    expect(bucketLines.length).toBeGreaterThan(0);
    // One pool charge per simulated period, each 4h x $150.
    const firstPeriod = bucketLines[0];
    expect(firstPeriod.net_amount).toBe(60_000);
    expect(firstPeriod.quantity).toBe(4);
    expect(firstPeriod.quantity_label).toBe("4 hrs overage");
    for (const line of bucketLines) expect(line.net_amount).toBe(60_000);
    const byPeriod = new Map<string, number>();
    for (const line of bucketLines) {
      const key = String(line.service_period_start);
      byPeriod.set(key, (byPeriod.get(key) ?? 0) + 1);
    }
    for (const count of byPeriod.values()) expect(count).toBe(1);
  }, 120_000);

  it("without a pool the same 14 hours bill as plain hourly ($2,100)", async () => {
    const lines = await simulate(draft(false), 14);
    expect(lines.filter((line) => line.charge_type === "bucket")).toHaveLength(0);
    const hourly = lines.filter((line) => line.service_id === premiumSupport);
    expect(hourly.length).toBeGreaterThan(0);
    expect(hourly[0].net_amount).toBe(14 * 15_000);
  }, 120_000);
});
