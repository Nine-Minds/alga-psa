import { describe, expect, it } from "vitest";
import { resolveContractLineCharges } from "@alga-psa/billing/lib/billing/chargeResolution";
import { simulationRefusalToDiagnostic } from "@alga-psa/types";
import { asSimulationRefusal } from "@ee/lib/billing/simulator/simulationRefusal";
import { ScenarioChargeSource, createScenarioRunState } from "@ee/lib/billing/simulator/scenarioChargeSource";

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

function sourceFor(line: Record<string, unknown>) {
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
  });
}

describe("ScenarioChargeSource", () => {
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
