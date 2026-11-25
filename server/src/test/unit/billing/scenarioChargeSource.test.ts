import { describe, expect, it } from "vitest";
import { resolveContractLineCharges } from "@alga-psa/billing/lib/billing/chargeResolution";
import { calculateNormalizedContractCharge } from "@alga-psa/billing/lib/billing/domain/calculateContractCharge";
import { simulationRefusalToDiagnostic } from "@alga-psa/types";
import { asSimulationRefusal } from "@ee/lib/billing/simulator/simulationRefusal";
import { ScenarioChargeSource, createScenarioRunState, type ScenarioChargeSourceInput } from "@ee/lib/billing/simulator/scenarioChargeSource";
import { syntheticConfigId } from "@ee/lib/billing/simulator/syntheticActivity";

const service = (service_id: string, configuration: Record<string, unknown>, service_name = service_id) =>
  ({ service_id, service_name, configuration }) as any;

/** The refusal the source raises, as the blocking diagnostic simulateContractScenario returns. */
async function refusalDiagnostic(source: ScenarioChargeSource) {
  const error = await resolveContractLineCharges(source).then(
    () => null,
    (caught) => caught,
  );
  const refusal = asSimulationRefusal(error);
  expect(refusal).not.toBeNull();
  return simulationRefusalToDiagnostic(refusal!);
}

function sourceFor(line: Record<string, unknown>, overrides: Partial<ScenarioChargeSourceInput> = {}) {
  return new ScenarioChargeSource({
    scenario: { assumptions: {} } as any,
    line: { key: "line-1", contract_line_name: "Managed Support", contract_line_type: "Hourly", ...line } as any,
    lineFacts: { clientContractLineId: "ccl-1" } as any,
    client: { client_id: "c" },
    billingPeriod: {} as any,
    timings: { line: { servicePeriodStart: "2026-07-01", servicePeriodEnd: "2026-08-01" } } as any,
    periodIndex: 0,
    taxPorts: {} as any,
    currencyCode: "USD",
    lineCycle: "monthly",
    diagnostics: [],
    run: createScenarioRunState(),
    ...overrides,
  });
}

describe("ScenarioChargeSource", () => {
  describe("fixed fallback calculation", () => {
    const timing = {
      duePosition: "arrears" as const,
      servicePeriodStart: "2026-07-01",
      servicePeriodEnd: "2026-07-31",
      servicePeriodStartExclusive: "2026-07-01",
      servicePeriodEndExclusive: "2026-08-01",
      coverageRatio: 1,
    };

    async function calculate(services: any[], scope: string | null = "line-1") {
      const source = sourceFor({ contract_line_type: "Fixed", custom_rate: 50000, services }, {
        scenario: {
          assumptions: {},
          pricing_schedules: [{ contract_line_key: scope, effective_date: "2026-07-01", end_date: null, custom_rate: 90000 }],
        } as any,
        lineFacts: {
          tenantId: "tenant-1", clientId: "c", clientContractLineId: "line-1",
          contractLineId: "line-1", contractLineType: "Fixed", currencyCode: "USD",
        },
        billingPeriod: { startDate: "2026-07-01", endDate: "2026-08-01" },
        timings: { line: timing },
        taxPorts: {
          getTaxInfoFromService: (row) => ({ taxRegion: row.tax_rate_id ? "US" : null, isTaxable: !!row.tax_rate_id }),
          getLocationTaxRegionCode: () => null,
          getClientDefaultTaxRegionCode: () => null,
          isTaxExemptForProfile: () => false,
          calculateTax: (_client, amount) => ({ taxRate: 10, taxAmount: amount / 10 }),
        },
      });
      const resolved = await resolveContractLineCharges(source, { families: new Set(["fixed"]) });
      expect(resolved).toHaveLength(1);
      const { obligation, taxContext } = resolved[0];
      return {
        facts: obligation.facts,
        result: calculateNormalizedContractCharge(obligation.facts, "simulate", taxContext),
      };
    }

    it.each([
      ["line-1", 90000],
      ["another-line", 50000],
      [null, 90000],
    ])("bills the fallback fee with schedule scope %s", async (scope, amount) => {
      const { result } = await calculate([service("usage", { configuration_type: "Usage" })], scope);
      expect(result.charges).toHaveLength(1);
      expect(result.charges[0]).toMatchObject({ serviceId: "usage", rate: amount, total: amount });
      expect(result).not.toHaveProperty("blockers", expect.anything());
    });

    it("uses the first non-product service by ID, including its identity and tax facts", async () => {
      const services = [
        service("z-usage", { configuration_type: "Usage" }),
        { ...service("0-product", { configuration_type: "Fixed" }), item_kind: "product" },
        { ...service("a-hourly", { configuration_type: "Hourly" }, "Support"), tax_rate_id: "tax-1" },
      ];
      const { result } = await calculate(services);
      expect(result.charges).toHaveLength(1);
      expect(result.charges[0]).toMatchObject({
        serviceId: "a-hourly", serviceName: "Support",
        config_id: syntheticConfigId("line-1", "a-hourly"),
        total: 90000, tax_amount: 9000, tax_rate: 10,
      });
      expect(services.map((row) => row.service_id)).toEqual(["z-usage", "0-product", "a-hourly"]);
    });

    it("keeps unit-priced Fixed members from falling back to the bundle fee", async () => {
      const { facts, result } = await calculate([
        service("usage", { configuration_type: "Usage" }),
        { ...service("seats", { configuration_type: "Fixed", pricing_basis: "unit", base_rate: 2000 }), quantity: 3 },
      ]);
      expect(facts).toMatchObject({ fallbackService: null });
      expect(result.charges).toHaveLength(1);
      expect(result.charges[0]).toMatchObject({ serviceId: "seats", total: 6000 });
    });

    it.each([
      { name: "empty lines", services: [] },
      { name: "product-only lines", services: [{ ...service("product", { configuration_type: "Usage" }), item_kind: "product" }] },
    ])(
      "does not invent a non-product fallback for $name",
      async ({ services }) => {
        const { facts, result } = await calculate(services);
        expect(facts).toMatchObject({ fallbackService: null });
        expect(result.charges).toEqual([]);
      },
    );
  });

  it("resolves timing per stream: a stream with no timing is not due", async () => {
    const source = sourceFor({ services: [] });
    await expect(source.resolveTiming({ stream: "line" } as any)).resolves.toMatchObject({ status: "due" });
    await expect(source.resolveTiming({ stream: "prepaid_block" } as any)).resolves.toEqual({ status: "not-due" });
  });

  it("derives pools from line.pools and from Bucket-config services, without duplicating a described pool", async () => {
    const source = sourceFor({
      pools: [
        {
          pool_id: "declared",
          pool_name: "Declared",
          covers_all_services: false,
          total_minutes: 600,
          billing_period: "monthly",
          overage_rate: 100,
          allow_rollover: false,
          members: [{ service_id: "svc-a", burn_multiplier: 1 }],
        },
      ],
      services: [
        service("svc-a", { configuration_type: "Hourly" }),
        service("svc-b", { configuration_type: "Bucket", pool_id: "declared", total_minutes: 600, overage_rate: 100 }),
        service("svc-c", { configuration_type: "Bucket", total_minutes: 60, overage_rate: 100, billing_period: "monthly" }),
      ],
    });
    const pools = await source.pools();
    expect(pools.map((pool) => pool.poolId)).toHaveLength(2);
    expect(pools.map((pool) => pool.poolId)).toContain("declared");
    expect(await source.configuredServiceIds()).toEqual(["svc-a", "svc-b", "svc-c"]);
  });

  it("refuses a service kind no family handles with a blocking diagnostic naming the line, service and configuration type", async () => {
    const source = sourceFor({
      services: [
        service("svc-h", { configuration_type: "Hourly" }),
        service("svc-x", { configuration_type: "Mystery" }, "Magic Service"),
      ],
    });
    const diagnostic = await refusalDiagnostic(source);
    expect(diagnostic).toMatchObject({
      severity: "error",
      code: "CONTRACT_SIMULATION_UNSUPPORTED_SERVICE_CONFIGURATION",
      message_key: "msp/contracts:contractSimulator.errors.unsupportedServiceConfiguration",
      line_key: "line-1",
      line_name: "Managed Support",
      service_id: "svc-x",
      service_name: "Magic Service",
      configuration_type: "Mystery",
    });
    expect(diagnostic.message).toMatch(/Magic Service.*Managed Support.*Mystery/);
    expect(diagnostic.message_params).toMatchObject({
      serviceName: "Magic Service",
      lineName: "Managed Support",
      configurationType: "Mystery",
    });
  });

  it("refuses a contract_line_type no family handles with a blocking diagnostic naming the line", async () => {
    const source = sourceFor({ services: [], contract_line_type: "Weird" });
    (source as any).line = { clientContractLineId: "ccl-1", contractLineType: "Weird" };
    const diagnostic = await refusalDiagnostic(source);
    expect(diagnostic).toMatchObject({
      severity: "error",
      code: "CONTRACT_SIMULATION_UNSUPPORTED_LINE_TYPE",
      line_key: "line-1",
      line_name: "Managed Support",
    });
    expect(diagnostic.message).toMatch(/Managed Support.*Weird/);
  });
});
