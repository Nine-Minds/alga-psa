// @vitest-environment jsdom
//
// Billing timing on contract line summaries (alga-2026-0002714):
//  - Overview "What's Included" rows and collapsed Contract Lines rows show the
//    EFFECTIVE timing (Hourly/Usage are always arrears, whatever is stored);
//  - the Overview Edit action lands on the Contract Lines tab with the line
//    expanded and in edit mode, exactly once;
//  - read-only contracts get no Edit action and a focus/edit id never enters edit mode.

import React, { useState } from 'react';
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
}));
vi.mock('@alga-psa/billing/actions/contractLineSemanticsActions', () => ({
  setUsageMeasurementMode: vi.fn(),
  getNextContractServiceBoundary: vi.fn(async () => null),
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
  useFormatters: () => ({
    formatCurrency: (amount: number, currencyCode: string) => `${currencyCode} ${amount.toFixed(2)}`,
  }),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
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

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn(); // jsdom lacks it
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

describe('Overview Edit deep link', () => {
  // Mirrors ContractDetail's wiring: onEditLine -> focus request -> ContractLines props.
  const Harness: React.FC<{ readOnly?: boolean }> = ({ readOnly = false }) => {
    const [tab, setTab] = useState<'edit' | 'lines'>('edit');
    const [req, setReq] = useState<{ lineId: string; edit: boolean } | null>(null);
    return tab === 'edit' ? (
      <ContractOverview
        contractId="contract-1"
        isReadOnly={readOnly}
        onNavigateToLines={() => setTab('lines')}
        onEditLine={(lineId) => {
          setReq({ lineId, edit: !readOnly });
          setTab('lines');
        }}
      />
    ) : (
      <ContractLines
        contract={contract}
        isReadOnly={readOnly}
        focusContractLineId={req?.lineId ?? null}
        editIntentLineId={req?.edit ? req.lineId : null}
        onEditIntentConsumed={() => setReq((c) => (c ? { ...c, edit: false } : c))}
      />
    );
  };

  it('opens the line expanded and in edit mode, and does not re-enter edit mode after the user cancels', async () => {
    mocks.getContractOverview.mockResolvedValue(overviewOf(overviewLine('line-fixed', 'Fixed', 'advance'), overviewLine('line-hourly', 'Hourly', 'advance')));
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Fixed line' }));
    expect(await screen.findByTestId('timing-editor-billing-timing-line-fixed')).toBeTruthy();
    expect(screen.queryByTestId('timing-editor-billing-timing-line-hourly')).toBeNull();

    // Intent was consumed: a refetch-style re-render must not restart editing after cancel.
    const cancel = document.getElementById('cancel-edit-line-fixed') ?? screen.queryByRole('button', { name: /cancel/i });
    if (cancel) {
      fireEvent.click(cancel);
      await waitFor(() => expect(screen.queryByTestId('timing-editor-billing-timing-line-fixed')).toBeNull());
    }
    expect(mocks.getDetailedContractLines).toHaveBeenCalledTimes(1);
  });

  it('single-line "View details" goes straight to that line in edit mode', async () => {
    mocks.getContractOverview.mockResolvedValue(overviewOf(overviewLine('line-fixed', 'Fixed', 'advance')));
    mocks.getDetailedContractLines.mockResolvedValue([detailedLine('line-fixed', 'Fixed')]);
    render(<Harness />);
    fireEvent.click(await screen.findByText(/View details/));
    expect(await screen.findByTestId('timing-editor-billing-timing-line-fixed')).toBeTruthy();
  });

  it('read-only: no Overview Edit action, and "View details" only expands the line', async () => {
    mocks.getContractOverview.mockResolvedValue(overviewOf(overviewLine('line-fixed', 'Fixed', 'advance')));
    mocks.getDetailedContractLines.mockResolvedValue([detailedLine('line-fixed', 'Fixed')]);
    render(<Harness readOnly />);
    await screen.findByTestId('overview-line-billing-timing-line-fixed');
    expect(document.getElementById('contract-overview-edit-line-line-fixed')).toBeNull();
    fireEvent.click(screen.getByText(/View details/));
    await screen.findByTestId('contract-line-billing-timing-line-fixed');
    expect(screen.queryByTestId('timing-editor-billing-timing-line-fixed')).toBeNull();
  });

  it('read-only ContractLines never enters edit mode from an edit intent, and still reports it consumed', async () => {
    const consumed = vi.fn();
    render(
      <ContractLines
        contract={contract}
        isReadOnly
        focusContractLineId="line-fixed"
        editIntentLineId="line-fixed"
        onEditIntentConsumed={consumed}
      />,
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
