// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContractScenario } from "@alga-psa/types";
import ContractSimulatorWorkspace from "@ee/components/billing/simulator/ContractSimulatorWorkspace";
import de from "../../../../../server/public/locales/de/msp/contracts.json";
import en from "../../../../../server/public/locales/en/msp/contracts.json";
import es from "../../../../../server/public/locales/es/msp/contracts.json";
import fr from "../../../../../server/public/locales/fr/msp/contracts.json";
import itLocale from "../../../../../server/public/locales/it/msp/contracts.json";
import nl from "../../../../../server/public/locales/nl/msp/contracts.json";
import pl from "../../../../../server/public/locales/pl/msp/contracts.json";
import pt from "../../../../../server/public/locales/pt/msp/contracts.json";
import xx from "../../../../../server/public/locales/xx/msp/contracts.json";
import yy from "../../../../../server/public/locales/yy/msp/contracts.json";

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
    diagnostics: [],
    periods: Array.from({ length: 6 }, (_, index) => ({
      index,
      label: `P${index + 1}`,
      total: 0,
    })),
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
vi.mock("@ee/components/billing/simulator/SimulationTimeline", () => ({ default: () => null }));
vi.mock("@ee/components/billing/simulator/SimulatedInvoiceDetail", () => ({ default: () => null }));
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

const resources = [
  [de, "6 Kundenabrechnungszeiträume", "Simulation aktuell · 6 Kundenabrechnungszeiträume"],
  [en, "6 client billing periods", "Simulation current · 6 client billing periods"],
  [es, "6 períodos de facturación del cliente", "Simulación al día · 6 períodos de facturación del cliente"],
  [fr, "6 périodes de facturation du client", "Simulation à jour · 6 périodes de facturation du client"],
  [itLocale, "6 periodi di fatturazione del cliente", "Simulazione aggiornata · 6 periodi di fatturazione del cliente"],
  [nl, "6 factureringsperioden van de klant", "Simulatie actueel · 6 factureringsperioden van de klant"],
  [pl, "6 okresów rozliczeniowych klienta", "Symulacja aktualna · 6 okresów rozliczeniowych klienta"],
  [pt, "6 períodos de faturamento do cliente", "Simulação atualizada · 6 períodos de faturamento do cliente"],
  [xx, "⟦6 ƈŀīḗƞŧ ƀīŀŀīƞɠ ƥḗřīȯḓş⟧", "⟦Şīḿŭŀȧŧīȯƞ ƈŭřřḗƞŧ · 6 ƈŀīḗƞŧ ƀīŀŀīƞɠ ƥḗřīȯḓş⟧"],
  [yy, "〖6 ƈŀīḗƞŧ ƀīŀŀīƞɠ ƥḗřīȯḓş ··········〗", "〖Şīḿŭŀȧŧīȯƞ ƈŭřřḗƞŧ · 6 ƈŀīḗƞŧ ƀīŀŀīƞɠ ƥḗřīȯḓş ···················〗"],
] as const;

describe("contract simulator run-bar locale resources", () => {
  afterEach(() => {
    resource = en;
  });

  it("T020 renders explicit client billing-period copy from every loaded locale resource", async () => {
    for (const [loadedResource, horizonOption, lastRun] of resources) {
      resource = loadedResource;
      const { unmount } = render(
        <ContractSimulatorWorkspace initialScenario={scenario} readOnlyScenario />,
      );

      expect(screen.getByRole("option", { name: horizonOption })).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole("button"));
      });
      expect(await screen.findByText(lastRun)).toBeInTheDocument();
      unmount();
    }
  });
});
