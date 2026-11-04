// @vitest-environment jsdom
//
// Billing timing on contract line summaries (alga-2026-0002714):
//  - Overview "What's Included" rows and collapsed Contract Lines rows show the
//    EFFECTIVE timing (Hourly/Usage are always arrears, whatever is stored);
//  - the Overview Edit action lands on the Contract Lines tab with the line
//    expanded and in edit mode, exactly once;
//  - read-only contracts get no Edit action and a focus/edit id never enters edit mode.

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getContractOverview: vi.fn(),
  getDetailedContractLines: vi.fn(),
}));

vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
}));
vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  getContractOverview: mocks.getContractOverview,
  getContractById: (...a: unknown[]) => detail.getContractById(...a),
  getContractSummary: vi.fn(async () => null),
  getContractAssignments: vi.fn(async () => []),
  updateContract: vi.fn(),
  deleteContract: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/contractLineSemanticsActions', () => ({
  setUsageMeasurementMode: vi.fn(),
  getNextContractServiceBoundary: vi.fn(async () => null),
}));
vi.mock('@alga-psa/billing/actions/contractLineSaveAction', () => ({
  saveContractLineEdit: vi.fn(async () => ({ status: 'saved', version: 'v2', rematerialized: false })),
  getContractLineEditVersion: vi.fn(async () => 'v1'),
}));
vi.mock('@alga-psa/billing/actions/contractLineAction', () => ({
  hasContractLineProtectedHistory: vi.fn(async () => false),
  updateContractLine: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/contractLineMappingActions', () => ({
  getDetailedContractLines: mocks.getDetailedContractLines,
  removeContractLine: vi.fn(),
  updateContractLineAssociation: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/rateReviewActions', () => ({
  resetContractLineRateToStandard: vi.fn(),
  previewContractLineRateReset: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  applyContractLineServiceMembershipChanges: vi.fn(),
  getContractLineServicesWithConfigurations: vi.fn(async () => []),
  getTemplateLineServicesWithConfigurations: vi.fn(async () => []),
}));
vi.mock('@alga-psa/billing/actions/contractLineServiceConfigurationActions', () => ({
  updateConfiguration: vi.fn(),
  getConfigurationWithDetails: vi.fn(),
  upsertPlanServiceBucketConfigurationAction: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/bucketOverlayActions', () => ({
  deleteBucketOverlay: vi.fn(),
  getBucketOverlay: vi.fn(async () => null),
  listBucketOverlaysForLine: vi.fn(async () => []),
}));
vi.mock('@alga-psa/billing/actions/bucketPoolActions', () => ({
  listBucketBusinessHoursSchedules: vi.fn(async () => []),
  listBucketPoolsForLine: vi.fn(async () => []),
}));
vi.mock('@alga-psa/billing/actions/billingClientLocationActions', () => ({
  getActiveClientLocationsForBilling: vi.fn(async () => []),
}));
vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  assignContractLineBillingProfile: vi.fn(),
  getClientBillingProfilesForBilling: vi.fn(async () => []),
}));


// ---- ContractDetail boundary mocks (I/O, routing, drawer, tenant, tabs shell) ----
const nav = vi.hoisted(() => ({ params: new URLSearchParams('tab=client-contracts&contractId=contract-1') }));
const detail = vi.hoisted(() => ({ getContractById: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => '/msp/billing',
}));
vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ openDrawer: vi.fn(), replaceDrawer: vi.fn(), closeDrawer: vi.fn() }) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: () => ({ enabled: false, loading: false }) }));
vi.mock('@alga-psa/ui/hooks/useClientBillingProfiles', () => ({
  useClientBillingProfiles: () => ({ profiles: [], isLoading: false, error: null }),
}));
vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({ useTenant: () => 'tenant-1' }));
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ getDocumentsByContractId: vi.fn(async () => []), renderDocuments: () => null }),
}));
vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getClientContractByIdForBilling: vi.fn(async () => null),
  updateClientContractForBilling: vi.fn(async () => null),
  getClientByIdForBilling: vi.fn(async () => null),
}));
vi.mock('@alga-psa/billing/actions/quoteActions', () => ({ getQuoteByConvertedContractId: vi.fn(async () => null) }));
vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({ fetchInvoicesByContract: vi.fn(async () => []) }));
vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({ getInvoiceTemplates: vi.fn(async () => []) }));
vi.mock('@alga-psa/reference-data/actions/boardActions', () => ({ getAllBoards: vi.fn(async () => []) }));
vi.mock('@alga-psa/reference-data/actions/status-actions/statusActions', () => ({ getTicketStatuses: vi.fn(async () => []) }));
vi.mock('../src/components/billing-dashboard/contracts/ContractHeader', () => ({ default: () => <div data-testid="contract-header" /> }));
vi.mock('../src/components/billing-dashboard/contracts/PricingSchedules', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/contracts/ContractDiscounts', () => ({ default: () => null }));
vi.mock('../src/components/billing-dashboard/invoicing/InvoicePreviewPanel', () => ({ default: () => null }));
// Tabs shell that renders only the ACTIVE panel, so "the Lines tab is active" is observable.
vi.mock('@alga-psa/ui/components/Tabs', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  const Ctx = react.createContext<{ value: string; onValueChange: (v: string) => void }>({ value: '', onValueChange: () => undefined });
  return {
    Tabs: ({ value, onValueChange, children }: any) => <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>,
    TabsList: ({ children }: any) => <div role="tablist">{children}</div>,
    TabsTrigger: ({ value, children, disabled }: any) => {
      const c = react.useContext(Ctx);
      return (
        <button type="button" role="tab" disabled={disabled} aria-selected={c.value === value} onClick={() => c.onValueChange(value)}>
          {children}
        </button>
      );
    },
    TabsContent: ({ value, children }: any) => {
      const c = react.useContext(Ctx);
      return c.value === value ? <div data-testid={`tab-panel-${value}`}>{children}</div> : null;
    },
  };
});

const translate = (key: string, options?: Record<string, unknown>) => {
  let value = String(options?.defaultValue ?? key);
  for (const [name, replacement] of Object.entries(options ?? {})) {
    if (name === 'defaultValue') continue;
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
  useOptionalI18n: () => null,
  useFormatters: () => ({
    formatCurrency: (amount: number, currencyCode: string) => `${currencyCode} ${amount.toFixed(2)}`,
    formatDate: (v: unknown) => String(v),
    formatNumber: (v: number) => String(v),
  }),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [],
  useFormatBillingFrequency: () => (value: string) => value,
  useFormatContractLineType: () => (value: string) => value,
}));

// Heavy children that are irrelevant to these behaviours.
vi.mock('../src/components/billing-dashboard/contracts/UsageLegacyTransitionDialog', () => ({
  UsageLegacyTransitionDialog: () => null,
}));
vi.mock('../src/components/billing-dashboard/contracts/AddContractLinesDialog', () => ({ AddContractLinesDialog: () => null }));
vi.mock('../src/components/billing-dashboard/contracts/CreateCustomContractLineDialog', () => ({ CreateCustomContractLineDialog: () => null }));
vi.mock('../src/components/billing-dashboard/service-config/ServiceSelectionDialog', () => ({ ServiceSelectionDialog: () => null }));
vi.mock('../src/components/billing-dashboard/contracts/ContractWizard', () => ({ ContractWizard: () => null }));
vi.mock('../src/components/billing-dashboard/contracts/PrepaidBlockPanel', () => ({ PrepaidBlockPanel: () => null }));
vi.mock('../src/components/billing-dashboard/contracts/RecurringUnitSchedulePanel', () => ({ RecurringUnitSchedulePanel: () => null }));
vi.mock('../src/components/billing-dashboard/contracts/BucketPoolEditor', () => ({ BucketPoolEditor: () => null }));
vi.mock('../src/components/billing-dashboard/contracts/BucketOverlayFields', () => ({ BucketOverlayFields: () => null }));
vi.mock('../src/components/billing-dashboard/service-configurations/UsageServiceConfigPanel', () => ({ UsageServiceConfigPanel: () => null }));
vi.mock('@alga-psa/ui/components/BillingProfilePicker', () => ({ BillingProfilePicker: () => null }));
vi.mock('../src/components/billing-dashboard/contracts/BillingTimingField', () => ({
  BillingTimingField: ({ id }: { id: string }) => <div data-testid={`timing-editor-${id}`} />,
  default: ({ id }: { id: string }) => <div data-testid={`timing-editor-${id}`} />,
}));

const { ContractOverview } = await import('../src/components/billing-dashboard/contracts/ContractOverview');
const { default: ContractDetail } = await import('../src/components/billing-dashboard/contracts/ContractDetail');
const { default: ContractLines } = await import('../src/components/billing-dashboard/contracts/ContractLines');

const overviewLine = (id: string, type: 'Fixed' | 'Hourly', timing: 'advance' | 'arrears') => ({
  contract_line_id: id,
  contract_line_name: `${type} line`,
  contract_line_type: type,
  billing_frequency: 'annually',
  billing_timing: timing,
  base_rate: type === 'Fixed' ? 120000 : null,
  display_order: 0,
  services: [],
});
const overviewOf = (...lines: ReturnType<typeof overviewLine>[]) => ({
  contractLines: lines,
  totalEstimatedMonthlyValue: null,
  serviceCount: 0,
  hasHourlyServices: false,
  hasUsageServices: false,
  hasFixedServices: true,
  currencyCode: 'AUD',
  clientId: 'client-1',
});

const detailedLine = (id: string, type: 'Fixed' | 'Hourly') => ({
  contract_id: 'contract-1',
  contract_line_id: id,
  contract_line_name: `${type} line`,
  contract_line_type: type,
  billing_frequency: 'annually',
  billing_timing: 'advance', // stored value; Hourly must still display arrears
  default_rate: null,
  custom_rate: null,
  display_order: 0,
});

const contract = { contract_id: 'contract-1', contract_name: 'C', is_template: false } as any;
const contractRecord = (extra: Record<string, unknown> = {}) => ({
  contract_id: 'contract-1',
  contract_name: 'Managed Services',
  contract_description: 'd',
  status: 'active',
  billing_frequency: 'monthly',
  is_template: false,
  currency_code: 'AUD',
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn(); // jsdom lacks it
  nav.params = new URLSearchParams('tab=client-contracts&contractId=contract-1');
  window.history.replaceState(null, '', '/msp/billing?tab=client-contracts&contractId=contract-1');
  detail.getContractById.mockResolvedValue(contractRecord());
  mocks.getDetailedContractLines.mockResolvedValue([detailedLine('line-fixed', 'Fixed'), detailedLine('line-hourly', 'Hourly')]);
});
afterEach(() => cleanup());

describe('effective billing timing on summary rows', () => {
  it('Overview row shows In Advance for a Fixed advance line and In Arrears for an Hourly line stored as advance', async () => {
    mocks.getContractOverview.mockResolvedValue(
      overviewOf(overviewLine('line-fixed', 'Fixed', 'advance'), overviewLine('line-hourly', 'Hourly', 'advance')),
    );
    render(<ContractOverview contractId="contract-1" />);
    expect((await screen.findByTestId('overview-line-billing-timing-line-fixed')).textContent).toBe('In Advance');
    expect(screen.getByTestId('overview-line-billing-timing-line-hourly').textContent).toBe('In Arrears');
    // currency rendering is untouched
    expect(screen.getByText('AUD 1200.00')).toBeTruthy();
  });

  it('collapsed Contract Lines rows show the effective timing', async () => {
    render(<ContractLines contract={contract} />);
    expect((await screen.findByTestId('contract-line-billing-timing-line-fixed')).textContent).toContain('In Advance');
    expect(screen.getByTestId('contract-line-billing-timing-line-hourly').textContent).toContain('In Arrears');
  });
});

describe('Overview Edit deep link, through the real ContractDetail', () => {
  const renderDetail = () => render(<ContractDetail resolvedContractId="contract-1" resolvedClientContractId={null} />);
  const editorOf = (id: string) => screen.queryByTestId(`timing-editor-billing-timing-${id}`);

  it('Edit opens the Lines tab with only that line expanded and in edit mode; cancel (real button) does not re-enter edit mode', async () => {
    mocks.getContractOverview.mockResolvedValue(
      overviewOf(overviewLine('line-fixed', 'Fixed', 'advance'), overviewLine('line-hourly', 'Hourly', 'advance')),
    );
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Fixed line' }));

    expect(await screen.findByTestId('tab-panel-lines')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Contract Lines' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByTestId('timing-editor-billing-timing-line-fixed')).toBeTruthy();
    expect(editorOf('line-hourly')).toBeNull();
    expect(screen.getAllByTestId(/^timing-editor-/)).toHaveLength(1);

    const cancel = await screen.findByRole('button', { name: /^cancel$/i }, { timeout: 2000 }).catch(() => null);
    expect(cancel).not.toBeNull();
    expect(cancel!.id).toBe('cancel-line-line-fixed');
    fireEvent.click(document.getElementById('cancel-line-line-fixed')!);
    await waitFor(() => expect(editorOf('line-fixed')).toBeNull());
    // Settle: the consumed one-shot intent must not re-open edit mode.
    await new Promise((r) => setTimeout(r, 50));
    expect(editorOf('line-fixed')).toBeNull();
    expect(document.getElementById('cancel-line-line-fixed')).toBeNull();
  });

  it('single-line "View details" lands on that line in edit mode', async () => {
    mocks.getContractOverview.mockResolvedValue(overviewOf(overviewLine('line-fixed', 'Fixed', 'advance')));
    mocks.getDetailedContractLines.mockResolvedValue([detailedLine('line-fixed', 'Fixed')]);
    renderDetail();
    fireEvent.click(await screen.findByText(/View details/));
    expect(await screen.findByTestId('tab-panel-lines')).toBeTruthy();
    expect(await screen.findByTestId('timing-editor-billing-timing-line-fixed')).toBeTruthy();
  });

  it('system-managed default contract: no Overview Edit action, and "View details" never enters edit mode', async () => {
    detail.getContractById.mockResolvedValue(contractRecord({ is_system_managed_default: true }));
    mocks.getContractOverview.mockResolvedValue(overviewOf(overviewLine('line-fixed', 'Fixed', 'advance')));
    mocks.getDetailedContractLines.mockResolvedValue([detailedLine('line-fixed', 'Fixed')]);
    renderDetail();
    await screen.findByTestId('overview-line-billing-timing-line-fixed');
    expect(document.getElementById('contract-overview-edit-line-line-fixed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Fixed line' })).toBeNull();

    fireEvent.click(screen.getByText(/View details/));
    expect(await screen.findByTestId('tab-panel-lines')).toBeTruthy();
    await screen.findByTestId('contract-line-billing-timing-line-fixed');
    await new Promise((r) => setTimeout(r, 50));
    expect(editorOf('line-fixed')).toBeNull();
  });
});

// ContractLines-only unit cases (no ContractDetail): the one-shot props contract itself.
describe('ContractLines edit-intent props (unit)', () => {
  it('read-only ContractLines never enters edit mode from an edit intent, and still reports it consumed', async () => {
    const consumed = vi.fn();
    render(
      <ContractLines contract={contract} isReadOnly focusContractLineId="line-fixed" editIntentLineId="line-fixed" onEditIntentConsumed={consumed} />,
    );
    await screen.findByTestId('contract-line-billing-timing-line-fixed');
    await waitFor(() => expect(consumed).toHaveBeenCalled());
    expect(screen.queryByTestId('timing-editor-billing-timing-line-fixed')).toBeNull();
  });

  it('a plain focus id (no edit intent) expands without editing', async () => {
    render(<ContractLines contract={contract} focusContractLineId="line-fixed" />);
    await screen.findByTestId('contract-line-billing-timing-line-fixed');
    expect(screen.queryByTestId('timing-editor-billing-timing-line-fixed')).toBeNull();
  });
});
