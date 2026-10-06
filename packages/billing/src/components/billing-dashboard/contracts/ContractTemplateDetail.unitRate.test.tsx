/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// ──────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────────────────────────────────────
const getContractByIdMock = vi.hoisted(() => vi.fn());
const getContractSummaryMock = vi.hoisted(() => vi.fn());
const getDetailedContractLinesMock = vi.hoisted(() => vi.fn());
const getContractAssignmentsMock = vi.hoisted(() => vi.fn());
const getTemplateLineServicesMock = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ contractId: 'template-1' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`contractId=${route.contractId}`),
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
  useFormatters: () => ({
    locale: 'en-US',
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en-US', options).format(value),
  }),
}));

vi.mock('../contract-lines/GenericContractLineServicesList', () => ({ default: () => null }));
vi.mock('./ContractLineEditDialog', () => ({ ContractLineEditDialog: () => null }));

import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import ContractTemplateDetail from './ContractTemplateDetail';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────
const SERVICE_ID = 'service-seat-1';

// Templates are currency-neutral. The real loader (getContractById ->
// mapTemplateToContract in contractActions.ts) always returns a template-mapped
// contract with currency_code 'USD' and is_template true, so that is the only
// shape this test may feed the component.
const CURRENCY_MARKERS = /[$€£¥]|USD|EUR|GBP|JPY/;

function primeTemplate(opts: { unitRate: number | null; lineRate?: number | null }) {
  getContractByIdMock.mockResolvedValue({
    tenant: 'tenant-1',
    contract_id: 'template-1',
    contract_name: 'Seat Template',
    contract_description: undefined,
    billing_frequency: 'monthly',
    currency_code: 'USD',
    is_active: true,
    status: 'published',
    is_template: true,
    template_metadata: undefined,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
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
      rate: opts.lineRate ?? null,
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

describe('ContractTemplateDetail per-seat unit rate (currency-neutral)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.contractId = 'template-1';
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the unit rate and quantity × rate = amount as plain numbers with no currency symbol', async () => {
    primeTemplate({ unitRate: 25000 });

    renderDetail();

    const amount = await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    expect(screen.queryByText(/formatCurrency is not defined/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to load contract template')).not.toBeInTheDocument();

    const unitRateRow = screen.getByText('Unit rate:').parentElement as HTMLElement;
    expect(unitRateRow).toHaveTextContent("Unit rate: 250.00 in the client's currency");
    expect(unitRateRow.textContent).not.toMatch(CURRENCY_MARKERS);

    expect(amount).toHaveTextContent("Recurring amount: 2 × 250.00 = 500.00 in the client's currency");
    expect(amount.textContent).not.toMatch(CURRENCY_MARKERS);
    expect(within(amount).getByText(/2 ×/)).toBeInTheDocument();
  });

  it('shows catalog-price text and no amount block when the unit rate is null', async () => {
    primeTemplate({ unitRate: null });

    renderDetail();

    const catalog = await screen.findByText("Catalog price in the client's currency");
    expect(catalog).toBeInTheDocument();
    expect((screen.getByText('Unit rate:').parentElement as HTMLElement).textContent).not.toMatch(
      CURRENCY_MARKERS,
    );
    expect(screen.queryByTestId(`template-recurring-amount-${SERVICE_ID}`)).not.toBeInTheDocument();
  });

  it('does not reload the template when a render receives a new translator', async () => {
    primeTemplate({ unitRate: 25000 });

    const view = renderDetail();
    await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    expect(getContractByIdMock).toHaveBeenCalledTimes(1);

    // The i18n mock returns a fresh t function on each render. A parent render
    // must not turn that into another request or an update loop.
    view.rerender(
      <CurrencyFormatProvider currencyCode="USD">
        <ContractTemplateDetail />
      </CurrencyFormatProvider>,
    );

    expect(getContractByIdMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(`template-recurring-amount-${SERVICE_ID}`)).toHaveTextContent(
      "Recurring amount: 2 × 250.00 = 500.00 in the client's currency",
    );
  });

  it('renders the fixed-fee base rate in the services manager neutrally, and "Not set" when absent', async () => {
    primeTemplate({ unitRate: 25000, lineRate: 10000 });

    renderDetail();

    await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    fireEvent.click(screen.getByRole('button', { name: 'Manage Services' }));

    const badge = (await screen.findByText(/Fixed Fee Rate:/)) as HTMLElement;
    expect(badge).toHaveTextContent("Fixed Fee Rate: 100.00 in the client's currency");
    expect(badge.textContent).not.toMatch(CURRENCY_MARKERS);
  });

  it('shows "Not set" for a fixed-fee base rate that has no value', async () => {
    primeTemplate({ unitRate: 25000, lineRate: null });

    renderDetail();

    await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    fireEvent.click(screen.getByRole('button', { name: 'Manage Services' }));

    expect(await screen.findByText(/Fixed Fee Rate:/)).toHaveTextContent('Fixed Fee Rate: Not set');
  });

  it('closes the services manager when the route changes before the next template loads', async () => {
    primeTemplate({ unitRate: 25000, lineRate: null });
    const view = renderDetail();
    await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    fireEvent.click(screen.getByRole('button', { name: 'Manage Services' }));
    expect(screen.getByText(/Fixed Fee Rate:/)).toHaveTextContent('Fixed Fee Rate: Not set');

    // Keep the second template loading, then return to the first. A reset tied
    // to loaded contract data misses this route transition entirely.
    getContractByIdMock.mockImplementationOnce(() => new Promise(() => {}));
    route.contractId = 'template-2';
    view.rerender(
      <CurrencyFormatProvider currencyCode="USD">
        <ContractTemplateDetail />
      </CurrencyFormatProvider>,
    );
    route.contractId = 'template-1';
    view.rerender(
      <CurrencyFormatProvider currencyCode="USD">
        <ContractTemplateDetail />
      </CurrencyFormatProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Manage Services' })).toBeInTheDocument();
    expect(screen.queryByText(/Fixed Fee Rate:/)).not.toBeInTheDocument();
  });
});
