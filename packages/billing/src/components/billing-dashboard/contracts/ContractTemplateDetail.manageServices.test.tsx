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
  useFormatters: () => ({ locale: 'en-US' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('contractId=template-1'),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [],
}));
vi.mock('../contract-lines/GenericContractLineServicesList', () => ({
  default: () => <div />,
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
    expect(screen.getByText(/123\.45/)).toHaveTextContent('€');
  });
});
