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
    t: (_key: string, options?: { defaultValue?: string; [key: string]: unknown }) =>
      (options?.defaultValue ?? _key).replace(/\{\{(\w+)\}\}/g, (_, key) => String(options?.[key] ?? "")),
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

function Harness({ initialLines = [initialLine], initialSchedules = [], currencyCode = 'USD' }: { initialLines?: ScenarioLine[]; initialSchedules?: ScenarioPricingSchedule[]; currencyCode?: string }) {
  const pristine = useMemo(() => structuredClone(initialLines), []);
  const [lines, setLines] = useState(() => structuredClone(pristine));
  const [schedules, setSchedules] = useState<ScenarioPricingSchedule[]>(initialSchedules);
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
    <>
    <div data-testid="schedule-state">{JSON.stringify(schedules)}</div>
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
      currencyCode={currencyCode}
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
    </>
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
    // Usage lines always bill in arrears: no timing select, read-only value.
    expect(screen.queryByLabelText("Billing timing")).not.toBeInTheDocument();
    expect(screen.getByText("Bill in arrears")).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("Tier rate"), {
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
    expect(screen.getByText("+ add schedule")).toBeDisabled();
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

function fixedLine(key: string, itemKind = 'service', basis: 'unit' | 'bundle' = 'bundle'): ScenarioLine {
  return {
    ...initialLine, key, contract_line_name: key, contract_line_type: 'Fixed',
    services: [{ ...usageService, item_kind: itemKind, configuration: {
      configuration_type: 'Fixed', pricing_basis: basis, base_rate: 50000,
    } as any }],
  };
}

function scheduleState() {
  return JSON.parse(screen.getByTestId('schedule-state').textContent!);
}

describe('simulator schedule line selection', () => {
  it.each([
    ['JPY', 900, '950', 950, '1'],
    ['KWD', 0.9, '0.951', 951, '0.001'],
    ['USD', 9, '9.51', 951, '0.01'],
  ])('round-trips schedule edits in %s minor units', (currencyCode, displayed, edited, stored, step) => {
    render(<Harness currencyCode={currencyCode} initialLines={[fixedLine('line-a'), fixedLine('line-b')]} initialSchedules={[
      { effective_date: '2026-06-01', end_date: null, custom_rate: 900 },
    ]} />);
    const input = screen.getByLabelText('Schedule rate');
    expect(input).toHaveValue(displayed);
    expect(input).toHaveAttribute('step', step);
    fireEvent.change(input, { target: { value: edited } });
    expect(scheduleState()[0]).toEqual({ effective_date: '2026-06-01', end_date: null, custom_rate: stored });
    expect(input).toHaveValue(Number(edited));
    fireEvent.change(input, { target: { value: '' } });
    expect(scheduleState()[0].custom_rate).toBeNull();
    expect(input).toHaveValue(null);
    fireEvent.change(input, { target: { value: '0' } });
    expect(scheduleState()[0].custom_rate).toBe(0);
    expect(input).toHaveValue(0);
    fireEvent.change(screen.getByLabelText('Applies To'), { target: { value: 'line-a' } });
    fireEvent.change(input, { target: { value: edited } });
    expect(scheduleState()[0]).toEqual({ effective_date: '2026-06-01', end_date: null, custom_rate: stored, contract_line_key: 'line-a' });
    expect(input).toHaveValue(Number(edited));
  });

  it('preselects a non-product fallback service and excludes ineligible lines', () => {
    const fallback: ScenarioLine = {
      ...fixedLine('fallback'), custom_rate: 50000,
      services: [{ ...usageService, item_kind: 'service' }],
    };
    const unitOnly = fixedLine('units', 'service', 'unit');
    unitOnly.services.push({ ...usageService, item_kind: 'service' });
    render(<Harness initialLines={[
      fallback, unitOnly, initialLine,
      { ...fallback, key: 'product', contract_line_name: 'product', services: [{ ...usageService, item_kind: 'product' }] },
      { ...fallback, key: 'unknown', contract_line_name: 'unknown', services: [{ ...usageService, item_kind: null }] },
      { ...fixedLine('empty'), services: [] },
    ]} />);
    const picker = screen.getByLabelText('Applies to');
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['Select a fixed-fee line', 'fallback']);
    expect(picker).toHaveValue('fallback');
    fireEvent.click(screen.getByText('+ add schedule'));
    expect(scheduleState()[0].contract_line_key).toBe('fallback');
  });

  it('counts fallback lines in legacy warnings and offers them for explicit re-scoping', () => {
    const fallback: ScenarioLine = {
      ...fixedLine('fallback'), custom_rate: 50000,
      services: [{ ...usageService, item_kind: 'service' }],
    };
    render(<Harness initialLines={[fixedLine('line-a'), fixedLine('line-b'), fallback]} initialSchedules={[
      { effective_date: '2026-06-01', end_date: null, custom_rate: 90000 },
    ]} />);
    expect(screen.getByRole('status')).toHaveTextContent('fallback fee of $900.00 per active fixed-fee line per billing period (3 lines)');
    expect(screen.getByText('+ add schedule')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: 'fallback' } });
    fireEvent.click(screen.getByText('+ add schedule'));
    expect(scheduleState()[1].contract_line_key).toBe('fallback');
    expect(scheduleState()[0].contract_line_key).toBeUndefined();
    fireEvent.change(screen.getAllByLabelText('Applies To')[0], { target: { value: 'fallback' } });
    expect(scheduleState()[0].contract_line_key).toBe('fallback');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('option', { name: 'Whole contract' })).toBeNull();
  });

  it.each([
    ['JPY', '¥900'], ['KWD', 'KWD\u00a00.900'],
  ])('formats legacy schedule minor units in %s', (currencyCode, amount) => {
    render(<Harness currencyCode={currencyCode} initialLines={[fixedLine('line-a'), fixedLine('line-b')]} initialSchedules={[
      { effective_date: '2026-06-01', end_date: null, custom_rate: 900 },
    ]} />);
    expect(screen.getByRole('status').textContent).toContain(`fallback fee of ${amount} per active fixed-fee line per billing period (2 lines)`);
  });

  it('counts only active fixed-fee lines while retaining inactive schedule bindings', () => {
    render(<Harness initialLines={[
      { ...fixedLine('line-a'), is_active: true },
      { ...fixedLine('line-b'), is_active: true },
      { ...fixedLine('inactive'), is_active: false },
    ]} initialSchedules={[
      { effective_date: '2026-06-01', end_date: null, custom_rate: 90000 },
      { effective_date: '2026-06-01', end_date: null, custom_rate: 70000, contract_line_key: 'inactive' },
    ]} />);
    expect(screen.getByRole('status')).toHaveTextContent('fallback fee of $900.00 per active fixed-fee line per billing period (2 lines)');
    expect(screen.getAllByLabelText('Applies To')[1]).toHaveValue('inactive');
    fireEvent.change(screen.getAllByLabelText('Schedule rate')[1], { target: { value: '750' } });
    expect(scheduleState()[1]).toMatchObject({ contract_line_key: 'inactive', custom_rate: 75000 });
    expect(scheduleState()[0].contract_line_key).toBeUndefined();
  });

  it('omits the multi-line effect when only one eligible line is active', () => {
    render(<Harness initialLines={[
      { ...fixedLine('active'), is_active: true },
      { ...fixedLine('inactive-fallback'), is_active: false, services: [{ ...usageService, item_kind: 'service' }] },
    ]} initialSchedules={[
      { effective_date: '2026-06-01', end_date: null, custom_rate: 90000 },
    ]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Whole contract: fallback schedule for active fixed-fee lines.');
    expect(screen.getByRole('status')).not.toHaveTextContent('(2 lines)');
  });

  it('preselects the only eligible line and never authors whole-contract scope', () => {
    render(<Harness initialLines={[fixedLine('bundle'), fixedLine('product', 'product'), fixedLine('units', 'service', 'unit')]} />);
    const picker = screen.getByLabelText('Applies to');
    expect(picker).toHaveValue('bundle');
    expect(within(picker).queryByRole('option', { name: 'product' })).toBeNull();
    expect(within(picker).queryByRole('option', { name: 'units' })).toBeNull();
    expect(within(picker).queryByRole('option', { name: 'Whole contract' })).toBeNull();
    fireEvent.click(screen.getByText('+ add schedule'));
    expect(scheduleState()[0].contract_line_key).toBe('bundle');
  });

  it('requires a choice for multiple lines and identifies imported scope', () => {
    render(<Harness initialLines={[fixedLine('line-a'), fixedLine('line-b')]} initialSchedules={[
      { effective_date: '2026-06-01', end_date: null, custom_rate: 90000, contract_line_key: 'line-a' },
    ]} />);
    expect(screen.getByLabelText('Applies To')).toHaveValue('line-a');
    expect(screen.getByText('+ add schedule')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: 'line-b' } });
    fireEvent.click(screen.getByText('+ add schedule'));
    expect(scheduleState().map((row: ScenarioPricingSchedule) => row.contract_line_key)).toEqual(['line-a', 'line-b']);
    fireEvent.change(screen.getAllByLabelText('Applies To')[0], { target: { value: 'line-b' } });
    expect(scheduleState()[0].contract_line_key).toBe('line-b');
  });

  it('qualifies the legacy fee when an overlapping line-specific schedule wins', () => {
    render(<Harness initialLines={[fixedLine('line-a'), fixedLine('line-b')]} initialSchedules={[
      { effective_date: '2026-06-01', end_date: null, custom_rate: 90000 },
      { effective_date: '2026-06-01', end_date: null, custom_rate: 70000, contract_line_key: 'line-a' },
    ]} />);
    expect(screen.getByRole('status')).toHaveTextContent('fallback fee of $900.00');
    expect(screen.getByRole('status')).toHaveTextContent('Line-specific schedules take precedence.');
    expect(screen.getByRole('status')).not.toHaveTextContent('each of the 2 fixed-fee lines bills');
    expect(screen.getAllByLabelText('Schedule rate')[1]).toHaveValue(700);
    expect(scheduleState()[0].contract_line_key).toBeUndefined();
  });

  it('flags legacy scope with eligible counts and preserves it until explicitly re-scoped', () => {
    render(<Harness initialLines={[fixedLine('line-a'), fixedLine('line-b'), fixedLine('product', 'product')]} initialSchedules={[
      { effective_date: '2026-06-01', end_date: null, custom_rate: 90000 },
    ]} />);
    expect(screen.getByRole('status')).toHaveTextContent('fallback fee of $900.00 per active fixed-fee line per billing period (2 lines)');
    fireEvent.change(screen.getByLabelText('Schedule rate'), { target: { value: '950' } });
    expect(scheduleState()[0].contract_line_key).toBeUndefined();
    fireEvent.change(screen.getByLabelText('Applies To'), { target: { value: 'line-a' } });
    expect(scheduleState()[0].contract_line_key).toBe('line-a');
    expect(screen.queryByRole('option', { name: 'Whole contract' })).toBeNull();
  });

  it('disables authoring when no bundle fee exists', () => {
    render(<Harness initialLines={[fixedLine('product', 'product'), { ...fixedLine('empty'), services: [] }]} />);
    expect(screen.getByText('+ add schedule')).toBeDisabled();
    expect(screen.getByText('This contract has no fixed-fee line, so a pricing schedule has nothing to reprice.')).toBeInTheDocument();
  });
});
