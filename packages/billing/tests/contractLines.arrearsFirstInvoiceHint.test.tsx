// @vitest-environment jsdom

/**
 * Contract Detail → Lines: a Fixed line shows when its first partial period
 * invoices, following the *pending* Billing Timing select while editing. Hidden
 * for Hourly lines, advance lines, and starts whose first invoice has opened.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeAnchorSettingsForCycle } from '@alga-psa/shared/billingClients/billingCycleAnchors';

const actionMocks = vi.hoisted(() => ({
  saveContractLineEdit: vi.fn(),
  getContractLineEditVersion: vi.fn(),
  applyContractLineServiceMembershipChanges: vi.fn(),
  checkContractHasInvoices: vi.fn(),
  deleteBucketOverlay: vi.fn(),
  listBucketPoolsForLine: vi.fn(),
  getActiveClientLocationsForBilling: vi.fn(),
  getContractLineServicesWithConfigurations: vi.fn(),
  getDetailedContractLines: vi.fn(),
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

vi.mock('@alga-psa/billing/actions/contractLineSaveAction', () => ({
  saveContractLineEdit: actionMocks.saveContractLineEdit,
  getContractLineEditVersion: actionMocks.getContractLineEditVersion,
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
    formatDate: (value: Date) =>
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
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

vi.mock('@alga-psa/billing/actions/billingCycleAnchorActions', () => ({
  getClientBillingCycleAnchor: vi.fn(async () => ({
    billingCycle: 'monthly',
    anchor: normalizeAnchorSettingsForCycle('monthly', {}),
  })),
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

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
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

const line = (overrides: Record<string, unknown> = {}) => ({
  tenant: 'tenant-1',
  contract_id: 'contract-1',
  contract_line_id: 'line-1',
  display_order: 1,
  created_at: new Date(),
  contract_line_name: 'Managed Services line',
  billing_frequency: 'monthly',
  billing_timing: 'arrears',
  cadence_owner: 'client',
  contract_line_type: 'Fixed',
  default_rate: 15000,
  location_id: null,
  ...overrides,
});

const renderLines = (startDate: string | null = '2026-10-20') =>
  render(
    <ContractLines
      contract={{ contract_id: 'contract-1', contract_name: 'Managed', currency_code: 'USD', is_template: false } as any}
      clientId="client-1"
      startDate={startDate}
    />,
  );

const hint = () => document.getElementById('first-invoice-hint-line-1');
const timingSelect = () => document.getElementById('billing-timing-line-1') as HTMLSelectElement;

async function expandAndEdit() {
  fireEvent.click(await screen.findByLabelText('Expand contract line'));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  // Cadence owner, not billing timing: Hourly/Usage lines render timing as
  // read-only In Arrears, so only this select proves edit mode for every type.
  await waitFor(() => expect(document.getElementById('cadence-owner-line-1')).not.toBeNull());
}

describe('ContractLines arrears first-invoice hint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getContractLineEditVersion.mockResolvedValue('v1');
    actionMocks.saveContractLineEdit.mockResolvedValue({ status: 'saved', line: { contract_line_id: 'line-1' }, version: 'v2', rematerialized: false });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));
    actionMocks.checkContractHasInvoices.mockResolvedValue(false);
    actionMocks.getActiveClientLocationsForBilling.mockResolvedValue([]);
    actionMocks.getTemplateLineServicesWithConfigurations.mockResolvedValue([]);
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([]);
    actionMocks.listBucketPoolsForLine.mockResolvedValue([]);
    actionMocks.getServices.mockResolvedValue({ services: [], totalCount: 0 });
    actionMocks.getDetailedContractLines.mockResolvedValue([line()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('follows the pending Billing Timing select', async () => {
    renderLines();
    await expandAndEdit();

    await waitFor(() => expect(hint()).not.toBeNull());
    expect(hint()!.textContent).toContain('the 2026-11-01 invoice covers 2026-10-20 – 2026-10-31');
    // Read-only hint: no button on edit surfaces.
    expect(document.getElementById('first-invoice-hint-line-1-bill-in-advance')).toBeNull();

    fireEvent.change(timingSelect(), { target: { value: 'advance' } });
    await waitFor(() => expect(hint()).toBeNull());

    fireEvent.change(timingSelect(), { target: { value: 'arrears' } });
    await waitFor(() => expect(hint()).not.toBeNull());
  });

  it('follows the pending Cadence Owner select too (contract cadence is never mid-period)', async () => {
    renderLines();
    await expandAndEdit();
    await waitFor(() => expect(hint()).not.toBeNull());

    fireEvent.change(document.getElementById('cadence-owner-line-1')!, { target: { value: 'contract' } });
    await waitFor(() => expect(hint()).toBeNull());
  });

  it('hides for Hourly lines', async () => {
    actionMocks.getDetailedContractLines.mockResolvedValue([line({ contract_line_type: 'Hourly' })]);
    renderLines();
    await expandAndEdit();
    await Promise.resolve();
    expect(hint()).toBeNull();
  });

  it('hides when the start date is far enough in the past that the first invoice has opened', async () => {
    renderLines('2026-08-20');
    await expandAndEdit();
    await Promise.resolve();
    expect(hint()).toBeNull();
  });

  it('hides without a start date', async () => {
    renderLines(null);
    await expandAndEdit();
    await Promise.resolve();
    expect(hint()).toBeNull();
  });
});
