// @vitest-environment jsdom
/**
 * The draft simulator rebuilds its scenario from wizard state, so the workspace
 * receives replacement scenarios as a prop. These tests pin what the run bar is
 * allowed to claim while that happens: a projection may never be reported as
 * current for a scenario it did not price.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractScenario, ScenarioDiscount } from "@alga-psa/types";
import ContractSimulatorWorkspace from "@ee/components/billing/simulator/ContractSimulatorWorkspace";

const CURRENT = "Simulation current · 6 client billing periods";
const STALE = "Changes not simulated";
const STALE_BANNER =
  "These amounts are from the previous simulation. Update the simulation to include your latest changes.";

vi.mock("@alga-psa/ui/lib/i18n/client", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      let value = String(options?.defaultValue ?? key);
      for (const [name, replacement] of Object.entries(options ?? {})) {
        value = value.replaceAll(`{{${name}}}`, String(replacement));
      }
      return value;
    },
  }),
  useFormatters: () => ({ formatCurrency: () => "$0.00" }),
}));

vi.mock("server/src/context/TierContext", () => ({
  useTierFeature: () => true,
}));

const simulation = vi.hoisted(() => ({
  scenarios: [] as ContractScenario[],
  hold: false,
  release: null as null | (() => void),
}));

vi.mock("@alga-psa/billing/actions/contractSimulationActions", () => ({
  getContractScenarioSnapshot: vi.fn(),
  getContractSimulationReplayAssumptions: vi.fn(),
  getRecentContractSimulationAssumptions: vi.fn(),
  runContractSimulation: vi.fn(async (scenario: ContractScenario) => {
    simulation.scenarios.push(scenario);
    if (simulation.hold) {
      await new Promise<void>((resolve) => {
        simulation.release = resolve;
      });
    }
    return {
      scenario_id: "scenario-1",
      currency_code: "USD",
      horizon: scenario.horizon,
      periods: Array.from({ length: 6 }, (_, index) => ({
        index,
        label: `P${index + 1}`,
        total: 0,
      })),
      diagnostics: [],
    };
  }),
}));

vi.mock("@alga-psa/billing/actions/invoiceTemplates", () => ({
  getInvoiceTemplates: vi.fn(async () => []),
}));

vi.mock("@alga-psa/ui/components/Button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@alga-psa/ui/components/CustomSelect", () => ({
  default: ({ id, value }: { id: string; value: string }) => (
    <input id={id} value={value} readOnly />
  ),
}));

vi.mock("@ee/components/billing/simulator/AssumptionsPanel", () => ({ default: () => null }));
vi.mock("@ee/components/billing/simulator/ScenarioPanel", () => ({ default: () => null }));
vi.mock("@ee/components/billing/simulator/SimulationTimeline", () => ({ default: () => null }));
vi.mock("@ee/components/billing/simulator/SimulatedInvoiceDetail", () => ({ default: () => null }));
vi.mock("@ee/components/billing/simulator/ChargeExplanationPanel", () => ({ default: () => null }));

const loyalty: ScenarioDiscount = {
  discount_id: "draft-discount-1",
  discount_name: "Loyalty",
  discount_type: "percentage",
  value: 0.1,
  start_date: "2026-11-01T00:00:00Z",
  end_date: null,
  contract_line_keys: [],
};

const scenarioWith = (discounts: ScenarioDiscount[]): ContractScenario =>
  ({
    client_binding: { kind: "client", client_id: "client-1", client_name: "Client" },
    currency_code: "USD",
    horizon: { period_count: 6 },
    lines: [],
    available_services: [],
    pricing_schedules: [],
    discounts,
    adjustments: [],
    assumptions: {},
  }) as unknown as ContractScenario;

const simulate = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText("Simulate"));
  });
};

describe("contract simulator scenario refresh", () => {
  beforeEach(() => {
    simulation.scenarios.length = 0;
    simulation.hold = false;
    simulation.release = null;
  });

  it("refreshes the projection when the draft behind the scenario changes", async () => {
    const { rerender } = render(
      <ContractSimulatorWorkspace initialScenario={scenarioWith([])} readOnlyScenario />,
    );
    await simulate();
    expect(screen.getByText(CURRENT)).toBeInTheDocument();
    expect(simulation.scenarios).toHaveLength(1);

    // A discount authored in the wizard: the scenario is rebuilt and handed over
    // while the previous projection is still on screen.
    simulation.hold = true;
    act(() => {
      rerender(
        <ContractSimulatorWorkspace
          initialScenario={scenarioWith([loyalty])}
          readOnlyScenario
        />,
      );
    });
    expect(screen.queryByText(CURRENT)).not.toBeInTheDocument();
    expect(screen.getByText(STALE)).toBeInTheDocument();
    expect(screen.getByText(STALE_BANNER)).toBeInTheDocument();

    simulation.hold = false;
    await act(async () => {
      simulation.release?.();
    });
    expect(simulation.scenarios).toHaveLength(2);
    expect(simulation.scenarios[1].discounts).toEqual([loyalty]);
    expect(screen.getByText(CURRENT)).toBeInTheDocument();
  });

  it("keeps the projection when the scenario is rebuilt unchanged", async () => {
    const scenario = scenarioWith([loyalty]);
    const { rerender } = render(
      <ContractSimulatorWorkspace initialScenario={scenario} readOnlyScenario />,
    );
    await simulate();
    expect(simulation.scenarios).toHaveLength(1);

    await act(async () => {
      rerender(
        <ContractSimulatorWorkspace
          initialScenario={structuredClone(scenario)}
          readOnlyScenario
        />,
      );
    });
    expect(simulation.scenarios).toHaveLength(1);
    expect(screen.getByText(CURRENT)).toBeInTheDocument();
    expect(screen.queryByText(STALE_BANNER)).not.toBeInTheDocument();
  });

  it("stops calling the projection current while a replacement scenario loads", async () => {
    const scenario = scenarioWith([]);
    const { rerender } = render(
      <ContractSimulatorWorkspace initialScenario={scenario} readOnlyScenario />,
    );
    await simulate();
    expect(screen.getByText(CURRENT)).toBeInTheDocument();

    await act(async () => {
      rerender(
        <ContractSimulatorWorkspace
          initialScenario={scenario}
          scenarioReloading
          readOnlyScenario
        />,
      );
    });
    expect(screen.queryByText(CURRENT)).not.toBeInTheDocument();
    expect(screen.getByText(STALE)).toBeInTheDocument();
    expect(screen.getByText(STALE_BANNER)).toBeInTheDocument();
    expect(screen.getByText("Update simulation")).toBeInTheDocument();
  });
});
