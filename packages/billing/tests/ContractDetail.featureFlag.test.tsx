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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

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

    return (
      <section data-testid={`tab-content-${value}`}>
        {value === "simulator" ? children : null}
      </section>
    );
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
  useFormatters: () => ({
    formatCurrency: (value: number) => String(value),
  }),
}));

vi.mock("@alga-psa/core/context/DocumentsCrossFeatureContext", () => ({
  useDocumentsCrossFeature: () => ({
    getDocumentsByContractId: vi.fn(async () => []),
    renderDocuments: vi.fn(() => null),
  }),
}));

vi.mock("@alga-psa/billing/hooks/useBillingEnumOptions", () => ({
  useBillingFrequencyOptions: () => [],
}));

vi.mock("@alga-psa/billing/actions/contractActions", () => ({
  getContractById: (...args: unknown[]) => getContractByIdMock(...args),
  getContractSummary: (...args: unknown[]) => getContractSummaryMock(...args),
  getContractAssignments: (...args: unknown[]) =>
    getContractAssignmentsMock(...args),
  updateContract: vi.fn(),
  deleteContract: vi.fn(),
}));

vi.mock("@alga-psa/billing/actions/quoteActions", () => ({
  getQuoteByConvertedContractId: vi.fn(async () => null),
}));

vi.mock("@alga-psa/billing/actions/billingClientsActions", () => ({
  getClientContractByIdForBilling: vi.fn(async () => null),
  updateClientContractForBilling: vi.fn(),
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
  "../src/components/billing-dashboard/invoicing/InvoicePreviewPanel",
  () => ({
    default: () => null,
  }),
);

describe("ContractDetail contract simulator feature flag", () => {
  let ContractDetail: React.ComponentType<{
    resolvedContractId?: string | null;
  }>;

  beforeAll(async () => {
    ContractDetail = (
      await import("../src/components/billing-dashboard/contracts/ContractDetail")
    ).default;
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    navigationState.params = new URLSearchParams(
      "tab=contracts&contractId=contract-1",
    );
    featureFlagState.enabled = false;
    featureFlagState.loading = true;
    featureFlagState.error = null;
    tabsState.activeValue = "edit";

    getContractByIdMock.mockResolvedValue({
      contract_id: "contract-1",
      contract_name: "Support contract",
      contract_description: null,
      billing_frequency: "monthly",
      currency_code: "USD",
      is_template: false,
      is_system_managed_default: false,
      owner_client_id: null,
      status: "draft",
    });
    getContractSummaryMock.mockResolvedValue(null);
    getContractAssignmentsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("fails closed while the flag is unresolved and does not mount simulator content", async () => {
    render(<ContractDetail resolvedContractId="contract-1" />);

    expect(
      await screen.findByRole("tab", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Simulate" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("contract-simulator-mounted"),
    ).not.toBeInTheDocument();
    expect(useFeatureFlagMock).toHaveBeenCalledWith("contract-simulator", {
      defaultValue: false,
    });
  });

  it("renders the Simulate tab when the flag is enabled", async () => {
    navigationState.params = new URLSearchParams(
      "tab=contracts&contractId=contract-1&contractView=simulator",
    );
    featureFlagState.enabled = true;
    featureFlagState.loading = false;

    render(<ContractDetail resolvedContractId="contract-1" />);

    expect(
      await screen.findByRole("tab", { name: "Simulate" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("contract-simulator-mounted"),
    ).toBeInTheDocument();
    expect(navigationState.replace).not.toHaveBeenCalled();
  });

  it("normalizes a disabled simulator deep link to Overview and preserves other query parameters", async () => {
    navigationState.params = new URLSearchParams(
      "tab=contracts&contractId=contract-1&contractView=simulator&foo=bar",
    );
    featureFlagState.loading = false;

    render(<ContractDetail resolvedContractId="contract-1" />);

    expect(await screen.findByTestId("tab-content-edit")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Simulate" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(navigationState.replace).toHaveBeenCalledWith(
        "/msp/billing?tab=contracts&contractId=contract-1&foo=bar",
        { scroll: false },
      );
    });
  });
});
