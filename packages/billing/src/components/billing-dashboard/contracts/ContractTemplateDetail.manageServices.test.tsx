/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const actions = vi.hoisted(() => ({
  getContractById: vi.fn(),
  getContractSummary: vi.fn(),
  getContractAssignments: vi.fn(),
  getDetailedContractLines: vi.fn(),
  getTemplateLineServicesWithConfigurations: vi.fn(),
  getDefaultBillingSettings: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => actions);
vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  getContractLineServicesWithConfigurations: vi.fn(),
  getTemplateLineServicesWithConfigurations: (...args: unknown[]) => actions.getTemplateLineServicesWithConfigurations(...args),
}));
vi.mock('@alga-psa/billing/actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: (...args: unknown[]) => actions.getDefaultBillingSettings(...args),
}));
vi.mock('@alga-psa/billing/actions/contractSimulationActions', () => ({
  listContractSimulationClients: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
      if (!fallback) return key;
      if (typeof fallback === 'string') return fallback;
      const base = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key;
      return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
    },
  }),
  useFormatters: () => ({
    locale: 'en-US',
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en-US', options).format(value),
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('contractId=template-1'),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [],
}));
vi.mock('./TemplatePricingSection', () => ({ TemplatePricingSection: () => null }));
vi.mock('../contract-lines/GenericContractLineServicesList', () => ({
  default: ({ contractLineId }: { contractLineId: string }) => (
    <div data-testid={`services-list-${contractLineId}`} />
  ),
}));
vi.mock('./ContractLineEditDialog', () => ({ ContractLineEditDialog: () => null }));

import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import ContractTemplateDetail from './ContractTemplateDetail';

describe('ContractTemplateDetail Manage Services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.getContractById.mockResolvedValue({
      contract_id: 'template-1',
      contract_name: 'Template One',
      contract_type: 'Fixed',
      billing_frequency: 'monthly',
      currency_code: 'EUR',
      status: 'draft',
      is_template: true,
      template_metadata: {},
    });
    actions.getContractSummary.mockResolvedValue({});
    actions.getContractAssignments.mockResolvedValue([]);
    actions.getDetailedContractLines.mockResolvedValue([{
      contract_line_id: 'line-1',
      contract_line_name: 'Support',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      rate: 12345,
    }]);
    actions.getTemplateLineServicesWithConfigurations.mockResolvedValue([]);
    actions.getDefaultBillingSettings.mockResolvedValue({ defaultCurrencyCode: 'USD' });
  });

  afterEach(() => cleanup());

  it('opens the services manager and formats the line rate in the template currency', async () => {
    render(
      <CurrencyFormatProvider currencyCode="USD" locale="en-US">
        <ContractTemplateDetail />
      </CurrencyFormatProvider>,
    );

    expect(await screen.findByText('Support')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Services' }));

    await waitFor(() => expect(screen.getByText('Manage Template Services')).toBeInTheDocument());
    expect(actions.getDetailedContractLines).toHaveBeenCalled();
    // Templates carry a base currency: the rate is formatted in the template's
    // currency (EUR), not the surrounding provider's (USD).
    const rate = screen.getByText(/123\.45/);
    expect(rate).toHaveTextContent('€123.45');
    expect(rate.textContent).not.toMatch(/\$|USD/);
    expect(screen.getByTestId('services-list-line-1')).toBeInTheDocument();
  });

  it('manages services on hourly and usage lines with type-appropriate rate labels', async () => {
    actions.getDetailedContractLines.mockResolvedValue([
      {
        contract_line_id: 'line-hourly',
        contract_line_name: 'Field Work',
        contract_line_type: 'Hourly',
        billing_frequency: 'monthly',
        rate: 15000,
      },
      {
        contract_line_id: 'line-usage',
        contract_line_name: 'Bandwidth',
        contract_line_type: 'Usage',
        billing_frequency: 'monthly',
        rate: null,
      },
    ]);

    render(
      <CurrencyFormatProvider currencyCode="USD" locale="en-US">
        <ContractTemplateDetail />
      </CurrencyFormatProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Services' }));
    await waitFor(() => expect(screen.getByText('Manage Template Services')).toBeInTheDocument());

    // Hourly and usage lines get the same services manager a fixed line does.
    expect(screen.getByTestId('services-list-line-hourly')).toBeInTheDocument();
    expect(screen.getByTestId('services-list-line-usage')).toBeInTheDocument();

    // The rate badge follows the line type, and the fixed-fee rate editor stays
    // fixed-only. The amount is formatted in the template's own base currency.
    expect(screen.getByText(/Hourly rate:/)).toHaveTextContent('€150.00');
    expect(screen.queryByText(/Fixed Fee Rate:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Rate' })).toBeNull();
    // A usage line with no line-level rate shows no rate badge at all: its
    // rates live on the services below.
    expect(screen.queryByText(/Unit rate:/)).toBeNull();
  });

  it('shows effective billing timing in the Template Composition line summaries', async () => {
    actions.getDetailedContractLines.mockResolvedValue([
      {
        contract_line_id: 'line-fixed',
        contract_line_name: 'Managed Bundle',
        contract_line_type: 'Fixed',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        rate: 10000,
      },
      {
        contract_line_id: 'line-hourly',
        contract_line_name: 'Support Hours',
        contract_line_type: 'Hourly',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        rate: 15000,
      },
    ]);

    render(
      <CurrencyFormatProvider currencyCode="USD" locale="en-US">
        <ContractTemplateDetail />
      </CurrencyFormatProvider>,
    );

    // Manage Services is intentionally not opened: this is the default composition view.
    const fixedTiming = await screen.findByTestId('template-composition-line-billing-timing-line-fixed');
    expect(fixedTiming).toHaveTextContent('In Advance');
    // Hourly lines are always arrears, even when stored as advance.
    expect(screen.getByTestId('template-composition-line-billing-timing-line-hourly')).toHaveTextContent(
      'In Arrears',
    );
    expect(screen.queryByText('Manage Template Services')).toBeNull();
  });
});
