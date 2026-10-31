import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodedError } from "@alga-psa/ui/lib/errorHandling";

const simulator = vi.hoisted(() => ({
  snapshotContractToScenario: vi.fn(),
  simulateContractScenario: vi.fn(),
  loadRecentAverageAssumptions: vi.fn(),
  loadReplayAssumptions: vi.fn(),
  draftContractToScenario: vi.fn(),
}));

vi.mock("@enterprise/lib/billing/simulator", () => simulator);
vi.mock("@alga-psa/core/logger", () => ({
  default: { error: vi.fn(),  debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@alga-psa/db", () => ({
  createTenantKnex: async () => ({ knex: {} }),
}));
vi.mock("@alga-psa/auth/rbac", () => ({ hasPermission: async () => true }));
vi.mock("@alga-psa/auth/withAuth", () => ({
  withAuth:
    (fn: (...args: any[]) => unknown) =>
    (...args: unknown[]) =>
      fn({ user_id: "u" }, { tenant: "t" }, ...args),
}));

const refusal = () =>
  new CodedError(
    '"Magic" on contract line "Support" has the configuration type "Mystery".',
    "CONTRACT_SIMULATION_UNSUPPORTED_SERVICE_CONFIGURATION",
    "msp/contracts:contractSimulator.errors.unsupportedServiceConfiguration",
    { serviceName: "Magic", lineName: "Support", configurationType: "Mystery" },
  );

const scenario = {
  scenario_id: "s1",
  currency_code: "USD",
  horizon: { start_date: "2026-07-01T00:00:00Z", period_count: 2 },
  lines: [],
} as any;

describe("contractSimulationActions refusals", () => {
  beforeEach(() => {
    process.env.EDITION = "ee";
    Object.values(simulator).forEach((fn) => fn.mockReset());
  });

  it("resolves with a blocking result, not a rejection, when a coded refusal escapes a run", async () => {
    simulator.simulateContractScenario.mockRejectedValue(refusal());
    const { runContractSimulation } = await import("./contractSimulationActions");
    const result: any = await (runContractSimulation as any)(scenario);
    expect(result.periods).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "CONTRACT_SIMULATION_UNSUPPORTED_SERVICE_CONFIGURATION",
        service_name: "Magic",
        line_name: "Support",
        configuration_type: "Mystery",
      }),
    ]);
  });

  it("resolves with a typed refusal for snapshot, draft and prefill actions", async () => {
    const actions: any = await import("./contractSimulationActions");
    simulator.snapshotContractToScenario.mockRejectedValue(refusal());
    simulator.draftContractToScenario.mockRejectedValue(refusal());
    simulator.loadRecentAverageAssumptions.mockRejectedValue(refusal());
    simulator.loadReplayAssumptions.mockRejectedValue(refusal());
    const outcomes = [
      await actions.getContractScenarioSnapshot("c1"),
      await actions.getContractDraftSimulationScenario({}),
      await actions.getRecentContractSimulationAssumptions(scenario),
      await actions.getContractSimulationReplayAssumptions(scenario, "a", "b"),
    ];
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({
        refused: true,
        diagnostic: { severity: "error", code: "CONTRACT_SIMULATION_UNSUPPORTED_SERVICE_CONFIGURATION" },
      });
    }
  });

  it("returns a generic blocking result for an unexpected error instead of rejecting", async () => {
    simulator.simulateContractScenario.mockRejectedValue(new Error("db exploded"));
    const { runContractSimulation } = await import("./contractSimulationActions");
    const result: any = await (runContractSimulation as any)(scenario);
    expect(result.periods).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "CONTRACT_SIMULATION_UNEXPECTED",
      message_key: "msp/contracts:contractSimulator.errors.unexpected",
    });
    expect(result.diagnostics[0].message).not.toMatch(/db exploded/);
  });
});
