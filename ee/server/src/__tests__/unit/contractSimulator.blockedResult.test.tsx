// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContractScenario } from "@alga-psa/types";
import ContractSimulatorWorkspace from "@ee/components/billing/simulator/ContractSimulatorWorkspace";
import de from "../../../../../server/public/locales/de/msp/contracts.json";
import en from "../../../../../server/public/locales/en/msp/contracts.json";

type TranslationResource = Record<string, unknown>;

let resource: TranslationResource = en;

vi.mock("@alga-psa/ui/lib/i18n/client", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      let translated: unknown = resource;
      for (const segment of key.split(".")) {
        translated =
          translated && typeof translated === "object"
            ? (translated as TranslationResource)[segment]
            : undefined;
      }
      let value = String(
        typeof translated === "string"
          ? translated
          : (options?.defaultValue ?? key),
      );
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

vi.mock("@alga-psa/billing/actions/contractSimulationActions", () => ({
  getContractScenarioSnapshot: vi.fn(),
  getContractSimulationReplayAssumptions: vi.fn(),
  getRecentContractSimulationAssumptions: vi.fn(),
  runContractSimulation: vi.fn(async () => ({
    scenario_id: "s1",
    currency_code: "USD",
    horizon: { start_date: "2026-07-01T00:00:00Z", period_count: 6 },
    periods: [],
    diagnostics: [
      {
        severity: "error",
        code: "CONTRACT_SIMULATION_UNSUPPORTED_SERVICE_CONFIGURATION",
        message: "English fallback",
        message_key:
          "msp/contracts:contractSimulator.errors.unsupportedServiceConfiguration",
        message_params: {
          serviceName: "Magic Service",
          lineName: "Managed Support",
          configurationType: "Mystery",
        },
        line_key: "line-1",
        service_name: "Magic Service",
        configuration_type: "Mystery",
      },
    ],
  })),
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
  default: ({
    id,
    options,
    value,
  }: {
    id: string;
    options: Array<{ value: string; label: string }>;
    value: string;
  }) => (
    <select id={id} value={value} onChange={() => undefined}>
      {options.map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock("@ee/components/billing/simulator/AssumptionsPanel", () => ({ default: () => null }));
vi.mock("@ee/components/billing/simulator/ScenarioPanel", () => ({ default: () => null }));
vi.mock("@ee/components/billing/simulator/SimulationTimeline", () => ({ default: () => <div data-testid="timeline" /> }));
vi.mock("@ee/components/billing/simulator/SimulatedInvoiceDetail", () => ({ default: () => <div data-testid="invoice-detail" /> }));
vi.mock("@ee/components/billing/simulator/ChargeExplanationPanel", () => ({ default: () => null }));

const scenario = {
  client_binding: { kind: "client", client_id: "client-1", client_name: "Client" },
  currency_code: "USD",
  horizon: { period_count: 6 },
  lines: [],
  available_services: [],
  pricing_schedules: [],
  discounts: [],
  adjustments: [],
  assumptions: {},
} as unknown as ContractScenario;

describe("contract simulator blocked result", () => {
  afterEach(() => {
    resource = en;
  });

  it("shows the readable blocking message, and no totals or timeline, in every real locale", async () => {
    for (const loadedResource of [en, de]) {
      resource = loadedResource;
      const { unmount } = render(
        <ContractSimulatorWorkspace initialScenario={scenario} readOnlyScenario />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button"));
      });
      const callout = await screen.findByRole("alert");
      expect(callout).toHaveTextContent("Magic Service");
      expect(callout).toHaveTextContent("Managed Support");
      expect(callout).toHaveTextContent("Mystery");
      expect(callout).not.toHaveTextContent("English fallback");
      expect(screen.queryByTestId("timeline")).toBeNull();
      expect(screen.queryByTestId("invoice-detail")).toBeNull();
      expect(screen.queryByText(/Simulation current|Simulation aktuell/)).toBeNull();
      unmount();
    }
  });
});
