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
const updateContractLineRateMock = vi.hoisted(() => vi.fn());
const updateContractMock = vi.hoisted(() => vi.fn());
const realDialog = vi.hoisted(() => ({ Component: null as null | React.ComponentType<any> }));
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
  updateContract: async (...args: unknown[]) => updateContractMock(...args),
  updateContractLineRate: async (...args: unknown[]) => updateContractLineRateMock(...args),
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  getTemplateLineServicesWithConfigurations: async (...args: unknown[]) =>
    getTemplateLineServicesMock(...args),
  getContractLineServicesWithConfigurations: async () => [],
}));

vi.mock('@alga-psa/billing/actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: async () => ({ defaultCurrencyCode: 'EUR' }),
}));

vi.mock('@alga-psa/billing/actions/contractSimulationActions', () => ({
  listContractSimulationClients: async () => [],
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
}));

// `t` must be referentially stable: the component's load effect depends on it.
const stableT = vi.hoisted(() => (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
  if (!fallback) return key;
  if (typeof fallback === 'string') return fallback;
  const base = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key;
  return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
});

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({ t: stableT }),
  useFormatters: () => ({
    locale: 'en-US',
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en-US', options).format(value),
  }),
}));

vi.mock('./TemplatePricingSection', () => ({ TemplatePricingSection: () => null }));
vi.mock('../contract-lines/GenericContractLineServicesList', () => ({ default: () => null }));
// Delegates to the real dialog so the template rate editor is exercised end to end.
vi.mock('./ContractLineEditDialog', async () => {
  const actual = await vi.importActual<typeof import('./ContractLineEditDialog')>('./ContractLineEditDialog');
  return { ContractLineEditDialog: (props: any) => React.createElement(actual.ContractLineEditDialog, props) };
});

import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import ContractTemplateDetail from './ContractTemplateDetail';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────
const SERVICE_ID = 'service-seat-1';

// A template carries its own base currency; every amount on the page is shown in it,
// whatever the tenant default currency is.
const EUR = (amount: string) => new RegExp(`€\\s*${amount}|${amount}\\s*€`);

function primeTemplate(opts: { unitRate: number | null; lineRate?: number | null; currency?: string }) {
  getContractByIdMock.mockResolvedValue({
    tenant: 'tenant-1',
    contract_id: 'template-1',
    contract_name: 'Seat Template',
    contract_description: undefined,
    billing_frequency: 'monthly',
    currency_code: opts.currency ?? 'EUR',
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

function renderDetail(currencyCode = 'USD') {
  // Tenant default is USD while the template is EUR: the template currency wins.
  return render(
    <CurrencyFormatProvider currencyCode={currencyCode}>
      <ContractTemplateDetail />
    </CurrencyFormatProvider>,
  );
}

describe('ContractTemplateDetail per-seat unit rate (template currency)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.contractId = 'template-1';
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the unit rate and quantity × rate = amount in the template base currency', async () => {
    primeTemplate({ unitRate: 25000 });

    renderDetail();

    const amount = await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    expect(screen.queryByText(/formatCurrency is not defined/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to load contract template')).not.toBeInTheDocument();

    const unitRateRow = screen.getByText('Unit rate:').parentElement as HTMLElement;
    expect(unitRateRow.textContent).toMatch(EUR('250[.,]00'));
    expect(unitRateRow.textContent).not.toContain('$');

    expect(amount.textContent).toMatch(/2 ×/);
    expect(amount.textContent).toMatch(EUR('500[.,]00'));
    expect(amount.textContent).not.toContain('$');
    expect(within(amount).getByText(/2 ×/)).toBeInTheDocument();
  });

  it('shows catalog-price text and no amount block when the unit rate is null', async () => {
    primeTemplate({ unitRate: null });

    renderDetail();

    const catalog = await screen.findByText("Catalog price in the client's currency");
    expect(catalog).toBeInTheDocument();
    expect((screen.getByText('Unit rate:').parentElement as HTMLElement).textContent).not.toMatch(/€|\$/);
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
    expect(screen.getByTestId(`template-recurring-amount-${SERVICE_ID}`).textContent).toMatch(EUR('500[.,]00'));
  });

  it('renders the fixed-fee base rate in the services manager in the template currency, and "Not set" when absent', async () => {
    primeTemplate({ unitRate: 25000, lineRate: 10000 });

    renderDetail();

    await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    fireEvent.click(screen.getByRole('button', { name: 'Manage Services' }));

    const badge = (await screen.findByText(/Fixed Fee Rate:/)) as HTMLElement;
    expect(badge.textContent).toMatch(EUR('100[.,]00'));
  });

  it('shows "Not set" for a fixed-fee base rate that has no value', async () => {
    primeTemplate({ unitRate: 25000, lineRate: null });

    renderDetail();

    await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    fireEvent.click(screen.getByRole('button', { name: 'Manage Services' }));

    expect(await screen.findByText(/Fixed Fee Rate:/)).toHaveTextContent('Fixed Fee Rate: Not set');
  });

  it('opens the template rate editor with the template currency symbol and saves 200.00 as 20000 minor units', async () => {
    primeTemplate({ unitRate: 25000, lineRate: 10000 });
    updateContractLineRateMock.mockResolvedValue({});

    renderDetail();

    await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    fireEvent.click(screen.getByRole('button', { name: 'Manage Services' }));
    await screen.findByText(/Fixed Fee Rate:/);
    fireEvent.click(document.getElementById('edit-rate-line-1') as HTMLElement);

    await vi.waitFor(() => expect(document.getElementById('contract-line-rate'), document.body.textContent ?? '').not.toBeNull());
    const input = document.getElementById('contract-line-rate') as HTMLInputElement;
    expect(input.value).toBe('100.00');
    const wrapper = screen.getByText('Rate').parentElement as HTMLElement;
    expect(wrapper.textContent).toContain('€');

    fireEvent.change(input, { target: { value: '200.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await vi.waitFor(() => expect(updateContractLineRateMock).toHaveBeenCalled());
    expect(updateContractLineRateMock).toHaveBeenCalledWith('template-1', 'line-1', 20000, 'arrears', null);
  });

  it('scales the template rate editor by the template currency own fraction digits (zero-decimal currency)', async () => {
    primeTemplate({ unitRate: 25000, lineRate: 10000, currency: 'JPY' });
    updateContractLineRateMock.mockResolvedValue({});

    renderDetail('USD');

    await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    fireEvent.click(screen.getByRole('button', { name: 'Manage Services' }));
    const badge = await screen.findByText(/Fixed Fee Rate:/);
    expect(badge.textContent).toMatch(/10,000/);
    expect(badge.textContent).toMatch(/¥|JP¥/);
    fireEvent.click(document.getElementById('edit-rate-line-1') as HTMLElement);

    await vi.waitFor(() => expect(document.getElementById('contract-line-rate')).not.toBeNull());
    const input = document.getElementById('contract-line-rate') as HTMLInputElement;
    expect(input.value).toBe('10000');
    fireEvent.change(input, { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await vi.waitFor(() => expect(updateContractLineRateMock).toHaveBeenCalled());
    expect(updateContractLineRateMock).toHaveBeenCalledWith('template-1', 'line-1', 300, 'arrears', null);
  });

  it('summary row shows the template base currency and the basics form has no inline currency input', async () => {
    primeTemplate({ unitRate: 25000 });

    renderDetail();

    await screen.findByTestId(`template-recurring-amount-${SERVICE_ID}`);
    expect(document.getElementById('template-base-currency-badge')).toHaveTextContent('EUR');
    expect(document.getElementById('template-currency-code-inline')).toBeNull();
  });

  it("formats each assignment's PO amount in that assignment's own currency", async () => {
    primeTemplate({ unitRate: 25000 });
    getContractAssignmentsMock.mockResolvedValue([
      {
        client_contract_id: 'cc-1', client_id: 'c-1', client_name: 'Acme GBP', start_date: '2026-01-01',
        end_date: null, is_active: true, po_required: true, po_number: 'PO-1', po_amount: 123400,
        currency_code: 'GBP', tenant: 'tenant-1',
      },
      {
        client_contract_id: 'cc-2', client_id: 'c-2', client_name: 'Beta JPY', start_date: '2026-01-01',
        end_date: null, is_active: true, po_required: true, po_number: 'PO-2', po_amount: 5000,
        currency_code: 'JPY', tenant: 'tenant-1',
      },
    ]);

    renderDetail();

    const gbpRow = (await screen.findByText('Acme GBP')).closest('tr') as HTMLElement;
    const jpyRow = (await screen.findByText('Beta JPY')).closest('tr') as HTMLElement;
    expect(gbpRow.textContent).toContain('£1,234.00');
    expect(gbpRow.textContent).not.toMatch(/[$€]/);
    expect(jpyRow.textContent).toMatch(/¥|JP¥/);
    expect(jpyRow.textContent).not.toMatch(/[$€£]/);
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
