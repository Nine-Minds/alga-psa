/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

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

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useFormatBillingFrequency: () => (value: string) => value,
}));

import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import type { TemplateWizardData } from '../TemplateWizard';
import { TemplateReviewContractStep } from './TemplateReviewContractStep';

function wizardData(unitRate: number | null): TemplateWizardData {
  return {
    contract_name: 'Seat Template',
    description: '',
    billing_frequency: 'monthly',
    cadence_owner: 'client',
    billing_timing: 'arrears',
    enable_proration: false,
    fixed_services: [
      {
        service_id: 'service-seat-1',
        service_name: 'Seat Service',
        quantity: 2,
        pricing_basis: 'unit',
        unit_rate: unitRate,
      },
    ],
    product_services: [],
    hourly_services: [],
    usage_services: [],
  };
}

function renderStep(unitRate: number | null) {
  // Even with a USD tenant default, the template must not claim a currency.
  return render(
    <CurrencyFormatProvider currencyCode="USD">
      <TemplateReviewContractStep data={wizardData(unitRate)} updateData={vi.fn()} />
    </CurrencyFormatProvider>,
  );
}

describe('TemplateReviewContractStep per-seat unit rate', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the default unit rate as a neutral number with no currency symbol', () => {
    renderStep(25000);

    const rateLine = screen.getByText(/Unit rate:/);
    expect(rateLine).toHaveTextContent("Unit rate: 250.00 in the client's currency");
    expect(rateLine.textContent).not.toContain('$');
  });

  it('shows the catalog-price text when no default unit rate is set', () => {
    renderStep(null);

    expect(screen.getByText(/Unit rate:/)).toHaveTextContent(
      "Unit rate: Catalog price in the client's currency",
    );
    expect(screen.queryByText(/250\.00/)).not.toBeInTheDocument();
  });
});
