/**
 * @vitest-environment jsdom
 */
import React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";

const navigationState = vi.hoisted(() => ({
  params: null as URLSearchParams | null,
  push: vi.fn(),
  replace: vi.fn(),
}));
const featureFlagState = vi.hoisted(() => ({
  enabled: false,
  loading: true,
  error: null as Error | null,
}));
const useFeatureFlagMock = vi.hoisted(() => vi.fn(() => featureFlagState));
const tabsState = vi.hoisted(() => ({ activeValue: "edit" }));

const getContractByIdMock = vi.hoisted(() => vi.fn());
const getContractSummaryMock = vi.hoisted(() => vi.fn());
const getContractAssignmentsMock = vi.hoisted(() => vi.fn());
const updateContractMock = vi.hoisted(() => vi.fn());
const updateClientContractMock = vi.hoisted(() => vi.fn());
const guardMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigationState.push,
    replace: navigationState.replace,
  }),
  useSearchParams: () => navigationState.params,
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockContractSimulator() {
      return <div data-testid="contract-simulator-mounted" />;
    },
}));

vi.mock("@alga-psa/ui/hooks", () => ({
  useFeatureFlag: (...args: unknown[]) => useFeatureFlagMock(...args),
}));

vi.mock("@alga-psa/ui/components/Tabs", () => ({
  Tabs: ({ value, children }: { value: string; children: React.ReactNode }) => {
    tabsState.activeValue = value;
    return <div>{children}</div>;
  },
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => (
    <button type="button" role="tab" data-value={value}>
      {children}
    </button>
  ),
  TabsContent: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => {
    if (tabsState.activeValue !== value) {
      return null;
    }

    return <section data-testid={`tab-content-${value}`}>{children}</section>;
  },
}));

vi.mock("@alga-psa/ui", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), replaceDrawer: vi.fn() }),
}));

vi.mock("@alga-psa/ui/components/providers/TenantProvider", () => ({
  useTenant: () => "tenant-1",
}));

vi.mock("@alga-psa/ui/lib/i18n/client", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
  useOptionalI18n: () => null,
  useFormatters: () => ({
    formatCurrency: (value: number) => String(value),
    formatDate: (value: Date | string, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", options).format(new Date(value)),
  }),
}));

vi.mock("@alga-psa/core/context/DocumentsCrossFeatureContext", () => ({
  useDocumentsCrossFeature: () => ({
    getDocumentsByContractId: vi.fn(async () => []),
    renderDocuments: vi.fn(() => null),
  }),
}));

vi.mock("@alga-psa/billing/hooks/useBillingEnumOptions", () => ({
  useBillingFrequencyOptions: () => [
    { value: "monthly", label: "Monthly" },
    { value: "quarterly", label: "Quarterly" },
    { value: "annually", label: "Annually" },
  ],
}));

vi.mock("@alga-psa/billing/actions/contractActions", () => ({
  getContractById: (...args: unknown[]) => getContractByIdMock(...args),
  getContractSummary: (...args: unknown[]) => getContractSummaryMock(...args),
  getContractAssignments: (...args: unknown[]) =>
    getContractAssignmentsMock(...args),
  updateContract: (...args: unknown[]) => updateContractMock(...args),
  deleteContract: vi.fn(),
}));

vi.mock("@alga-psa/billing/actions/quoteActions", () => ({
  getQuoteByConvertedContractId: vi.fn(async () => null),
}));

vi.mock("@alga-psa/billing/actions/billingClientsActions", () => ({
  getClientContractByIdForBilling: vi.fn(async () => null),
  updateClientContractForBilling: (...args: unknown[]) =>
    updateClientContractMock(...args),
  getClientByIdForBilling: vi.fn(),
}));

vi.mock("@alga-psa/reference-data/actions/boardActions", () => ({
  getAllBoards: vi.fn(async () => []),
}));

vi.mock(
  "@alga-psa/reference-data/actions/status-actions/statusActions",
  () => ({
    getTicketStatuses: vi.fn(async () => []),
  }),
);

vi.mock("@alga-psa/billing/actions/invoiceQueries", () => ({
  fetchInvoicesByContract: vi.fn(async () => []),
}));

vi.mock("@alga-psa/billing/actions/invoiceTemplates", () => ({
  getInvoiceTemplates: vi.fn(async () => []),
}));

vi.mock("../src/components/billing-dashboard/contracts/ContractHeader", () => ({
  default: () => null,
}));

vi.mock("../src/components/billing-dashboard/contracts/ContractLines", () => ({
  default: () => null,
}));

vi.mock(
  "../src/components/billing-dashboard/contracts/ContractOverview",
  () => ({
    default: () => null,
  }),
);

vi.mock(
  "../src/components/billing-dashboard/contracts/PricingSchedules",
  () => ({
    default: () => null,
  }),
);

vi.mock(
  "../src/components/billing-dashboard/contracts/ContractDiscounts",
  () => ({
    default: () => null,
  }),
);

vi.mock(
  "../src/components/billing-dashboard/invoicing/InvoicePreviewPanel",
  () => ({
    default: () => null,
  }),
);

vi.mock("../src/hooks/useUnsavedNavigationGuard", () => ({
  useUnsavedNavigationGuard: (armed: boolean) => {
    guardMock(armed);
    return {
      showConfirm: false,
      confirmNavigation: vi.fn(),
      cancelNavigation: vi.fn(),
    };
  },
}));

const getPoInput = () =>
  screen.getByText("PO Number").parentElement!.querySelector("input") as HTMLInputElement;

if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
}

const BANNER = /You have unsaved changes\. Click "Save Changes"/;

const baseContract = {
  contract_id: "contract-1",
  contract_name: "CloudVBS managed services",
  contract_description: null,
  billing_frequency: "annually",
  currency_code: "AUD",
  is_template: false,
  is_system_managed_default: false,
  owner_client_id: "client-1",
  status: "active",
};

// Repro shape: wizard-created client contract, ongoing (end_date null), renewal
// mode value the UI does not recognise, renewal board/status unset.
const baseAssignment = {
  client_contract_id: "cc-1",
  contract_id: "contract-1",
  client_id: "client-1",
  client_name: "CloudVBS",
  start_date: "2025-01-01T00:00:00.000Z",
  end_date: null,
  assignment_status: "active",
  renewal_mode: "ongoing",
  use_tenant_renewal_defaults: undefined,
  notice_period_days: null,
  renewal_term_months: null,
  renewal_ticket_board_id: null,
  renewal_ticket_status_id: null,
  po_required: false,
  po_number: null,
  po_amount: null,
};

describe("ContractDetail unsaved-changes banner", () => {
  let ContractDetail: React.ComponentType<{ resolvedContractId?: string | null }>;

  beforeAll(async () => {
    ContractDetail = (
      await import("../src/components/billing-dashboard/contracts/ContractDetail")
    ).default;
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    navigationState.params = new URLSearchParams("tab=contracts&contractId=contract-1");
    window.history.replaceState(null, "", "/msp/billing?tab=contracts&contractId=contract-1");
    featureFlagState.enabled = false;
    featureFlagState.loading = false;
    tabsState.activeValue = "edit";
    getContractByIdMock.mockResolvedValue({ ...baseContract });
    getContractSummaryMock.mockResolvedValue(null);
    getContractAssignmentsMock.mockResolvedValue([{ ...baseAssignment }]);
    updateContractMock.mockResolvedValue({ ...baseContract });
    updateClientContractMock.mockResolvedValue({});
  });

  afterEach(() => cleanup());

  const renderLoaded = async () => {
    const view = render(<ContractDetail resolvedContractId="contract-1" />);
    await waitFor(() => expect(document.getElementById("edit-assignment-cc-1")).not.toBeNull(), { timeout: 20_000 });
    await waitFor(() => expect(guardMock).toHaveBeenCalled());
    // let the form-initialisation microtask settle
    await act(async () => {
      await Promise.resolve();
    });
    return view;
  };

  const everArmed = () => guardMock.mock.calls.some(([armed]) => armed === true);
  const lastArmed = () => guardMock.mock.calls.at(-1)?.[0];

  it("repro contract is clean on load and after a tab round-trip", async () => {
    const { rerender } = await renderLoaded();
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    expect(everArmed()).toBe(false);

    tabsState.activeValue = "invoices";
    rerender(<ContractDetail resolvedContractId="contract-1" />);
    tabsState.activeValue = "edit";
    rerender(<ContractDetail resolvedContractId="contract-1" />);
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    expect(everArmed()).toBe(false);
  });

  it("renders the stored assignment start date as its calendar day", async () => {
    await renderLoaded();
    // start_date is midnight UTC; it must not slide to Dec 31 west of UTC.
    expect(screen.getAllByText("Jan 1, 2025").length).toBeGreaterThan(0);
    expect(screen.queryByText("Dec 31, 2024")).not.toBeInTheDocument();
  });

  it("opening the assignment editor and clicking Done with no change stays clean", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(document.getElementById("edit-assignment-cc-1")!);
    await user.click(document.getElementById("confirm-assignment-cc-1")!);

    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    expect(lastArmed()).toBe(false);
    expect(everArmed()).toBe(false);
  });

  it("opening the editor while the stored renewal status is missing from the loaded list stays clean", async () => {
    const reference = await import("@alga-psa/reference-data/actions/status-actions/statusActions");
    (reference.getTicketStatuses as any).mockResolvedValue([
      { status_id: "other-status", name: "Other" },
    ]);
    getContractAssignmentsMock.mockResolvedValue([
      {
        ...baseAssignment,
        renewal_ticket_board_id: "board-1",
        renewal_ticket_status_id: "gone-status",
      },
    ]);
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(document.getElementById("edit-assignment-cc-1")!);
    await waitFor(() => expect(reference.getTicketStatuses).toHaveBeenCalledWith("board-1"));
    await act(async () => {
      await Promise.resolve();
    });
    await user.click(document.getElementById("confirm-assignment-cc-1")!);

    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    expect(everArmed()).toBe(false);
  });

  it("a real assignment edit shows the banner and arms the guard", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(document.getElementById("edit-assignment-cc-1")!);
    fireEvent.change(getPoInput(), { target: { value: "PO-1" } });

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(lastArmed()).toBe(true);
  });

  it("a real contract name change shows the banner", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByRole("button", { name: /edit.*name/i }));
    await user.type(document.getElementById("edit-contract-name")!, " v2");

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(lastArmed()).toBe(true);
  });

  it("a real billing frequency change shows the banner", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(document.getElementById("edit-billing-frequency")!);
    await user.click(await screen.findByRole("option", { name: "Monthly" }));

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
  });

  it("saving clears the banner and sends only real changes", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(document.getElementById("edit-assignment-cc-1")!);
    fireEvent.change(getPoInput(), { target: { value: "PO-1" } });
    await user.click(document.getElementById("confirm-assignment-cc-1")!);
    expect(await screen.findByText(BANNER)).toBeInTheDocument();

    getContractAssignmentsMock.mockResolvedValue([{ ...baseAssignment, po_number: "PO-1" }]);
    await user.click(document.getElementById("save-edit-contract-btn")!);

    await waitFor(() => expect(updateClientContractMock).toHaveBeenCalled());
    const payload = updateClientContractMock.mock.calls[0][1];
    expect(payload).toEqual({ tenant: "tenant-1", po_number: "PO-1" });
    await waitFor(() => expect(screen.queryByText(BANNER)).not.toBeInTheDocument());
    expect(lastArmed()).toBe(false);
  });
});
