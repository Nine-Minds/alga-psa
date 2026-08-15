// @vitest-environment jsdom
import React, { useMemo, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ScenarioLine,
  ScenarioLineService,
  ScenarioPricingSchedule,
} from "@alga-psa/types";
import ScenarioPanel from "@ee/components/billing/simulator/ScenarioPanel";

vi.mock("@alga-psa/ui/lib/i18n/client", () => ({
  useOptionalI18n: () => ({ locale: "en" }),
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
  useFormatters: () => ({
    formatCurrency: (value: number, currency: string) =>
      new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
        value,
      ),
  }),
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

const usageService: ScenarioLineService = {
  configuration_id: "cfg-usage",
  service_id: "usage-1",
  service_name: "Managed endpoints",
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
    enable_tiered_pricing: false,
    minimum_usage: null,
    base_rate: 250,
    tiers: [],
  },
};

const initialLine: ScenarioLine = {
  key: "line-1",
  origin_contract_line_id: "line-1",
  contract_line_name: "Usage plan",
  contract_line_type: "Usage",
  billing_frequency: "monthly",
  billing_timing: "arrears",
  cadence_owner: "client",
  custom_rate: null,
  enable_proration: false,
  location_id: null,
  enable_overtime: false,
  overtime_threshold: null,
  overtime_rate: null,
  services: [usageService],
};

function Harness() {
  const pristine = useMemo(() => [structuredClone(initialLine)], []);
  const [lines, setLines] = useState(() => structuredClone(pristine));
  const [schedules, setSchedules] = useState<ScenarioPricingSchedule[]>([]);
  const modified = new Set(
    lines
      .filter(
        (line) =>
          JSON.stringify(line) !==
          JSON.stringify(
            pristine.find((candidate) => candidate.key === line.key),
          ),
      )
      .map((line) => line.key),
  );
  const onRateChange = (
    lineKey: string,
    serviceId: string | null,
    configurationType:
      | ScenarioLineService["configuration"]["configuration_type"]
      | null,
    cents: number | null,
  ) => {
    const next = structuredClone(lines);
    const line = next.find((candidate) => candidate.key === lineKey);
    if (!line) return;
    if (serviceId === null) line.custom_rate = cents;
    const service = line.services.find(
      (candidate) =>
        candidate.service_id === serviceId &&
        candidate.configuration.configuration_type === configurationType,
    );
    if (service?.configuration.configuration_type === "Usage") {
      service.configuration.base_rate = cents;
    }
    setLines(next);
  };
  return (
    <ScenarioPanel
      lines={lines}
      pristineLines={pristine}
      availableServices={[
        {
          service_id: "product-1",
          service_name: "Security license",
          currency_rate: 900,
          legacy_default_rate: 900,
          tax_rate_id: null,
          item_kind: "product",
          is_license: true,
        },
      ]}
      pricingSchedules={schedules}
      discounts={[]}
      adjustments={[]}
      currencyCode="USD"
      modifiedLineKeys={modified}
      hasModifications={
        JSON.stringify(lines) !== JSON.stringify(pristine) ||
        schedules.length > 0
      }
      focusedLineKey={null}
      onRateChange={onRateChange}
      onResetAll={() => {
        setLines(structuredClone(pristine));
        setSchedules([]);
      }}
      onLinesChange={setLines}
      onPricingSchedulesChange={setSchedules}
      onDiscountsChange={vi.fn()}
      onAdjustmentsChange={vi.fn()}
    />
  );
}

describe("contract simulator ScenarioPanel", () => {
  it("T016 edits and resets the complete in-memory scenario surface", () => {
    render(<Harness />);

    expect(screen.getByText("Pricing schedules")).not.toBeVisible();
    fireEvent.click(screen.getByText("Edit rules"));
    fireEvent.change(screen.getByLabelText("Contract line name"), {
      target: { value: "Edited usage plan" },
    });
    fireEvent.change(screen.getByLabelText("Billing frequency"), {
      target: { value: "quarterly" },
    });
    fireEvent.change(screen.getByLabelText("Billing timing"), {
      target: { value: "advance" },
    });
    fireEvent.change(screen.getByLabelText("Cadence owner"), {
      target: { value: "contract" },
    });
    fireEvent.click(
      screen
        .getByLabelText("Contract line name")
        .closest("div")!
        .parentElement!.querySelector('input[type="checkbox"]')!,
    );

    fireEvent.click(screen.getByText("tiered pricing"));
    fireEvent.click(screen.getByText("+ add tier"));
    expect(screen.getByLabelText("Tier minimum")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tier rate dollars"), {
      target: { value: "4.25" },
    });

    fireEvent.change(screen.getByLabelText("Add catalog service"), {
      target: { value: "product-1" },
    });
    expect(screen.getByText("Security license")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Configuration type")[1]).toBeDisabled();
    expect(screen.queryByLabelText("Service quantity")).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("License or product quantity"),
    ).toBeInTheDocument();
    const productRate = document.getElementById("edit-rate-line-1-product-1")!;
    fireEvent.click(productRate);
    const productRateInput = document.getElementById(
      "edit-rate-line-1-product-1-input",
    ) as HTMLInputElement;
    fireEvent.change(productRateInput, { target: { value: "12.34" } });
    fireEvent.blur(productRateInput);
    expect(
      document.getElementById("edit-rate-line-1-product-1"),
    ).toHaveTextContent("$12.34");

    fireEvent.click(screen.getByText("Advanced contract changes"));
    fireEvent.click(screen.getByText("+ add schedule"));
    expect(
      screen.getByLabelText("Schedule effective date"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByDisplayValue("Usage plan")).toBeInTheDocument();
    expect(screen.queryByText("Security license")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    expect(
      screen.queryByLabelText("Schedule effective date"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByDisplayValue("Usage plan")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    fireEvent.click(screen.getByText("Scenario line 1"));
    expect(screen.getByDisplayValue("Scenario line 1")).toBeInTheDocument();
    const addedLine = screen
      .getByDisplayValue("Scenario line 1")
      .closest("div")!;
    const resetAdded = within(addedLine).getByRole("button", { name: "Reset" });
    expect(resetAdded).toBeEnabled();
    fireEvent.click(resetAdded);
    expect(
      screen.queryByDisplayValue("Scenario line 1"),
    ).not.toBeInTheDocument();
  });
});
