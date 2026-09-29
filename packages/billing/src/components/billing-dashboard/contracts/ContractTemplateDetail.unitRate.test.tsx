/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// ──────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────────────────────────────────────
const getContractByIdMock = vi.hoisted(() => vi.fn());
const getContractSummaryMock = vi.hoisted(() => vi.fn());
const getDetailedContractLinesMock = vi.hoisted(() => vi.fn());
const getContractAssignmentsMock = vi.hoisted(() => vi.fn());
const getTemplateLineServicesMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams('contractId=template-1'),
}));

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  getContractById: async (...args: unknown[]) => getContractByIdMock(...args),
  getContractSummary: async (...args: unknown[]) => getContractSummaryMock(...args),
  getDetailedContractLines: async (...args: unknown[]) => getDetailedContractLinesMock(...args),
  getContractAssignments: async (...args: unknown[]) => getContractAssignmentsMock(...args),
  updateContract: vi.fn(),
  updateContractLineRate: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  getTemplateLineServicesWithConfigurations: async (...args: unknown[]) =>
    getTemplateLineServicesMock(...args),
  getContractLineServicesWithConfigurations: async () => [],
}));

vi.mock('@alga-psa/billing/actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: async () => ({ defaultCurrencyCode: 'USD' }),
}));

vi.mock('@alga-psa/billing/actions/contractSimulationActions', () => ({
  listContractSimulationClients: async () => [],
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
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

vi.mock('../contract-lines/GenericContractLineServicesList', () => ({ default: () => null }));
vi.mock('./ContractLineEditDialog', () => ({ ContractLineEditDialog: () => null }));

import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import ContractTemplateDetail from './ContractTemplateDetail';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────
const SERVICE_ID = 'service-seat-1';

function primeTemplate(opts: { unitRate: number | null; currency?: string }) {
  getContractByIdMock.mockResolvedValue({
    contract_id: 'template-1',
    contract_name: 'Seat Template',
    contract_description: null,
    billing_frequency: 'monthly',
    currency_code: opts.currency ?? 'USD',
    is_template: true,
    template_metadata: null,
  });
  getContractSummaryMock.mockResolvedValue({
    contractLineCount: 1,
    totalClientAssignments: 0,
    activeClientCount: 0,
    poRequiredCount: 0,
  });
  getDetailedContractLinesMock.mockResolvedValue([
    {
      contract_line_id: 'line-1',
      contract_line_name: 'Seats',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      billing_timing: 'arrears',
      rate: null,
    },
  ]);
  getContractAssignmentsMock.mockResolvedValue([]);
  getTemplateLineServicesMock.mockResolvedValue([
    {
      service: { service_id: SERVICE_ID, service_name: 'Seat Service', billing_method: 'fixed' },
      configuration: {
        service_id: SERVICE_ID,
        configuration_type: 'Fixed',
        quantity: 2,
        custom_rate: null,
      },
      typeConfig: { pricing_basis: 'unit', base_rate: opts.unitRate },
      bucketConfig: null,
    },
  ]);
}

function renderDetail() {
  return render(
    <CurrencyFormatProvider currencyCode="USD">
      <ContractTemplateDetail />
    </CurrencyFormatProvider>,
  );
}

describe('ContractTemplateDetail per-seat unit rate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the formatted unit rate and quantity × rate = amount for a unit service', async () => {
    primeTemplate({ unitRate: 25000 });

    renderDetail();

    const amount = await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    expect(screen.queryByText(/formatCurrency is not defined/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to load contract template')).not.toBeInTheDocument();
    expect(screen.getByText('Unit rate:').parentElement).toHaveTextContent('Unit rate: $250.00');
    expect(amount).toHaveTextContent('Recurring amount: 2 × $250.00 = $500.00');
    expect(within(amount).getByText(/2 ×/)).toBeInTheDocument();
  });

  it('formats the rate in the template currency rather than assuming USD', async () => {
    primeTemplate({ unitRate: 25000, currency: 'EUR' });

    renderDetail();

    const amount = await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    expect(amount).toHaveTextContent('2 × €250.00 = €500.00');
    expect(screen.getByText('Unit rate:').parentElement).not.toHaveTextContent('$');
  });

  it('shows catalog-price text and no amount block when the unit rate is null', async () => {
    primeTemplate({ unitRate: null });

    renderDetail();

    expect(await screen.findByText("Catalog price in the client's currency")).toBeInTheDocument();
    expect(screen.queryByTestId(`template-recurring-amount-${SERVICE_ID}`)).not.toBeInTheDocument();
  });
});
