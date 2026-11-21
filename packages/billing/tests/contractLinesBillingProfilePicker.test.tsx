// @vitest-environment jsdom

/**
 * Turning the bucket switch off is an intent to delete the saved overlay.
 * The save loop used to skip the null draft entirely, so the overlay came
 * straight back on the next reload.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  applyContractLineServiceMembershipChanges: vi.fn(),
  checkContractHasInvoices: vi.fn(),
  deleteBucketOverlay: vi.fn(),
  listBucketPoolsForLine: vi.fn(),
  getActiveClientLocationsForBilling: vi.fn(),
  getContractLineServicesWithConfigurations: vi.fn(),
  getDetailedContractLines: vi.fn(),
  assignContractLineBillingProfile: vi.fn(),
  getClientBillingProfilesForBilling: vi.fn(),
  getServices: vi.fn(),
  getTemplateLineServicesWithConfigurations: vi.fn(),
  removeContractLine: vi.fn(),
  updateConfiguration: vi.fn(),
  getConfigurationWithDetails: vi.fn(),
  updateContractLine: vi.fn(),
  updateContractLineAssociation: vi.fn(),
  upsertBucketConfiguration: vi.fn(),
}));

vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
}));

vi.mock('@alga-psa/billing/actions/contractLineSemanticsActions', () => ({
  getNextContractServiceBoundary: vi.fn(async () => null),
}));

vi.mock('@alga-psa/billing/actions/contractLineUnitPricingActions', () => ({
  getEffectiveRecurringUnitPricing: vi.fn(async () => null),
  scheduleRecurringUnitPricingRevision: vi.fn(async () => null),
  listRecurringUnitPricingRevisions: vi.fn(async () => []),
  listRecurringUnitPricingRevisionHistory: vi.fn(async () => []),
  resolveRecurringUnitMidPeriod: vi.fn(async () => null),
}));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({
  previewRecurringRevisionInvoiceImpact: vi.fn(async () => ({ success: false, error: 'not used' })),
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServices: actionMocks.getServices,
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  applyContractLineServiceMembershipChanges: actionMocks.applyContractLineServiceMembershipChanges,
  getContractLineServicesWithConfigurations: actionMocks.getContractLineServicesWithConfigurations,
  getTemplateLineServicesWithConfigurations: actionMocks.getTemplateLineServicesWithConfigurations,
}));

vi.mock('@alga-psa/billing/actions/contractLineAction', () => ({
  updateContractLine: actionMocks.updateContractLine,
  // No billed history: the lines stay editable.
  hasContractLineProtectedHistory: vi.fn(async () => false),
}));

vi.mock('@alga-psa/billing/actions/contractLineMappingActions', () => ({
  getDetailedContractLines: actionMocks.getDetailedContractLines,
  removeContractLine: actionMocks.removeContractLine,
  updateContractLineAssociation: actionMocks.updateContractLineAssociation,
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  checkContractHasInvoices: actionMocks.checkContractHasInvoices,
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceConfigurationActions', () => ({
  updateConfiguration: actionMocks.updateConfiguration,
  getConfigurationWithDetails: actionMocks.getConfigurationWithDetails,
  upsertPlanServiceBucketConfigurationAction: actionMocks.upsertBucketConfiguration,
}));

vi.mock('@alga-psa/billing/actions/bucketOverlayActions', () => ({
  deleteBucketOverlay: actionMocks.deleteBucketOverlay,
}));

vi.mock('@alga-psa/billing/actions/bucketPoolActions', () => ({
  listBucketBusinessHoursSchedules: vi.fn(async () => []),
  listBucketPoolsForLine: actionMocks.listBucketPoolsForLine,
}));

vi.mock('@alga-psa/billing/actions/billingClientLocationActions', () => ({
  getActiveClientLocationsForBilling: actionMocks.getActiveClientLocationsForBilling,
}));

const translate = (_key: string, second?: string | Record<string, unknown>) => {
  const options = typeof second === 'object' && second ? second : {};
  let value = String((typeof second === 'string' ? second : options.defaultValue) ?? _key);
  for (const [name, replacement] of Object.entries(options)) {
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
  useOptionalI18n: () => ({ locale: 'en' }),
  useFormatters: () => ({
    formatCurrency: (value: number, currency: string) => `${currency} ${value}`,
    formatDate: (value: string) => value,
  }),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useFormatBillingFrequency: () => (value: string) => value,
  useFormatContractLineType: () => (value: string) => value,
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: () => 'action error',
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

vi.mock('@alga-psa/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/core')>()),
  getCurrencySymbol: () => '$',
}));

vi.mock('@radix-ui/themes', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

// A native select so the suite can read the shown option and pick another.
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, options, value, onValueChange }: any) => (
    <select id={id} data-testid={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  assignContractLineBillingProfile: actionMocks.assignContractLineBillingProfile,
  getClientBillingProfilesForBilling: actionMocks.getClientBillingProfilesForBilling,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  default: ({ text }: { text?: React.ReactNode }) => <div>{text}</div>,
}));

// Rendered as a real checkbox so the suite can toggle the bucket switch.
vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({
  SwitchWithLabel: ({ label, checked, onCheckedChange }: any) => (
    <label>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      {label}
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => <tr {...props}>{children}</tr>,
  TableHead: ({ children }: { children?: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
}));

vi.mock('../src/components/billing-dashboard/contracts/AddContractLinesDialog', () => ({
  AddContractLinesDialog: () => null,
}));

vi.mock('../src/components/billing-dashboard/contracts/CreateCustomContractLineDialog', () => ({
  CreateCustomContractLineDialog: () => null,
}));

vi.mock('../src/components/billing-dashboard/contracts/BucketOverlayFields', () => ({
  BucketOverlayFields: () => null,
}));

vi.mock('../src/components/billing-dashboard/contracts/BucketPoolEditor', () => ({
  BucketPoolEditor: () => null,
}));

import ContractLines from '../src/components/billing-dashboard/contracts/ContractLines';

const profiles = [
  { billing_profile_id: 'profile-1', name: 'Main', is_default: true },
  { billing_profile_id: 'profile-2', name: 'Projects', is_default: false },
];

describe('line billing profile picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.checkContractHasInvoices.mockResolvedValue(false);
    actionMocks.getActiveClientLocationsForBilling.mockResolvedValue([]);
    actionMocks.getTemplateLineServicesWithConfigurations.mockResolvedValue([]);
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([]);
    actionMocks.listBucketPoolsForLine.mockResolvedValue([]);
    actionMocks.getServices.mockResolvedValue({ services: [], totalCount: 0 });
    actionMocks.getClientBillingProfilesForBilling.mockResolvedValue(profiles);
    actionMocks.assignContractLineBillingProfile.mockResolvedValue({ success: true });
    actionMocks.getDetailedContractLines.mockResolvedValue([{
      tenant: 'tenant-1',
      contract_id: 'contract-1',
      contract_line_id: 'line-1',
      display_order: 1,
      created_at: new Date(),
      contract_line_name: 'Managed Services line',
      billing_frequency: 'monthly',
      billing_timing: 'arrears',
      cadence_owner: 'client',
      contract_line_type: 'Hourly',
      default_rate: 15000,
      location_id: null,
      billing_profile_id: 'profile-2',
    }]);
  });

  it('shows the stored profile and clears it to null via the unassigned option', async () => {
    render(
      <ContractLines
        clientId="client-1"
        contract={{ contract_id: 'contract-1', contract_name: 'Managed Services', currency_code: 'USD', is_template: false } as any}
      />
    );

    fireEvent.click(await screen.findByLabelText('Expand contract line'));
    const select = (await screen.findByTestId('billing-profile-line-1')) as HTMLSelectElement;

    await waitFor(() => expect(select.options.length).toBe(3));
    expect(select.value).toBe('profile-2');
    expect(select.selectedOptions[0].textContent).toBe('Projects');
    expect(select.selectedOptions[0].textContent).not.toBe("Use the contract's profile");

    fireEvent.change(select, { target: { value: '__unassigned__' } });

    await waitFor(() =>
      expect(actionMocks.assignContractLineBillingProfile).toHaveBeenCalledWith({
        contractLineId: 'line-1',
        billingProfileId: null,
      }),
    );
  });
});
