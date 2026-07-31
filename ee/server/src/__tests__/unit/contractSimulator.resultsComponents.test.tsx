// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ContractScenario,
  SimulatedInvoiceLine,
  SimulatedPeriod,
} from "@alga-psa/types";
import AssumptionsPanel from "@ee/components/billing/simulator/AssumptionsPanel";
import SimulationTimeline from "@ee/components/billing/simulator/SimulationTimeline";
import SimulatedInvoiceDetail from "@ee/components/billing/simulator/SimulatedInvoiceDetail";
import ChargeExplanationPanel from "@ee/components/billing/simulator/ChargeExplanationPanel";

vi.mock("@alga-psa/ui/lib/i18n/client", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) => {
      let value = String(options?.defaultValue ?? _key);
      for (const [key, replacement] of Object.entries(options ?? {})) {
        value = value.replaceAll(`{{${key}}}`, String(replacement));
      }
      return value;
    },
  }),
  useFormatters: () => ({
    formatCurrency: (value: number, currency: string) =>
      new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
        value,
      ),
    formatDate: (value: string, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: options?.timeZone ?? "America/New_York",
        ...options,
      }).format(new Date(value)),
  }),
}));

vi.mock("@alga-psa/ui/components/Button", () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@alga-psa/ui/components/Badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));
vi.mock(
  "@alga-psa/billing/components/billing-dashboard/TemplateRenderer",
  () => ({
    TemplateRenderer: ({ invoiceData }: any) => (
      <div data-testid="rendered-invoice">{invoiceData.invoiceNumber}</div>
    ),
  }),
);

const explanation = {
  chargeKey: "cfg:service",
  serviceName: "Remote support",
  chargeType: "time",
  inputs: [
    { label: "Rate", value: "$150.00 / hr" },
    { label: "Hours", value: "2 hrs" },
  ],
  steps: ["2 hrs × $150.00 = $300.00"],
  note: "Rounded to the nearest 15 minutes.",
  markers: ["rounding_applied" as const],
};

const invoiceLine: SimulatedInvoiceLine = {
  line_key: "line-1",
  service_id: "service-1",
  service_name: "Remote support",
  charge_type: "time",
  quantity_label: "2 hrs",
  rate_label: "$150.00",
  quantity: 2,
  unit_price: 15000,
  net_amount: 30000,
  tax_amount: 3000,
  total: 33000,
  explanation,
  billing_timing: "arrears",
  service_period_start: "2026-07-01T00:00:00Z",
  service_period_end: "2026-07-31T00:00:00Z",
};

const viewModel = (number: string) => ({
  invoiceNumber: number,
  issueDate: "2026-08-01",
  dueDate: "2026-08-31",
  currencyCode: "USD",
  customer: { name: "Client", address: "N/A" },
  tenantClient: null,
  items: [],
  subtotal: 30000,
  tax: 3000,
  total: 33000,
});

const periods: SimulatedPeriod[] = [
  {
    index: 0,
    period_start: "2026-08-01T00:00:00Z",
    period_end: "2026-08-31T00:00:00Z",
    label: "August",
    lines: [invoiceLine],
    subtotal: 30000,
    tax: 3000,
    total: 33000,
    markers: ["prorated"],
    invoice_view_model: viewModel("SIM-1"),
  },
  {
    index: 1,
    period_start: "2026-09-01T00:00:00Z",
    period_end: "2026-09-30T00:00:00Z",
    label: "September",
    lines: [invoiceLine],
    subtotal: 40000,
    tax: 4000,
    total: 44000,
    markers: ["bucket_overage", "cadence_coincidence"],
    invoice_view_model: viewModel("SIM-2"),
  },
];

describe("contract simulator result components", () => {
  it("T017 renders timeline deltas and markers and selects a period", () => {
    const onSelect = vi.fn();
    render(
      <SimulationTimeline
        periods={periods}
        baselinePeriods={[{ ...periods[0], total: 30000 }, periods[1]]}
        currencyCode="USD"
        selectedIndex={0}
        onSelectPeriod={onSelect}
      />,
    );
    expect(screen.getByText("Prorated")).toBeInTheDocument();
    expect(screen.getByText("Bucket overage")).toBeInTheDocument();
    expect(
      screen.getByText("+$110.00 from August invoice"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("+$30.00 from current contract"),
    ).toBeInTheDocument();
    expect(screen.getByText("Aug 1 – Aug 31")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /September/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("T017 renders service timing, comparisons, previews, replay, and explanation interaction", () => {
    const onExplain = vi.fn();
    const { rerender } = render(
      <SimulatedInvoiceDetail
        period={periods[0]}
        currencyCode="USD"
        selectedChargeKey={null}
        lineDeltas={[
          {
            line_key: "line-1",
            service_id: "service-1",
            charge_type: "time",
            service_name: "Remote support",
            kind: "changed",
            delta: 5000,
          },
          {
            line_key: "removed",
            service_id: "old",
            charge_type: "fixed",
            service_name: "Old service",
            kind: "removed",
            delta: -1000,
          },
        ]}
        template={{ template_id: "template" } as any}
        actualInvoice={{
          invoice_id: "invoice-1",
          invoice_number: "INV-1",
          status: "paid",
          period_start: periods[0].period_start,
          period_end: periods[0].period_end,
          lines: [{ ...invoiceLine, total: 30000 }],
          subtotal: 27000,
          tax: 3000,
          total: 30000,
          invoice_view_model: viewModel("INV-1"),
        }}
        onExplainLine={onExplain}
      />,
    );
    expect(screen.getByText(/Changed/)).toBeInTheDocument();
    expect(
      screen.getByText(/Service period: Jul 1, 2026 – Jul 31, 2026/),
    ).toBeInTheDocument();
    expect(screen.getByText("Old service")).toBeInTheDocument();
    for (const preview of screen.getAllByTestId("rendered-invoice")) {
      expect(preview).not.toBeVisible();
    }
    fireEvent.click(screen.getByText("Preview invoice layout"));
    fireEvent.click(screen.getByText("Preview issued invoice"));
    expect(screen.getAllByTestId("rendered-invoice")).toHaveLength(2);
    expect(screen.getByText(/Issued invoice INV-1/)).toBeInTheDocument();
    expect(screen.getByText(/Billed in arrears/)).toBeInTheDocument();
    expect(screen.getByText(/Aug 1, 2026 – Aug 31, 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Show how this amount was computed"));
    expect(onExplain).toHaveBeenCalledWith(invoiceLine);

    const close = vi.fn();
    rerender(
      <ChargeExplanationPanel
        line={invoiceLine}
        currencyCode="USD"
        onClose={close}
      />,
    );
    expect(screen.getByText("2 hrs × $150.00 = $300.00")).toBeInTheDocument();
    expect(
      screen.getByText("Rounded to the nearest 15 minutes."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("T017 edits flat and per-period assumptions and invokes prefill actions", () => {
    const scenario = {
      client_binding: {
        kind: "client",
        client_id: "client",
        client_name: "Client",
      },
      lines: [
        {
          ...({} as any),
          key: "line-1",
          services: [
            {
              ...({} as any),
              service_id: "service-1",
              service_name: "Remote support",
              item_kind: null,
              configuration: {
                configuration_type: "Hourly",
                hourly_rate: 15000,
                minimum_billable_time: 0,
                round_up_to_nearest: 0,
                user_type_rates: [],
              },
            },
          ],
        },
      ],
      assumptions: { "line-1:service-1": { flat: 2 } },
    } as unknown as ContractScenario;
    const flat = vi.fn();
    const override = vi.fn();
    const recent = vi.fn();
    const replay = vi.fn();
    const { rerender } = render(
      <AssumptionsPanel
        scenario={scenario}
        periodCount={2}
        periodLabels={["Aug", "Sep"]}
        onFlatChange={flat}
        onOverrideChange={override}
        onUseRecentAverages={recent}
        onReplay={replay}
        isPrefilling={false}
        prefillError={null}
        prefillFeedback={null}
      />,
    );
    fireEvent.change(
      screen.getByLabelText(
        "Projected hrs per service period — Remote support",
      ),
      { target: { value: "3" } },
    );
    expect(flat).toHaveBeenCalledWith("line-1:service-1", 3);
    fireEvent.click(screen.getByText("Set activity for each invoice"));
    fireEvent.change(
      document.getElementById("assumption-override-line-1-service-1-0")!,
      {
        target: { value: "4" },
      },
    );
    expect(override).toHaveBeenCalledWith("line-1:service-1", 0, 4);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Use average from last 3 billing periods",
      }),
    );
    expect(recent).toHaveBeenCalledOnce();
    fireEvent.change(document.getElementById("simulation-replay-start")!, {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(document.getElementById("simulation-replay-end")!, {
      target: { value: "2026-08-31" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Load activity and invoices" }),
    );
    expect(replay).toHaveBeenCalledWith("2026-08-01", "2026-08-31");

    rerender(
      <AssumptionsPanel
        scenario={scenario}
        periodCount={2}
        periodLabels={["Aug", "Sep"]}
        onFlatChange={flat}
        onOverrideChange={override}
        onUseRecentAverages={recent}
        onReplay={replay}
        isPrefilling={false}
        prefillError={null}
        prefillFeedback={{
          kind: "recent_average",
          periodLabels: [
            "2026-05-01 – 2026-05-31",
            "2026-06-01 – 2026-06-30",
            "2026-07-01 – 2026-07-31",
          ],
          actualInvoiceCount: 0,
          requiresProjectionUpdate: true,
          changed: {
            "line-1:service-1": {
              before: { flat: 2 },
              after: { flat: 3 },
            },
          },
        }}
      />,
    );
    expect(
      screen.getByText(/Activity average loaded from 2026-05-01 – 2026-07-31/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Loaded value: 2 → 3 hrs per service period/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Update the projection to recalculate invoices/),
    ).toBeInTheDocument();
  });
});
