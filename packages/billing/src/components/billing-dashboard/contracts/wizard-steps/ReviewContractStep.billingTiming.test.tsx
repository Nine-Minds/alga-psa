// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Review step: every line shows the timing it will be created with, resolved by the same
 * resolveEffectiveBillingTiming the server uses. Inherited values are marked "(contract default)";
 * hourly and usage lines are always "In arrears" and never marked inherited.
 */

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getClientByIdForBilling: vi.fn(async () => ({ client_name: 'Example Client' })),
}));
vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  getClientBillingProfilesForBilling: vi.fn(async () => []),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/billing/hooks/useBillingEnumOptions')>()),
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
  useFormatBillingFrequency: () => (value: string) => value,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) => {
      const template = (options.defaultValue as string) ?? key;
      return template.replace(/{{(\w+)}}/g, (_m, token) => String(options[token] ?? ''));
    },
  }),
  useFormatters: () => ({
    formatCurrency: (value: number, currency: string) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value),
    formatNumber: (value: number) => String(value),
    formatDate: (value: Date) => value.toISOString().slice(0, 10),
  }),
}));

const { ReviewContractStep } = await import('./ReviewContractStep');

const member = { service_id: 's1', service_name: 'Managed', quantity: 1, pricing_basis: 'bundle' as const };

function renderStep(overrides: Record<string, unknown> = {}, lineOverrides: Array<Record<string, unknown>> = [{}]) {
  const data: any = {
    client_id: 'client-1',
    contract_name: 'Timing Contract',
    billing_frequency: 'annual',
    currency_code: 'USD',
    start_date: '2026-01-01',
    cadence_owner: 'contract',
    billing_timing: 'advance',
    fixed_lines: lineOverrides.map((o, i) => ({
      line_key: `l${i}`, enable_proration: false, base_rate: 10000, services: [member], ...o,
    })),
    product_services: [{ service_id: 'p1', service_name: 'Licence', quantity: 1 }],
    hourly_services: [{ service_id: 'h1', service_name: 'Support', hourly_rate: 12000 }],
    usage_services: [{ service_id: 'u1', service_name: 'Storage', unit_rate: 100 }],
    ...overrides,
  };
  return render(<ReviewContractStep data={data} />);
}

const text = (id: string) => document.getElementById(id)?.textContent ?? '';
const allText = () => document.body.textContent ?? '';

describe('ReviewContractStep billing timing', () => {
  afterEach(() => cleanup());

  it('shows inherited advance with the contract-default marker on fixed and products lines', () => {
    renderStep();
    expect(allText()).toContain('In advance (contract default)');
    expect(text('contract-wizard-review-products-timing')).toContain('In advance (contract default)');
  });

  it('an explicit override shows without the marker, and the products override is honoured', () => {
    renderStep({ product_billing_timing: 'arrears' }, [{ billing_timing: 'arrears' }, {}]);
    expect(text('contract-wizard-review-products-timing')).toContain('In arrears');
    expect(text('contract-wizard-review-products-timing')).not.toContain('contract default');
    expect(allText()).toContain('In arrears');
    expect(allText()).toContain('In advance (contract default)');
    expect(allText()).not.toContain('In arrears (contract default)');
  });

  it('the products line states its own first invoice, following its resolved timing', () => {
    renderStep({ fixed_lines: [], billing_frequency: 'annually' });
    expect(text('contract-wizard-review-products-first-invoice')).toContain('Billed in advance');
    expect(text('contract-wizard-review-products-first-invoice')).toContain('2026-01-01');
    cleanup();
    renderStep({ fixed_lines: [], billing_frequency: 'annually', product_billing_timing: 'arrears' });
    expect(text('contract-wizard-review-products-first-invoice')).toContain('Billed in arrears');
  });

  it('hourly and usage lines are In arrears under an advance default, never marked inherited', () => {
    renderStep();
    expect(text('contract-wizard-review-hourly-timing')).toContain('In arrears');
    expect(text('contract-wizard-review-hourly-timing')).not.toContain('contract default');
    expect(text('contract-wizard-review-usage-timing')).toContain('In arrears');
    expect(text('contract-wizard-review-usage-timing')).not.toContain('contract default');
  });
});
