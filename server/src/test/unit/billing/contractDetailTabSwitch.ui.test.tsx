/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

(globalThis as unknown as { React?: typeof React }).React = React;

const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
};

let currentSearchParams = new URLSearchParams('tab=client-contracts&contractId=contract-1');

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => currentSearchParams,
  usePathname: () => '/msp/billing',
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) =>
      typeof options === 'string' ? options : ((options?.defaultValue as string | undefined) ?? key),
  }),
  useFormatters: () => ({
    formatCurrency: (value: number, currency = 'USD') =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value),
    formatDate: (value: unknown) => String(value),
    formatNumber: (value: number) => String(value),
  }),
}));

vi.mock('@alga-psa/ui/components/Tabs', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  const TabsContext = react.createContext<{ value: string; onValueChange: (value: string) => void }>({
    value: '',
    onValueChange: () => undefined,
  });

  return {
    Tabs: ({ value, onValueChange, children }: any) => (
      <TabsContext.Provider value={{ value, onValueChange }}>{children}</TabsContext.Provider>
    ),
    TabsList: ({ children }: any) => <div role="tablist">{children}</div>,
    TabsTrigger: ({ value, children, disabled }: any) => {
      const context = react.useContext(TabsContext);
      return (
        <button
          type="button"
          role="tab"
          disabled={disabled}
          data-value={value}
          aria-selected={context.value === value}
          onClick={() => context.onValueChange(value)}
        >
          {children}
        </button>
      );
    },
    // Panel bodies are irrelevant to tab-switch navigation and pull in the whole
    // contract editor tree, so they stay unrendered here.
    TabsContent: () => null,
  };
});

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), replaceDrawer: vi.fn(), closeDrawer: vi.fn() }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false, loading: false }),
}));

vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({
  useTenant: () => 'tenant-1',
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    getDocumentsByContractId: vi.fn(async () => []),
    renderDocuments: () => null,
  }),
}));

const contractFixture = {
  contract_id: 'contract-1',
  contract_name: 'Managed Services',
  contract_description: 'Base contract',
  status: 'active',
  billing_frequency: 'monthly',
  is_template: false,
  currency_code: 'USD',
};

const getContractById = vi.fn(async () => contractFixture);

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  getContractById: (...args: unknown[]) => getContractById(...(args as [])),
  getContractSummary: vi.fn(async () => null),
  getContractAssignments: vi.fn(async () => []),
  updateContract: vi.fn(async () => contractFixture),
  deleteContract: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getClientContractByIdForBilling: vi.fn(async () => null),
  updateClientContractForBilling: vi.fn(async () => null),
  getClientByIdForBilling: vi.fn(async () => null),
}));

vi.mock('@alga-psa/billing/actions/quoteActions', () => ({
  getQuoteByConvertedContractId: vi.fn(async () => null),
}));

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  fetchInvoicesByContract: vi.fn(async () => []),
}));

vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  getInvoiceTemplates: vi.fn(async () => []),
}));

vi.mock('@alga-psa/reference-data/actions/boardActions', () => ({
  getAllBoards: vi.fn(async () => []),
}));

vi.mock('@alga-psa/reference-data/actions/status-actions/statusActions', () => ({
  getTicketStatuses: vi.fn(async () => []),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [],
}));

vi.mock('../../../../../packages/billing/src/components/billing-dashboard/contracts/ContractHeader', () => ({
  default: () => <div data-testid="contract-header" />,
}));

vi.mock('../../../../../packages/billing/src/components/billing-dashboard/contracts/ContractTemplateDetail', () => ({
  default: () => <div data-testid="contract-template-detail" />,
}));

import ContractDetail from '../../../../../packages/billing/src/components/billing-dashboard/contracts/ContractDetail';
import ContractDetailSwitcher from '../../../../../packages/billing/src/components/billing-dashboard/contracts/ContractDetailSwitcher';

const setSearchParams = (query: string) => {
  currentSearchParams = new URLSearchParams(query);
  window.history.replaceState(null, '', `/msp/billing?${query}`);
};

describe('contract detail tab switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContractById.mockResolvedValue(contractFixture);
    setSearchParams('tab=client-contracts&contractId=contract-1');
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the contract mounted when only the contractView param changes', async () => {
    const { rerender } = render(<ContractDetailSwitcher />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Contract Lines' })).toBeInTheDocument());
    const callsAfterMount = getContractById.mock.calls.length;

    // Next hands back a fresh searchParams object on every URL change.
    setSearchParams('tab=client-contracts&contractId=contract-1&contractView=lines');
    rerender(<ContractDetailSwitcher />);

    expect(screen.queryByText('Loading contract...')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Contract Lines' })).toBeInTheDocument();
    // A remount of the detail view would re-run both the switcher resolution and
    // the detail's own contract load.
    await waitFor(() => expect(getContractById.mock.calls.length).toBe(callsAfterMount));
  });

  it('switches subtabs with history.replaceState instead of a route navigation', async () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    render(<ContractDetail resolvedContractId="contract-1" resolvedClientContractId={null} />);

    const linesTab = await screen.findByRole('tab', { name: 'Contract Lines' });
    replaceStateSpy.mockClear();

    fireEvent.click(linesTab);

    await waitFor(() => expect(replaceStateSpy).toHaveBeenCalled());
    const [, , nextUrl] = replaceStateSpy.mock.calls[0];
    expect(String(nextUrl)).toContain('contractView=lines');
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();

    replaceStateSpy.mockRestore();
  });
});
