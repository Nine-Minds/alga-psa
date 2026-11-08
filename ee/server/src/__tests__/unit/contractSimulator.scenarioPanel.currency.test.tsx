// @vitest-environment jsdom
// alga0002089: simulator rate inputs follow the simulator's working currency
// (a EUR contract in a USD tenant shows "€") and rate labels carry no glyph.
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioLine } from "@alga-psa/types";
import ScenarioPanel from "@ee/components/billing/simulator/ScenarioPanel";

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€" };

vi.mock("@alga-psa/ui/lib", () => ({
  useCurrencyFormat: () => ({
    symbol: (currency?: string) =>
      currency ? SYMBOLS[currency] : "TENANT-DEFAULT",
  }),
}));

vi.mock("@alga-psa/ui/lib/i18n/client", () => ({
  useOptionalI18n: () => ({ locale: "en" }),
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
  useFormatters: () => ({ formatCurrency: (v: number) => String(v) }),
}));

vi.mock("@alga-psa/ui/components/Button", () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => <button {...props}>{children}</button>,
}));

const line: ScenarioLine = {
  key: "line-1",
  origin_contract_line_id: "line-1",
  contract_line_name: "Hourly plan",
  contract_line_type: "Hourly",
  billing_frequency: "monthly",
  billing_timing: "arrears",
  cadence_owner: "client",
  custom_rate: null,
  enable_proration: false,
  location_id: null,
  enable_overtime: true,
  overtime_threshold: 40,
  overtime_rate: 9000,
  services: [
    {
      configuration_id: "cfg-usage",
      service_id: "usage-1",
      service_name: "Endpoints",
      quantity: 1,
      custom_rate: 250,
      default_rate: 300,
      legacy_default_rate: 300,
      service_quantity: 1,
      service_custom_rate: null,
      configuration_quantity: 1,
      configuration_custom_rate: 250,
      tax_rate_id: null,
      item_kind: null,
      is_license: false,
      configuration: {
        configuration_type: "Usage",
        unit_of_measure: "endpoint",
        enable_tiered_pricing: true,
        minimum_usage: null,
        base_rate: 250,
        tiers: [{ min_quantity: 0, max_quantity: null, rate: 250 }],
      },
    },
  ],
};

function renderPanel(currencyCode: string) {
  const result = render(
    <ScenarioPanel
      lines={[line]}
      pristineLines={[line]}
      availableServices={[]}
      pricingSchedules={[
        { effective_date: "2026-01-01", end_date: null, custom_rate: 1000 },
      ]}
      discounts={[]}
      adjustments={[{ description: "Fee", amount: 500 }]}
      currencyCode={currencyCode}
      modifiedLineKeys={new Set()}
      hasModifications={false}
      focusedLineKey={null}
      onRateChange={vi.fn()}
      onResetAll={vi.fn()}
      onLinesChange={vi.fn()}
      onPricingSchedulesChange={vi.fn()}
      onDiscountsChange={vi.fn()}
      onAdjustmentsChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("Edit rules"));
  return result;
}

describe("ScenarioPanel currency", () => {
  it("puts the euro sign on overtime, tier, schedule and adjustment inputs for a EUR scenario", () => {
    const { container } = renderPanel("EUR");
    const adornments = [
      ...container.querySelectorAll('[data-testid="currency-adornment"]'),
    ];
    expect(adornments.map((el) => el.textContent)).toEqual([
      "€",
      "€",
      "€",
      "€",
    ]);
    const overtime = container.querySelector(
      'input[aria-label="Overtime rate per hour"]',
    )!;
    expect(
      overtime.parentElement!.querySelector('[data-testid="currency-adornment"]')!
        .textContent,
    ).toBe("€");
  });

  it("has no currency glyph in labels, placeholders, aria text or column headers", () => {
    const { container } = renderPanel("EUR");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\(\s*[$€]|[$€]\s*\/|dollars/);
    const attrs = [...container.querySelectorAll("[aria-label],[placeholder]")]
      .map((el) => `${el.getAttribute("aria-label")} ${el.getAttribute("placeholder")}`)
      .join(" ");
    expect(attrs).not.toMatch(/\$|€|\(\s*\$/);
  });
});
