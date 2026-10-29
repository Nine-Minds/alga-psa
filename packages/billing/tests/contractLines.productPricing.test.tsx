// @vitest-environment jsdom

/**
 * Contract Lines shows the effective unit price of a recurring product member
 * (resolved through the shared recurring-member rate chain), labelled "catalog"
 * or "override", with its cost beside it for users who may see cost.
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
  getServiceCatalogRatesForCurrency: vi.fn(),
  getServiceCatalogCostInfo: vi.fn(),
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
  getServiceCatalogRatesForCurrency: actionMocks.getServiceCatalogRatesForCurrency,
  getServiceCatalogCostInfo: actionMocks.getServiceCatalogCostInfo,
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
    formatCurrency: (value: number, currency: string) => `${currency} ${value.toFixed(2)}`,
    formatDate: (value: string) => value,
  }),
}));

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    money: (minorUnits: number, currency: string) => `${currency} ${(minorUnits / 100).toFixed(2)}`,
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

import { resetProductCatalogRatesCache } from '../src/hooks/useProductCatalogRates';

const productMember = (
  serviceId: string,
  name: string,
  configId: string,
  customRate: number | null,
  extra: { baseRate?: number | null; serviceLineCustomRate?: number | null } = {},
) => ({
  service: {
    service_id: serviceId,
    service_name: name,
    service_type_name: 'Hardware',
    billing_method: 'per_unit',
    item_kind: 'product',
    is_active: true,
  },
  configuration: {
    config_id: configId,
    contract_line_id: 'line-1',
    service_id: serviceId,
    configuration_type: 'Fixed',
    custom_rate: customRate,
    quantity: 3,
  },
  typeConfig: { pricing_basis: 'unit', base_rate: extra.baseRate ?? null },
  bucketConfig: null,
  service_line_custom_rate: extra.serviceLineCustomRate ?? null,
});

const renderContractLines = () => render(
  <ContractLines
    contract={{
      contract_id: 'contract-1',
      contract_name: 'Managed Services',
      currency_code: 'AUD',
      is_template: false,
    } as any}
  />
);

describe('Contract Lines recurring product pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProductCatalogRatesCache();
    actionMocks.checkContractHasInvoices.mockResolvedValue(false);
    actionMocks.getActiveClientLocationsForBilling.mockResolvedValue([]);
    actionMocks.getTemplateLineServicesWithConfigurations.mockResolvedValue([]);
    actionMocks.listBucketPoolsForLine.mockResolvedValue([]);
    actionMocks.getServices.mockResolvedValue({ services: [], totalCount: 0 });
    actionMocks.getDetailedContractLines.mockResolvedValue([{
      tenant: 'tenant-1',
      contract_id: 'contract-1',
      contract_line_id: 'line-1',
      display_order: 1,
      created_at: new Date(),
      contract_line_name: 'Hardware line',
      billing_frequency: 'monthly',
      billing_timing: 'advance',
      cadence_owner: 'client',
      contract_line_type: 'Fixed',
      default_rate: null,
      location_id: null,
    }]);
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([
      productMember('svc-catalog', 'Catalog laptop', 'config-catalog', null),
      productMember('svc-override', 'Overridden laptop', 'config-override', 4500),
    ]);
    actionMocks.getServiceCatalogRatesForCurrency.mockResolvedValue({ 'svc-catalog': 12000, 'svc-override': 12000 });
    actionMocks.getServiceCatalogCostInfo.mockResolvedValue({
      canViewCost: true,
      items: {
        'svc-catalog': { default_rate: 9900, cost: 8000, cost_currency: 'AUD' },
        'svc-override': { default_rate: 9900, cost: 3000, cost_currency: 'NZD' },
      },
    });
  });

  const expand = async () => {
    renderContractLines();
    fireEvent.click(await screen.findByLabelText('Expand contract line'));
  };

  it('shows the catalog unit price, the catalog label and the cost for a catalog-priced member', async () => {
    await expand();

    expect((await screen.findByTestId('recurring-product-price-config-catalog')).textContent).toBe('AUD 120.00');
    const price = screen.getByTestId('recurring-product-price-config-catalog').parentElement!;
    expect(price.textContent).toContain('(catalog)');
    expect(price.textContent).not.toContain('N/A');
    expect(screen.getByTestId('recurring-product-cost-config-catalog').textContent)
      .toBe('Cost: AUD 80.00 · Margin: AUD 40.00 per unit');
  });

  it('shows the override price and label for an overridden member, with the cost currency labelled and no margin', async () => {
    await expand();

    expect((await screen.findByTestId('recurring-product-price-config-override')).textContent).toBe('AUD 45.00');
    expect(screen.getByTestId('recurring-product-price-config-override').parentElement!.textContent)
      .toContain('(override)');
    // Cost is tracked in another currency: labelled, never converted, no margin. The override
    // prices the member before the catalog lookup lands, so wait for the cost to arrive.
    expect((await screen.findByTestId('recurring-product-cost-config-override')).textContent)
      .toBe('Cost in NZD: NZD 30.00');
  });

  it('hides cost for a user without the cost-visibility permission', async () => {
    actionMocks.getServiceCatalogCostInfo.mockResolvedValue({
      canViewCost: false,
      items: {
        'svc-catalog': { default_rate: 9900, cost: null, cost_currency: null },
        'svc-override': { default_rate: 9900, cost: null, cost_currency: null },
      },
    });
    await expand();

    expect(await screen.findByTestId('recurring-product-price-config-catalog')).not.toBeNull();
    expect(screen.queryByTestId('recurring-product-cost-config-catalog')).toBeNull();
    expect(screen.queryByTestId('recurring-product-cost-config-override')).toBeNull();
    expect(screen.queryByText(/Cost/)).toBeNull();
  });

  it('prices like the invoice engine: a fixed-config base_rate is not an override, a service-line rate is', async () => {
    // A quote-converted member carries a real base_rate; the engine ignores it for products.
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([
      productMember('svc-catalog', 'Quoted laptop', 'config-quoted', null, { baseRate: 7777 }),
      productMember('svc-override', 'Legacy laptop', 'config-legacy', null, { serviceLineCustomRate: 5000 }),
    ]);
    await expand();

    const quoted = await screen.findByTestId('recurring-product-price-config-quoted');
    expect(quoted.textContent).toBe('AUD 120.00');
    expect(quoted.parentElement!.textContent).toContain('(catalog)');
    const legacy = screen.getByTestId('recurring-product-price-config-legacy');
    expect(legacy.textContent).toBe('AUD 50.00');
    expect(legacy.parentElement!.textContent).toContain('(override)');
  });

  it('says a member has no price when nothing in the chain prices it, instead of an amount', async () => {
    actionMocks.getContractLineServicesWithConfigurations.mockResolvedValue([
      productMember('svc-unpriced', 'Unpriced laptop', 'config-unpriced', null, { baseRate: 7777 }),
    ]);
    actionMocks.getServiceCatalogRatesForCurrency.mockResolvedValue({ 'svc-unpriced': null });
    actionMocks.getServiceCatalogCostInfo.mockResolvedValue({
      canViewCost: true,
      items: { 'svc-unpriced': { default_rate: null, cost: null, cost_currency: null } },
    });
    await expand();

    expect((await screen.findByTestId('recurring-product-missing-price-config-unpriced')).textContent)
      .toBe('No AUD price in the catalog. Enter a unit price.');
    expect(screen.queryByText(/77\.77/)).toBeNull();
  });
});
