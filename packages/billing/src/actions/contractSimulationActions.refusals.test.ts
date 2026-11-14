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
    tenantDb: vi.fn(),
    currentUser: { user_id: "u", user_type: "internal" as string } as any,
  };
});
vi.mock("@alga-psa/db", () => ({
  createTenantKnex: guards.createTenantKnex,
  tenantDb: guards.tenantDb,
}));
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
      fn(guards.currentUser, { tenant: "t" }, ...args),
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
    guards.tenantDb.mockReset();
    guards.currentUser = { user_id: "u", user_type: "internal" };
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
    guards.tenantDb.mockReset();
    guards.currentUser = { user_id: "u", user_type: "internal" };
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

  it.each(["Client Admin", "Finance"]) (
    "%s portal principal with billing:read is denied before simulator or database access",
    async (roleName) => {
      guards.currentUser = { user_id: `portal-${roleName}`, user_type: "client", roleName };
      const actions = await import("./contractSimulationActions");

      for (const [, call] of actionCalls) {
        await expect(call(actions)).rejects.toThrow(/internal users/);
      }

      expect(guards.hasPermission).not.toHaveBeenCalled();
      expect(guards.resolveTenantTier).not.toHaveBeenCalled();
      expect(guards.createTenantKnex).not.toHaveBeenCalled();
      Object.values(simulator).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    },
  );

  it("rejects portal replay assumptions carrying another client's scenario before protected reads", async () => {
    guards.currentUser = { user_id: "portal-finance", user_type: "client" };
    const actions: any = await import("./contractSimulationActions");
    const foreignScenario = {
      ...scenario,
      client_binding: { kind: "client", client_id: "another-client", client_name: "Another Client" },
    };

    await expect(actions.getContractSimulationReplayAssumptions(foreignScenario, "2026-01-01", "2026-02-01"))
      .rejects.toThrow(/internal users/);
    expect(guards.createTenantKnex).not.toHaveBeenCalled();
    expect(simulator.loadReplayAssumptions).not.toHaveBeenCalled();
  });

  it("lets a Pro tenant through", async () => {
    simulator.simulateContractScenario.mockResolvedValue({ periods: [] });
    const { runContractSimulation } = await import("./contractSimulationActions");
    await expect((runContractSimulation as any)(scenario)).resolves.toEqual({ periods: [] });
    expect(guards.resolveTenantTier).toHaveBeenCalledWith("t");
  });

  it("requires client:read before reading the client picker data", async () => {
    guards.hasPermission.mockImplementation(async (...args: unknown[]) => args[1] === "billing");
    const actions: any = await import("./contractSimulationActions");

    await expect(actions.listContractSimulationClients()).rejects.toThrow(/Cannot read clients/);
    expect(guards.hasPermission).toHaveBeenNthCalledWith(1, guards.currentUser, "billing", "read");
    expect(guards.hasPermission).toHaveBeenNthCalledWith(2, guards.currentUser, "client", "read");
    expect(guards.createTenantKnex).not.toHaveBeenCalled();
  });

  it("lists only active clients in the authenticated tenant for an internal client reader", async () => {
    const rows = [
      { tenant: "t", client_id: "allowed", client_name: "Allowed Co", is_inactive: false },
      { tenant: "t", client_id: "inactive", client_name: "Inactive Co", is_inactive: true },
      { tenant: "other-tenant", client_id: "foreign", client_name: "Foreign Co", is_inactive: false },
    ];
    const query: any = {
      filtered: [...rows],
      where(criteria: Record<string, unknown>) {
        this.filtered = this.filtered.filter((row: any) =>
          Object.entries(criteria).every(([key, value]) => row[key] === value),
        );
        return this;
      },
      orderBy(key: string, direction: string) {
        this.filtered.sort((a: any, b: any) => direction === "asc" ? a[key].localeCompare(b[key]) : b[key].localeCompare(a[key]));
        return this;
      },
      select(...columns: string[]) {
        return Promise.resolve(this.filtered.map((row: any) => Object.fromEntries(columns.map((column) => [column, row[column]]))));
      },
    };
    guards.tenantDb.mockImplementation((_knex: unknown, tenant: string) => ({
      table: () => {
        query.filtered = rows.filter((row) => row.tenant === tenant);
        return query;
      },
    }));
    guards.createTenantKnex.mockResolvedValue({ knex: () => query } as any);
    guards.hasPermission.mockResolvedValue(true);
    const actions: any = await import("./contractSimulationActions");

    await expect(actions.listContractSimulationClients()).resolves.toEqual([
      { client_id: "allowed", client_name: "Allowed Co" },
    ]);
    expect(guards.hasPermission).toHaveBeenNthCalledWith(1, guards.currentUser, "billing", "read");
    expect(guards.hasPermission).toHaveBeenNthCalledWith(2, guards.currentUser, "client", "read");
    expect(guards.tenantDb).toHaveBeenCalledWith(expect.any(Function), "t");
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
