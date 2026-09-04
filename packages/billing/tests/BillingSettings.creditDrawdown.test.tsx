/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const searchParamsState = vi.hoisted(() => ({
  params: null as URLSearchParams | null,
}));
const useCollapsiblePreferenceMock = vi.hoisted(() =>
  vi.fn(() => [false, () => {}] as [boolean, (v: boolean | ((p: boolean) => boolean)) => void])
);

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsState.params,
}));

vi.mock("next/dynamic", () => ({
  default: () => function MockDynamic() {
    return null;
  },
}));

vi.mock("@alga-psa/ui/hooks", () => ({
  useCollapsiblePreference: (...args: unknown[]) => useCollapsiblePreferenceMock(...args),
}));

vi.mock("@alga-psa/ui/lib/i18n/client", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock("@alga-psa/ui/components/CustomTabs", () => ({
  default: ({ tabs, defaultTab }: { tabs: Array<{ id: string; label: string; content: React.ReactNode }>; defaultTab: string }) => {
    const active = tabs.find((tab) => tab.id === defaultTab) ?? tabs[0];
    return (
      <div>
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab">
            {tab.label}
          </button>
        ))}
        <div>{active?.content ?? null}</div>
      </div>
    );
  },
  TabContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../src/components/settings/billing/DefaultCurrencySettings", () => ({
  default: () => null,
}));
vi.mock("../src/components/settings/billing/ZeroDollarInvoiceSettings", () => ({
  default: () => null,
}));
vi.mock("../src/components/settings/billing/CreditExpirationSettings", () => ({
  default: () => null,
}));
vi.mock("../src/components/settings/billing/CreditDrawdownSettings", () => ({
  default: () => <div data-testid="credit-drawdown-settings" />,
}));
vi.mock("../src/components/settings/billing/RenewalAutomationSettings", () => ({
  default: () => null,
}));
vi.mock("../src/components/settings/billing/CostRatesSettings", () => ({
  default: () => null,
}));
vi.mock("../src/components/settings/tax/TaxSourceSettings", () => ({
  TaxSourceSettings: () => null,
}));
vi.mock("../src/components/settings/tax/TaxRegionsManager", () => ({
  TaxRegionsManager: () => null,
}));
vi.mock("../src/components/tax/TaxDelegationBanner", () => ({
  default: () => null,
}));
vi.mock("@alga-psa/reference-data/components/settings/NumberingSettings", () => ({
  default: () => null,
}));

describe("BillingSettings credit draw-down", () => {
  let BillingSettings: React.ComponentType;

  beforeAll(async () => {
    BillingSettings = (await import("../src/components/settings/billing/BillingSettings")).default;
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsState.params = new URLSearchParams();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the credit draw-down controls", async () => {
    render(<BillingSettings />);

    expect(await screen.findByTestId("credit-drawdown-settings")).toBeInTheDocument();
  });
});
