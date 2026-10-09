import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ContractDraftSimulationInput } from "@alga-psa/types";
import { TestContext } from "@main-test-utils/testContext";
import { createTestService } from "@main-test-utils/billingTestHelpers";
import {
  draftContractToScenario,
  simulateContractScenario,
} from "@ee/lib/billing/simulator";
import { fixedServicesRecurringTotalCents } from "@alga-psa/billing/lib/fixedServiceBasis";

process.env.DB_PORT =
  process.env.DB_PORT === "6432" ? "5432" : process.env.DB_PORT;

type FixedItem = ContractDraftSimulationInput["fixed_services"][number];

describe("Draft contract simulation – per-seat fixed services", () => {
  const helpers = TestContext.createHelpers();
  let context: TestContext;
  let user: string;
  let endpoint: string;
  let location: string;
  let flat: string;

  beforeAll(async () => {
    context = await helpers.beforeAll({
      runSeeds: true,
      clientName: "Draft per-seat client",
      userType: "internal",
    });
  }, 180_000);

  beforeEach(async () => {
    context = await helpers.beforeEach();
    user = await createTestService(context, { service_name: "Managed User", default_rate: 10_000 });
    endpoint = await createTestService(context, { service_name: "Managed Endpoint", default_rate: 5_000 });
    location = await createTestService(context, { service_name: "Managed Location", default_rate: 20_000 });
    flat = await createTestService(context, { service_name: "Flat bundle", default_rate: 1_000 });
  }, 60_000);

  afterAll(async () => {
    await helpers.afterAll();
  }, 60_000);

  const draft = (
    fixed_services: FixedItem[],
    overrides: Partial<ContractDraftSimulationInput> = {},
  ): ContractDraftSimulationInput => ({
    client_id: context.clientId,
    contract_name: "Per-seat draft",
    start_date: "2025-05-01T00:00:00Z",
    billing_frequency: "monthly",
    currency_code: "USD",
    enable_proration: false,
    fixed_services,
    product_services: [],
    hourly_services: [],
    usage_services: [],
    ...overrides,
  });

  async function simulatedFixedTotal(input: ContractDraftSimulationInput) {
    const scenario = await draftContractToScenario(context.db, context.tenantId, input);
    const result = await simulateContractScenario(context.db, context.tenantId, scenario);
    const period = result.periods.find((p) => p.lines.some((l) => l.charge_type === "fixed"));
    expect(period).toBeDefined();
    const lines = period!.lines.filter((l) => l.charge_type === "fixed");
    return {
      total: lines.reduce((sum, l) => sum + l.net_amount, 0),
      byService: new Map(lines.map((l) => [l.service_id, l.net_amount])),
    };
  }

  const unit = (service_id: string, quantity: number, unit_rate: number | null): FixedItem => ({
    service_id,
    quantity,
    pricing_basis: "unit",
    unit_rate,
  });

  it("charges the overridden unit rate and an explicit zero, matching the wizard review ($3,300)", async () => {
    const items = [unit(user, 20, 9_000), unit(endpoint, 30, 5_000), unit(location, 0, 20_000)];
    const { total, byService } = await simulatedFixedTotal(draft(items));
    expect(total).toBe(330_000);
    expect(total).toBe(fixedServicesRecurringTotalCents(items, null));
    expect(byService.get(user)).toBe(180_000);
    expect(byService.get(endpoint)).toBe(150_000);
    expect(byService.has(location)).toBe(false);
  });

  it("prices a default package from the catalog when no override is set ($3,900)", async () => {
    const items = [unit(user, 20, null), unit(endpoint, 30, null), unit(location, 2, null)];
    const { total } = await simulatedFixedTotal(draft(items));
    expect(total).toBe(390_000);
  });

  it("splits the line base rate across allocation members only on a mixed line", async () => {
    const items: FixedItem[] = [
      { service_id: flat, quantity: 1, pricing_basis: "bundle" },
      unit(user, 5, 9_000),
      unit(endpoint, 0, null),
    ];
    const input = draft(items, { fixed_base_rate: 25_000 });
    const { total, byService } = await simulatedFixedTotal(input);
    expect(total).toBe(25_000 + 5 * 9_000);
    expect(total).toBe(fixedServicesRecurringTotalCents(items, 25_000));
    expect(byService.get(flat)).toBe(25_000);
    expect(byService.get(user)).toBe(45_000);
  });

  it("keeps bundle-only drafts unchanged, including the allocation minimum of 1", async () => {
    const items: FixedItem[] = [
      { service_id: flat, quantity: 0, pricing_basis: "bundle" },
      { service_id: endpoint, quantity: 3, pricing_basis: "bundle" },
    ];
    const withBasis = await simulatedFixedTotal(draft(items, { fixed_base_rate: 40_000 }));
    expect(withBasis.total).toBe(40_000);
    // Drafts that predate pricing_basis (field absent) simulate identically.
    const legacy = await simulatedFixedTotal(
      draft(
        items.map(({ service_id, quantity }) => ({ service_id, quantity }) as FixedItem),
        { fixed_base_rate: 40_000 },
      ),
    );
    expect(legacy.total).toBe(40_000);
    expect(legacy.byService).toEqual(withBasis.byService);
    // Quantity 0 allocates as 1 (not an explicit zero). Shares are weighted by
    // quantity × catalog rate: 1×$10 : 3×$50 of the $400 base rate. These are
    // the values produced before pricing_basis was threaded through.
    expect(withBasis.byService.get(flat)).toBe(2_500);
    expect(withBasis.byService.get(endpoint)).toBe(37_500);
  });

  it("prices catalog-following units from the contract currency, not USD", async () => {
    for (const [serviceId, rate] of [[user, 8_000], [endpoint, 4_000]] as const) {
      await context.db("service_prices").insert({
        tenant: context.tenantId,
        service_id: serviceId,
        currency_code: "EUR",
        rate,
        effective_date: "1970-01-01",
      });
    }
    const { total } = await simulatedFixedTotal(
      draft([unit(user, 10, null), unit(endpoint, 10, null)], { currency_code: "EUR" }),
    );
    expect(total).toBe(10 * 8_000 + 10 * 4_000);
  });
});
