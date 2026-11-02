import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodedError } from "@alga-psa/ui/lib/errorHandling";
import { ContractSimulationBoundsError, MAX_SIMULATION_PERIODS } from "@alga-psa/types";
import { TierAccessError } from "@alga-psa/licensing";

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
const guards = vi.hoisted(() => {
  process.env.EDITION = "ee"; // @alga-psa/core/features reads the edition at import
  return {
    hasPermission: vi.fn(async (..._args: unknown[]) => true),
    resolveTenantTier: vi.fn(async (_tenant: string) => "pro"),
    createTenantKnex: vi.fn(async () => ({ knex: {} })),
  };
});
vi.mock("@alga-psa/db", () => ({ createTenantKnex: guards.createTenantKnex }));
vi.mock("@alga-psa/auth/rbac", () => ({ hasPermission: guards.hasPermission }));
// Run the real shared tier policy; only the tenant-tier lookup is stubbed.
vi.mock("@alga-psa/licensing/lib/tenant-tier", () => ({
  resolveTenantTier: guards.resolveTenantTier,
}));
vi.mock("@alga-psa/licensing", async () => ({
  ...(await vi.importActual<any>("@alga-psa/licensing")),
}));
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
    guards.hasPermission.mockReset().mockResolvedValue(true);
    guards.resolveTenantTier.mockReset().mockResolvedValue("pro");
    guards.createTenantKnex.mockClear();
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

const actionCalls: Array<[string, (a: any) => Promise<unknown>]> = [
  ["getContractScenarioSnapshot", (a) => a.getContractScenarioSnapshot("c1")],
  ["getContractDraftSimulationScenario", (a) => a.getContractDraftSimulationScenario({})],
  ["runContractSimulation", (a) => a.runContractSimulation(scenario)],
  ["getRecentContractSimulationAssumptions", (a) => a.getRecentContractSimulationAssumptions(scenario)],
  ["getContractSimulationReplayAssumptions", (a) => a.getContractSimulationReplayAssumptions(scenario, "a", "b")],
  ["listContractSimulationClients", (a) => a.listContractSimulationClients()],
];

describe("contractSimulationActions access guard", () => {
  beforeEach(() => {
    process.env.EDITION = "ee";
    Object.values(simulator).forEach((fn) => fn.mockReset());
    guards.hasPermission.mockReset().mockResolvedValue(true);
    guards.resolveTenantTier.mockReset().mockResolvedValue("pro");
    guards.createTenantKnex.mockClear();
  });

  it.each(actionCalls)("%s throws TierAccessError below Pro without loading the simulator or the database", async (_name, call) => {
    guards.resolveTenantTier.mockResolvedValue("solo");
    const actions = await import("./contractSimulationActions");
    await expect(call(actions)).rejects.toBeInstanceOf(TierAccessError);
    expect(guards.createTenantKnex).not.toHaveBeenCalled();
    Object.values(simulator).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it.each(actionCalls)("%s refuses a user without billing:read before checking the tier", async (_name, call) => {
    guards.hasPermission.mockResolvedValue(false);
    const actions = await import("./contractSimulationActions");
    await expect(call(actions)).rejects.toThrow(/Permission denied/);
    expect(guards.resolveTenantTier).not.toHaveBeenCalled();
    expect(guards.createTenantKnex).not.toHaveBeenCalled();
  });

  it("lets a Pro tenant through", async () => {
    simulator.simulateContractScenario.mockResolvedValue({ periods: [] });
    const { runContractSimulation } = await import("./contractSimulationActions");
    await expect((runContractSimulation as any)(scenario)).resolves.toEqual({ periods: [] });
    expect(guards.resolveTenantTier).toHaveBeenCalledWith("t");
  });

  it("still returns not_enterprise in CE", async () => {
    process.env.EDITION = "ce";
    delete process.env.NEXT_PUBLIC_EDITION;
    const { runContractSimulation } = await import("./contractSimulationActions");
    await expect((runContractSimulation as any)(scenario)).resolves.toEqual({
      available: false,
      reason: "not_enterprise",
    });
  });
});

describe("contractSimulationActions horizon bounds", () => {
  const withCount = (period_count: number) => ({
    ...scenario,
    horizon: { ...scenario.horizon, period_count },
  });

  beforeEach(() => {
    process.env.EDITION = "ee";
    Object.values(simulator).forEach((fn) => fn.mockReset());
    guards.createTenantKnex.mockClear();
  });

  it.each([MAX_SIMULATION_PERIODS + 1, 100000])("rejects %i periods before the EE module or database is touched", async (count) => {
    const actions: any = await import("./contractSimulationActions");
    await expect(actions.runContractSimulation(withCount(count))).rejects.toBeInstanceOf(ContractSimulationBoundsError);
    await expect(actions.getRecentContractSimulationAssumptions(withCount(count))).rejects.toBeInstanceOf(ContractSimulationBoundsError);
    await expect(actions.getContractSimulationReplayAssumptions(withCount(count), "a", "b")).rejects.toBeInstanceOf(ContractSimulationBoundsError);
    await expect(actions.getRecentContractSimulationAssumptions(scenario, count)).rejects.toBeInstanceOf(ContractSimulationBoundsError);
    expect(guards.createTenantKnex).not.toHaveBeenCalled();
    Object.values(simulator).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it.each(["100000", 2.5, Number.NaN, undefined])("rejects a non-integer period_count (%s) at the action boundary", async (count) => {
    const actions: any = await import("./contractSimulationActions");
    await expect(actions.runContractSimulation(withCount(count as any))).rejects.toBeInstanceOf(ContractSimulationBoundsError);
    expect(guards.createTenantKnex).not.toHaveBeenCalled();
    Object.values(simulator).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it("accepts MAX_SIMULATION_PERIODS itself", async () => {
    simulator.simulateContractScenario.mockResolvedValue({ periods: [] });
    const { runContractSimulation } = await import("./contractSimulationActions");
    await expect((runContractSimulation as any)(withCount(MAX_SIMULATION_PERIODS))).resolves.toEqual({ periods: [] });
  });
});
