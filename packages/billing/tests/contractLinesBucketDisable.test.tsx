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

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));

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

const hourlyService = (serviceId: string, serviceName: string, configId: string, bucketConfig: unknown) => ({
  service: {
    service_id: serviceId,
    service_name: serviceName,
    service_type_name: 'Support',
    unit_of_measure: 'hour',
    default_rate: 15000,
    billing_method: 'per_unit',
    item_kind: 'service',
    is_active: true,
  },
  configuration: {
    config_id: configId,
    contract_line_id: 'line-1',
    service_id: serviceId,
    configuration_type: 'Hourly',
    custom_rate: 15000,
    quantity: 1,
  },
  typeConfig: { hourly_rate: 15000 },
  bucketConfig,
});

const savedOverlay = {
  total_minutes: 600,
  overage_rate: 18000,
  allow_rollover: false,
  billing_period: 'monthly',
};

const withOverlay = () => hourlyService('svc-bucketed', 'Bucketed support', 'config-bucketed', savedOverlay);
const withoutOverlay = () => hourlyService('svc-plain', 'Plain support', 'config-plain', null);

/**
 * A bucket enabled from this screen is persisted as a single-member pool, so
 * that is how a saved overlay comes back on reload.
 */
const singleMemberPool = (serviceId: string) => ({
  bucket_id: `pool-${serviceId}`,
  contract_line_id: 'line-1',
  bucket_name: null,
  total_minutes: 600,
  overage_rate: 18000,
  allow_rollover: false,
  billing_period: 'monthly' as const,
  covers_all_services: false,
  after_hours_multiplier: null,
  business_hours_schedule_id: null,
  members: [{ service_id: serviceId, service_name: serviceId, burn_multiplier: 1 }],
  dormant: false,
});

const sharedPool = (serviceIds: string[]) => ({
  ...singleMemberPool('shared'),
  bucket_id: 'pool-shared',
  members: serviceIds.map((serviceId) => ({
    service_id: serviceId,
    service_name: serviceId,
    burn_multiplier: 1,
  })),
});

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

describe('disabling a bucket on a contract line service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.applyContractLineServiceMembershipChanges.mockResolvedValue(true);
    actionMocks.checkContractHasInvoices.mockResolvedValue(false);
    actionMocks.getActiveClientLocationsForBilling.mockResolvedValue([]);
    actionMocks.getTemplateLineServicesWithConfigurations.mockResolvedValue([]);
    actionMocks.deleteBucketOverlay.mockResolvedValue(undefined);
    actionMocks.listBucketPoolsForLine.mockResolvedValue([]);
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
    }]);
    actionMocks.getServices.mockResolvedValue({ services: [], totalCount: 0 });
    actionMocks.updateConfiguration.mockResolvedValue(true);
    actionMocks.updateContractLine.mockResolvedValue({ contract_line_id: 'line-1' });
    actionMocks.upsertBucketConfiguration.mockResolvedValue(true);
  });

  it('deletes the saved overlay on save and it stays gone after the reload', async () => {
    // First load carries the overlay; every reload after the save reflects the
    // persisted deletion.
    actionMocks.getContractLineServicesWithConfigurations
      .mockResolvedValueOnce([withOverlay(), withoutOverlay()])
      .mockResolvedValue([withoutOverlay(), hourlyService('svc-bucketed', 'Bucketed support', 'config-bucketed', null)]);

    renderContractLines();

    fireEvent.click(await screen.findByLabelText('Expand contract line'));
    expect(await screen.findByText('Bucket Configuration')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const switches = await waitFor(() => {
      const found = screen.getAllByLabelText('Enable bucket usage tracking');
      expect(found).toHaveLength(2);
      return found as HTMLInputElement[];
    });
    // Only the service with a saved overlay starts switched on.
    expect(switches[0].checked).toBe(true);
    expect(switches[1].checked).toBe(false);

    fireEvent.click(switches[0]);
    await waitFor(() => expect((screen.getAllByLabelText('Enable bucket usage tracking')[0] as HTMLInputElement).checked).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(actionMocks.deleteBucketOverlay).toHaveBeenCalledWith('line-1', 'svc-bucketed'));
    expect(actionMocks.deleteBucketOverlay).toHaveBeenCalledTimes(1);
    // Never for the service that had no overlay to begin with, and never as an upsert.
    expect(actionMocks.deleteBucketOverlay).not.toHaveBeenCalledWith('line-1', 'svc-plain');
    expect(actionMocks.upsertBucketConfiguration).not.toHaveBeenCalled();

    // The reloaded line no longer renders the overlay summary.
    await waitFor(() => expect(screen.queryByText('Bucket Configuration')).toBeNull());
  });

  it('starts switched on for a pool-backed overlay and deletes it on save', async () => {
    // Buckets saved from this screen land in a pool, not in a per-service
    // Bucket configuration row, so the switch has to read the pool back or the
    // disable intent is lost.
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([
      hourlyService('svc-bucketed', 'Bucketed support', 'config-bucketed', null),
      withoutOverlay(),
    ]);
    actionMocks.listBucketPoolsForLine
      .mockResolvedValueOnce([singleMemberPool('svc-bucketed')])
      .mockResolvedValue([]);

    renderContractLines();

    fireEvent.click(await screen.findByLabelText('Expand contract line'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    const switches = await waitFor(() => {
      const found = screen.getAllByLabelText('Enable bucket usage tracking') as HTMLInputElement[];
      expect(found[0].checked).toBe(true);
      return found;
    });
    expect(switches[1].checked).toBe(false);

    fireEvent.click(switches[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(actionMocks.deleteBucketOverlay).toHaveBeenCalledWith('line-1', 'svc-bucketed'));
    expect(actionMocks.deleteBucketOverlay).toHaveBeenCalledTimes(1);
    expect(actionMocks.upsertBucketConfiguration).not.toHaveBeenCalled();

    // Re-entering edit after the save reads the pools again: the bucket stays off.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await waitFor(() => {
      const found = screen.getAllByLabelText('Enable bucket usage tracking') as HTMLInputElement[];
      expect(found[0].checked).toBe(false);
    });
  });

  it('leaves a service that draws from a shared pool to the pool editor', async () => {
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([
      hourlyService('svc-bucketed', 'Bucketed support', 'config-bucketed', null),
      withoutOverlay(),
    ]);
    actionMocks.listBucketPoolsForLine.mockResolvedValue([sharedPool(['svc-bucketed', 'svc-plain'])]);

    renderContractLines();

    fireEvent.click(await screen.findByLabelText('Expand contract line'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(screen.getAllByLabelText('Enable bucket usage tracking')).toHaveLength(2));

    for (const toggle of screen.getAllByLabelText('Enable bucket usage tracking') as HTMLInputElement[]) {
      expect(toggle.checked).toBe(false);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(actionMocks.updateContractLine).toHaveBeenCalled());
    expect(actionMocks.deleteBucketOverlay).not.toHaveBeenCalled();
    expect(actionMocks.upsertBucketConfiguration).not.toHaveBeenCalled();
  });

  it('leaves an untouched overlay alone', async () => {
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([withOverlay(), withoutOverlay()]);

    renderContractLines();

    fireEvent.click(await screen.findByLabelText('Expand contract line'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(screen.getAllByLabelText('Enable bucket usage tracking')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(actionMocks.updateContractLine).toHaveBeenCalled());
    expect(actionMocks.deleteBucketOverlay).not.toHaveBeenCalled();
    expect(actionMocks.upsertBucketConfiguration).toHaveBeenCalledWith('line-1', 'svc-bucketed', {
      total_minutes: 600,
      overage_rate: 18000,
      allow_rollover: false,
      billing_period: 'monthly',
    });
  });
});

describe('contract line number inputs ignore the mouse wheel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.checkContractHasInvoices.mockResolvedValue(false);
    actionMocks.getActiveClientLocationsForBilling.mockResolvedValue([]);
    actionMocks.getTemplateLineServicesWithConfigurations.mockResolvedValue([]);
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([withoutOverlay()]);
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
      minimum_billable_time: 15,
      round_up_to_nearest: 15,
      location_id: null,
    }]);
    actionMocks.getServices.mockResolvedValue({ services: [], totalCount: 0 });
  });

  it('blurs the rate and rounding fields instead of stepping their values', async () => {
    renderContractLines();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    const rate = await waitFor(() => {
      const node = document.getElementById('rate-config-plain') as HTMLInputElement | null;
      expect(node).not.toBeNull();
      return node!;
    });

    for (const field of [
      rate,
      document.getElementById('min-billable-line-1') as HTMLInputElement,
      document.getElementById('round-up-line-1') as HTMLInputElement,
    ]) {
      const before = field.value;
      field.focus();
      expect(document.activeElement).toBe(field);

      fireEvent.wheel(field, { deltaY: -100 });

      expect(document.activeElement).not.toBe(field);
      expect(field.value).toBe(before);
    }

    expect(rate.value).toBe('150.00');
  });
});
