import { describe, expect, it } from "vitest";
import { resolveContractLineCharges } from "@alga-psa/billing/lib/billing/chargeResolution";
import { ScenarioChargeSource, createScenarioRunState } from "@ee/lib/billing/simulator/scenarioChargeSource";

const service = (service_id: string, configuration: Record<string, unknown>) =>
  ({ service_id, service_name: service_id, configuration }) as any;

function sourceFor(line: Record<string, unknown>) {
  return new ScenarioChargeSource({
    scenario: { assumptions: {} } as any,
    line: { key: "line-1", contract_line_type: "Hourly", ...line } as any,
    lineFacts: { clientContractLineId: "ccl-1" } as any,
    client: { client_id: "c" },
    billingPeriod: {} as any,
    timing: { servicePeriodStart: "2026-07-01", servicePeriodEnd: "2026-08-01" } as any,
    periodIndex: 0,
    taxPorts: {} as any,
    currencyCode: "USD",
    lineCycle: "monthly",
    diagnostics: [],
    run: createScenarioRunState(),
  });
}

describe("ScenarioChargeSource", () => {
  it("rejects timing requests other than the line's own due position", async () => {
    const source = sourceFor({ services: [] });
    await expect(source.resolveTiming({ duePosition: "advance" } as any)).rejects.toThrow(/only the line's own position/);
    await expect(source.resolveTiming({ duePosition: "line" } as any)).resolves.toMatchObject({ status: "due" });
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

  it("fails loudly (the simulator throws where the engine only warns) for a service kind no family handles", async () => {
    const source = sourceFor({
      services: [
        service("svc-h", { configuration_type: "Hourly" }),
        service("svc-x", { configuration_type: "Mystery" }),
      ],
    });
    await expect(resolveContractLineCharges(source)).rejects.toThrow(/ccl-1.*svc-x.*Mystery/);
  });

  it("fails loudly for a contract_line_type no family handles", async () => {
    const source = sourceFor({ services: [], contract_line_type: "Weird" });
    (source as any).line = { clientContractLineId: "ccl-1", contractLineType: "Weird" };
    await expect(resolveContractLineCharges(source)).rejects.toThrow(/ccl-1.*Weird/);
  });
});
