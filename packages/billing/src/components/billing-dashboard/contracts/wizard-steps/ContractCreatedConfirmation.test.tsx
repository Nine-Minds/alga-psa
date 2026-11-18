// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The post-creation dialog states when each recurring line first invoices.
 * Each sentence names the lines it covers, the products line is included, and
 * lines that share timing and frequency share one sentence.
 */

vi.mock('@alga-psa/billing/actions/billingCycleAnchorActions', () => ({
  getClientBillingCycleAnchor: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) => {
      const template = (options.defaultValue as string) ?? key;
      return template.replace(/{{(\w+)}}/g, (_m, token) => String(options[token] ?? ''));
    },
  }),
  useFormatters: () => ({
    formatDate: (value: Date) =>
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
  }),
}));

const { ContractCreatedConfirmation } = await import('./ContractCreatedConfirmation');

const member = { service_id: 's1', service_name: 'Managed', quantity: 1, pricing_basis: 'bundle' as const };

function data(overrides: Record<string, unknown> = {}): any {
  return {
    client_id: 'client-1',
    contract_name: 'Annual M365',
    billing_frequency: 'annually',
    currency_code: 'USD',
    start_date: '2026-11-01',
    cadence_owner: 'contract',
    billing_timing: 'advance',
    fixed_lines: [],
    product_services: [],
    hourly_services: [{ service_id: 'h1', service_name: 'Support', hourly_rate: 12000 }],
    ...overrides,
  };
}

const fixedLine = (key: string, name: string, extra: Record<string, unknown> = {}) => ({
  line_key: key,
  contract_line_name: name,
  enable_proration: false,
  base_rate: 10000,
  services: [member],
  ...extra,
});

describe('ContractCreatedConfirmation', () => {
  afterEach(() => cleanup());

  it('names each line and gives only the timing that line was created with', () => {
    render(
      <ContractCreatedConfirmation
        data={data({
          fixed_lines: [
            fixedLine('a', 'Managed Security'),
            fixedLine('b', 'Site Maintenance', { billing_timing: 'arrears' }),
          ],
          product_services: [{ service_id: 'p1', service_name: 'M365', quantity: 10 }],
        })}
      />,
    );

    const advance = document.getElementById('contract-wizard-created-first-invoice')!;
    expect(advance.textContent).toContain('Managed Security, Products');
    expect(advance.textContent).toContain('Billed in advance');
    expect(advance.textContent).toContain('2026-11-01');
    expect(advance.textContent).not.toContain('arrears');

    const arrears = document.getElementById('contract-wizard-created-first-invoice-1')!;
    expect(arrears.textContent).toContain('Site Maintenance');
    expect(arrears.textContent).toContain('Billed in arrears');
    expect(arrears.textContent).toContain('2027-11-01');
    expect(arrears.textContent).toContain('nothing to bill for this line.');

    expect(document.getElementById('contract-wizard-created-first-invoice-2')).toBeNull();
  });

  it('covers a products-only contract in advance', () => {
    render(
      <ContractCreatedConfirmation
        data={data({ product_services: [{ service_id: 'p1', service_name: 'M365', quantity: 10 }] })}
      />,
    );

    const notice = document.getElementById('contract-wizard-created-first-invoice')!;
    expect(notice.textContent).toContain('Products');
    expect(notice.textContent).toContain('Billed in advance');
    expect(screen.queryByText(/Billed in arrears/)).toBeNull();
  });

  it('says "these lines" when an arrears sentence covers several lines', () => {
    render(
      <ContractCreatedConfirmation
        data={data({
          billing_timing: 'arrears',
          fixed_lines: [fixedLine('a', 'Managed Security')],
          product_services: [{ service_id: 'p1', service_name: 'M365', quantity: 10 }],
        })}
      />,
    );

    expect(screen.getByText('Managed Security, Products')).toBeTruthy();
    expect(screen.getByText(/nothing to bill for these lines\./)).toBeTruthy();
  });
});
