import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractScenario } from "@alga-psa/types";
import { isSimulationBlocked } from "@alga-psa/types";
import { simulationRefusal } from "@ee/lib/billing/simulator/simulationRefusal";

const loadSimulationCalculationInput = vi.fn();
vi.mock("@ee/lib/billing/simulator/loadSimulationCalculationInput", () => ({
  loadSimulationCalculationInput: (...args: unknown[]) =>
    loadSimulationCalculationInput(...args),
  buildSimulatedPeriod: vi.fn(),
}));

import { simulateContractScenario } from "@ee/lib/billing/simulator/simulateContractScenario";

const scenario = {
  scenario_id: "scenario-1",
  currency_code: "EUR",
  horizon: { start_date: "2026-07-01T00:00:00Z", period_count: 3 },
  lines: [],
} as unknown as ContractScenario;

describe("simulateContractScenario refusals", () => {
  beforeEach(() => {
    loadSimulationCalculationInput.mockReset();
  });

  it("returns a blocking result with no periods for a coded refusal", async () => {
    loadSimulationCalculationInput.mockImplementation(async () => {
      throw simulationRefusal(
        "CONTRACT_SIMULATION_CLIENT_NOT_AVAILABLE",
        "The client is not available.",
      );
    });
    const result = await simulateContractScenario({} as any, "tenant", scenario);
    expect(isSimulationBlocked(result)).toBe(true);
    expect(result).toMatchObject({
      scenario_id: "scenario-1",
      currency_code: "EUR",
      horizon: scenario.horizon,
      periods: [],
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "CONTRACT_SIMULATION_CLIENT_NOT_AVAILABLE",
        message_key: "msp/contracts:contractSimulator.errors.clientNotAvailable",
      }),
    ]);
  });

  it("still rejects for an error that is not a coded refusal", async () => {
    loadSimulationCalculationInput.mockImplementation(async () => {
      throw new Error("boom");
    });
    await expect(
      simulateContractScenario({} as any, "tenant", scenario),
    ).rejects.toThrow("boom");
  });
});
