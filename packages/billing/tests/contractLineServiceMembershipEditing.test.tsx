// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContractLines from '../src/components/billing-dashboard/contracts/ContractLines';
import { ServiceSelectionDialog } from '../src/components/billing-dashboard/service-config/ServiceSelectionDialog';

const actionMocks = vi.hoisted(() => ({
  applyContractLineServiceMembershipChanges: vi.fn(),
  checkContractHasInvoices: vi.fn(),
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

vi.mock('@alga-psa/billing/actions/contractLineSemanticsActions', () => ({getNextContractServiceBoundary: vi.fn(async () => '2026-10-01')}));

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

vi.mock('@alga-psa/billing/actions/billingClientLocationActions', () => ({
  getActiveClientLocationsForBilling: actionMocks.getActiveClientLocationsForBilling,
}));

const translate = (_key: string, options?: Record<string, unknown>) => {
  let value = String(options?.defaultValue ?? _key);
  for (const [name, replacement] of Object.entries(options ?? {})) {
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
  useFormatters: () => ({
    formatCurrency: (value: number, currency: string) => `${currency} ${value}`,
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

vi.mock('@alga-psa/core', () => ({
  getCurrencySymbol: () => '$',
}));

vi.mock('@radix-ui/themes', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: React.ReactNode;
    children: React.ReactNode;
    footer: React.ReactNode;
  }) => isOpen ? (
    <div role="dialog">
      <h1>{title}</h1>
      {children}
      {footer}
    </div>
  ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  default: ({ text }: { text?: React.ReactNode }) => <div>{text}</div>,
}));

vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({
  SwitchWithLabel: () => null,
}));

vi.mock('@alga-psa/ui/components/Table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr {...props}>{children}</tr>
  ),
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

const existingServiceConfiguration = {
  service: {
    service_id: 'existing-service',
    service_name: 'Existing service',
    service_type_name: 'Support',
    unit_of_measure: 'item',
    default_rate: 12000,
    billing_method: 'fixed',
    item_kind: 'service',
    is_active: true,
  },
  configuration: {
    config_id: 'existing-config',
    contract_line_id: 'line-1',
    service_id: 'existing-service',
    configuration_type: 'Fixed',
    custom_rate: 12000,
    quantity: 1,
  },
  typeConfig: { base_rate: 12000 },
  bucketConfig: null,
};

const availableServices = [
  existingServiceConfiguration.service,
  {
    service_id: 'new-service',
    service_name: 'New service',
    service_type_name: 'Support',
    unit_of_measure: 'item',
    default_rate: 18000,
    billing_method: 'fixed',
    item_kind: 'service',
    is_active: true,
    prices: [{ currency_code: 'USD', rate: 25000 }],
  },
];

const renderContractLines = () => render(
  <ContractLines
    contract={{
      contract_id: 'contract-1',
      contract_name: 'Managed Services',
      currency_code: 'USD',
      is_template: false,
    } as any}
  />
);

describe('contract line service membership editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.applyContractLineServiceMembershipChanges.mockResolvedValue(true);
    actionMocks.checkContractHasInvoices.mockResolvedValue(false);
    actionMocks.getActiveClientLocationsForBilling.mockResolvedValue([]);
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([
      existingServiceConfiguration,
    ]);
    actionMocks.getTemplateLineServicesWithConfigurations.mockResolvedValue([]);
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
      contract_line_type: 'Fixed',
      default_rate: 10000,
      location_id: null,
    }]);
    actionMocks.getServices.mockResolvedValue({
      services: availableServices,
      totalCount: availableServices.length,
    });
    actionMocks.updateConfiguration.mockResolvedValue(true);
    actionMocks.updateContractLine.mockResolvedValue({ contract_line_id: 'line-1' });
    actionMocks.upsertBucketConfiguration.mockResolvedValue(true);
  });

  it('returns selected services to the editor with contract-currency defaults without persisting them', async () => {
    const onClose = vi.fn();
    const onServicesSelected = vi.fn();

    render(
      <ServiceSelectionDialog
        isOpen
        onClose={onClose}
        contractLineType="Fixed"
        currencyCode="USD"
        existingServiceIds={['existing-service']}
        onServicesSelected={onServicesSelected}
      />
    );

    expect(await screen.findByText('New service')).not.toBeNull();
    expect(screen.queryByText('Existing service')).toBeNull();
    expect(screen.getByText('USD 250')).not.toBeNull();

    fireEvent.click(screen.getByText('New service'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Selected Services' }));

    await waitFor(() => expect(onServicesSelected).toHaveBeenCalledWith([
      expect.objectContaining({
        service: expect.objectContaining({ service_id: 'new-service' }),
        quantity: 1,
        customRate: 25000,
        configurationType: 'Fixed',
        typeConfig: { base_rate: 25000 },
      }),
    ]));
    expect(actionMocks.applyContractLineServiceMembershipChanges).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stages additions and removals, then restores persisted membership on Cancel', async () => {
    renderContractLines();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByText('Existing service')).not.toBeNull();

    fireEvent.click(document.getElementById('remove-service-existing-config')!);
    expect(screen.queryByText('Existing service')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByText('New service'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Selected Services' }));
    expect(await screen.findByText('New service')).not.toBeNull();
    expect(actionMocks.applyContractLineServiceMembershipChanges).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Existing service')).not.toBeNull();
    expect(screen.queryByText('New service')).toBeNull();
    expect(actionMocks.applyContractLineServiceMembershipChanges).not.toHaveBeenCalled();
  });

  it('ordinary seat edits remain available after billing and submit a prospective boundary without changing line settings', async () => {
    actionMocks.checkContractHasInvoices.mockResolvedValue(true);
    const seats = {...existingServiceConfiguration, typeConfig: {base_rate: 10000, pricing_basis: 'unit'}};
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([seats]);
    actionMocks.getConfigurationWithDetails.mockResolvedValue({baseConfig: {...seats.configuration, quantity: 10}, typeConfig: seats.typeConfig});
    renderContractLines();
    fireEvent.click(await screen.findByRole('button', {name: 'Edit'}));
    await waitFor(() => expect((document.getElementById('quantity-existing-config') as HTMLInputElement)?.value).toBe('10'));
    expect((document.getElementById('quantity-effective-line-1') as HTMLInputElement).value).toBe('2026-10-01');
    expect(screen.getByText('Recurring seats/units')).not.toBeNull();
    fireEvent.change(document.getElementById('quantity-existing-config')!, {target: {value: '0'}});
    fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    await waitFor(() => expect(actionMocks.updateConfiguration).toHaveBeenCalledWith('existing-config', expect.objectContaining({quantity: 0}), expect.objectContaining({effective_period_start: '2026-10-01', base_rate: 10000})));
    expect(actionMocks.updateContractLine).not.toHaveBeenCalled();
    expect(actionMocks.applyContractLineServiceMembershipChanges).not.toHaveBeenCalled();
  });
  it('persists the complete staged membership change only when the outer editor is saved', async () => {
    renderContractLines();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByText('Existing service')).not.toBeNull();
    fireEvent.click(document.getElementById('remove-service-existing-config')!);

    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByText('New service'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Selected Services' }));
    expect(await screen.findByText('New service')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(actionMocks.applyContractLineServiceMembershipChanges).toHaveBeenCalledWith(
      'line-1',
      {
        additions: [{
          serviceId: 'new-service',
          quantity: 1,
          customRate: 25000,
          configurationType: 'Fixed',
          typeConfig: { base_rate: 25000 },
        }],
        removals: ['existing-service'],
      },
    ));
  });

  it('preserves the selected base rate when creating a usage-service configuration', async () => {
    const onServicesSelected = vi.fn();
    render(
      <ServiceSelectionDialog
        isOpen
        onClose={vi.fn()}
        contractLineType="Usage"
        currencyCode="USD"
        existingServiceIds={['existing-service']}
        onServicesSelected={onServicesSelected}
      />
    );

    fireEvent.click(await screen.findByText('New service'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Selected Services' }));

    await waitFor(() => expect(onServicesSelected).toHaveBeenCalledWith([
      expect.objectContaining({
        configurationType: 'Usage',
        typeConfig: {
          base_rate: 25000,
          unit_of_measure: 'item',
        },
      }),
    ]));
  });
});


describe('active usage line measurement editing', () => {
  const usage = {
    ...existingServiceConfiguration,
    configuration: {...existingServiceConfiguration.configuration, configuration_type: 'Usage', quantity: 9},
    typeConfig: {measurement_mode: 'additive', base_rate: 10000, minimum_usage: 5, unit_of_measure: 'seat', enable_tiered_pricing: false},
    rateTiers: [],
  };
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.checkContractHasInvoices.mockResolvedValue(true);
    actionMocks.getDetailedContractLines.mockResolvedValue([{
      contract_line_id: 'line-1', contract_line_name: 'Usage agreement', contract_line_type: 'Usage', billing_frequency: 'monthly', display_order: 0,
    }]);
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([usage]);
    actionMocks.getConfigurationWithDetails.mockResolvedValue({baseConfig: {...usage.configuration, custom_rate: 11000}, typeConfig: {...usage.typeConfig, minimum_usage: 7}, rateTiers: []});
    actionMocks.updateConfiguration.mockResolvedValue(true);
  });
  const edit = async () => {
    renderContractLines();
    fireEvent.click(await screen.findByRole('button', {name: 'Edit'}));
    await waitFor(() => expect((document.getElementById('existing-config-minimum-usage') as HTMLInputElement)?.value).toBe('7'));
  };
  it('loads effective pricing and schedules measurement, minimum and tiers together after billing', async () => {
    await edit();
    expect(actionMocks.getConfigurationWithDetails).toHaveBeenCalledWith('existing-config', '2026-10-01');
    expect(document.getElementById('quantity-existing-config')).toBeNull();
    fireEvent.click(document.querySelector('input[name="existing-config-usage-measurement-mode"][value="period_total"]')!);
    expect(screen.getByText('Minimum per period report')).toBeTruthy();
    fireEvent.change(document.getElementById('existing-config-minimum-usage')!, {target: {value: '9'}});
    fireEvent.change(document.getElementById('rate-existing-config')!, {target: {value: '120.50'}});
    fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    await waitFor(() => expect(actionMocks.updateConfiguration).toHaveBeenCalledWith('existing-config',
      {custom_rate: 12050}, expect.objectContaining({measurement_mode: 'period_total', minimum_usage: 9, base_rate: 12050, effective_period_start: '2026-10-01'}), []));
    expect(actionMocks.updateContractLine).not.toHaveBeenCalled();
    expect(actionMocks.applyContractLineServiceMembershipChanges).not.toHaveBeenCalled();
  });
  it('reloads the effective settings when the boundary changes and preserves that exact date on Save', async () => {
    actionMocks.getConfigurationWithDetails.mockResolvedValue({
      baseConfig: {...usage.configuration, custom_rate: 11000},
      typeConfig: {...usage.typeConfig, minimum_usage: 7, enable_tiered_pricing: true},
      rateTiers: [{tier_id: 'old-tier', min_quantity: 0, max_quantity: 100, rate: 5000}],
    });
    await edit();
    expect(document.getElementById('existing-config-tier-old-tier-rate')).toBeTruthy();
    actionMocks.getConfigurationWithDetails.mockResolvedValue({baseConfig: {...usage.configuration, custom_rate: 13000}, typeConfig: {...usage.typeConfig, measurement_mode: 'period_total', minimum_usage: 12}, rateTiers: []});
    fireEvent.change(document.getElementById('quantity-effective-line-1')!, {target: {value: '2026-11-01'}});
    await waitFor(() => expect((document.getElementById('existing-config-minimum-usage') as HTMLInputElement).value).toBe('12'));
    expect(document.getElementById('existing-config-tier-old-tier-rate')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    await waitFor(() => expect(actionMocks.updateConfiguration).toHaveBeenCalledWith('existing-config',
      {custom_rate: 13000}, expect.objectContaining({measurement_mode: 'period_total', minimum_usage: 12, effective_period_start: '2026-11-01'}), []));
  });
  it('requires the displayed effective boundary instead of silently substituting one', async () => {
    await edit();
    fireEvent.change(document.getElementById('quantity-effective-line-1')!, {target: {value: ''}});
    expect((screen.getByRole('button', {name: 'Save'}) as HTMLButtonElement).disabled).toBe(true);
    expect(actionMocks.updateConfiguration).not.toHaveBeenCalled();
  });
  it('keeps the editor open when the effective-period transition is rejected', async () => {
    await edit();
    actionMocks.updateConfiguration.mockRejectedValue(new Error('Existing usage blocks this boundary. Choose a later period.'));
    fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    expect(await screen.findByText(/Existing usage blocks this boundary/)).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Save'})).toBeTruthy();
  });
});
