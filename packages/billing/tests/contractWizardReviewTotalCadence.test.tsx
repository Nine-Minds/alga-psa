// @vitest-environment jsdom
/**
 * Wizard Review total: the amount is shown in the cadence the contract bills
 * (annual contracts read "per year" with a monthly equivalent), mixed contracts
 * list one row per frequency, and the monthly figure never drifts from the
 * legacy per-line "normalize, then sum" total.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, opts?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
    if (typeof opts === 'string') return opts;
    const base = typeof opts?.defaultValue === 'string' ? opts.defaultValue : key;
    return base.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String((opts as Record<string, unknown>)?.[name] ?? ''));
  };
  return {
    useTranslation: () => ({ t }),
    useOptionalI18n: () => ({ locale: 'en' }),
    useFormatters: () => ({
      formatDate: (value: unknown) => String(value),
      formatCurrency: (value: number, currency: string) =>
        new Intl.NumberFormat('en-AU', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
          .format(value)
          .replace('$', currency === 'AUD' ? 'A$' : '$'),
      formatNumber: (value: unknown) => String(value),
      formatRelativeTime: (value: unknown) => String(value),
    }),
  };
});

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getClientByIdForBilling: vi.fn(async () => ({ client_name: 'Cool Cars' })),
}));
vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  getClientBillingProfilesForBilling: vi.fn(async () => []),
}));
vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServiceCatalogRatesForCurrency: vi.fn(async () => ({ m365: 16098, defender: 18000, backup: 9000 })),
  getServiceCatalogCostInfo: vi.fn(async () => ({ canViewCost: false, items: {} })),
}));

import type { ContractWizardData } from '../src/components/billing-dashboard/contracts/ContractWizard';
import { ReviewContractStep } from '../src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep';

const build = (overrides: Partial<ContractWizardData> = {}): ContractWizardData =>
  ({
    client_id: 'client-1',
    contract_name: 'Licensing',
    start_date: '2026-09-01',
    billing_frequency: 'monthly',
    currency_code: 'AUD',
    fixed_lines: [],
    product_services: [],
    hourly_services: [],
    usage_services: [],
    enable_proration: true,
    ...overrides,
  }) as ContractWizardData;

// 4 × 160.98 + 4 × 180.00 + 4 × 90.00 = 1,723.92
const lyndasProducts = [
  { service_id: 'm365', quantity: 4, currency_rate: 16098 },
  { service_id: 'defender', quantity: 4, currency_rate: 18000 },
  { service_id: 'backup', quantity: 4, currency_rate: 9000 },
];

const fixedLine = (billing_frequency: string | undefined, unit_rate: number, quantity = 1): any => ({
  line_key: `line-${billing_frequency}-${unit_rate}`,
  contract_line_name: 'Managed services',
  enable_proration: true,
  base_rate: null,
  billing_frequency,
  services: [{ service_id: 'svc', service_name: 'Seat', pricing_basis: 'unit', quantity, unit_rate }],
});

describe('Review step total cadence', () => {
  afterEach(cleanup);

  it('annual AUD products-only: headline is the annual amount with a monthly equivalent', async () => {
    render(<ReviewContractStep data={build({ billing_frequency: 'annually', product_services: lyndasProducts })} />);
    expect(await screen.findByText('A$1,723.92')).toBeInTheDocument();
    expect(screen.getByText('per year')).toBeInTheDocument();
    expect(screen.getByText('about A$143.66 a month')).toBeInTheDocument();
    expect(screen.getByText('Estimated Total')).toBeInTheDocument();
    expect(screen.queryByText('per month')).not.toBeInTheDocument();
  });

  it('mixed monthly fixed + annual products: one row per frequency and the legacy monthly total', async () => {
    render(
      <ReviewContractStep
        data={build({
          billing_frequency: 'annually',
          fixed_lines: [fixedLine('monthly', 45000)],
          product_services: lyndasProducts,
        })}
      />,
    );
    expect(await screen.findByText('about A$593.66 a month')).toBeInTheDocument();
    expect(screen.getByTestId('review-total-row-monthly')).toHaveTextContent('A$450.00 per month');
    expect(screen.getByTestId('review-total-row-annually')).toHaveTextContent('A$1,723.92 per year');
    // legacy calculateTotalMonthly: 45000 + round(172392 / 12) = 59366
    expect(screen.getByText('about A$593.66 a month')).toBeInTheDocument();
    expect(screen.getByText('Estimated Total by Billing Frequency')).toBeInTheDocument();
  });

  it('monthly-only contract renders as before', () => {
    render(<ReviewContractStep data={build({ fixed_lines: [fixedLine(undefined, 45000)] })} />);
    expect(screen.getByText('Estimated Monthly Total')).toBeInTheDocument();
    expect(screen.getByText('A$450.00')).toBeInTheDocument();
    expect(screen.getByText('per month')).toBeInTheDocument();
    expect(screen.queryByText(/a month$/)).not.toBeInTheDocument();
  });

  it('saved draft value keeps saying per month on an annual contract', async () => {
    render(
      <ReviewContractStep
        data={build({
          billing_frequency: 'annually',
          product_services: lyndasProducts,
          recurring_baseline: { monthly_cents: 14366 },
        })}
      />,
    );
    await screen.findByText('per year');
    expect(document.getElementById('review-saved-draft-value')).toHaveTextContent(
      'Saved draft value: A$143.66 per month',
    );
    expect(screen.getByText('per year')).toBeInTheDocument();
  });

  it('saved draft value on a monthly contract reads as before (the headline already says per month)', () => {
    render(
      <ReviewContractStep
        data={build({ fixed_lines: [fixedLine(undefined, 45000)], recurring_baseline: { monthly_cents: 45000 } })}
      />,
    );
    expect(document.getElementById('review-saved-draft-value')).toHaveTextContent(/^Saved draft value: A\$450\.00$/);
  });

  it('a line on its own stored semi_annually cadence is shown per half-year', () => {
    render(<ReviewContractStep data={build({ fixed_lines: [fixedLine('semi_annually', 60000)] })} />);
    expect(screen.getByText('A$600.00')).toBeInTheDocument();
    expect(screen.getByText('per half-year')).toBeInTheDocument();
    expect(screen.getByText('about A$100.00 a month')).toBeInTheDocument();
  });
});
