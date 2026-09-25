// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A manual invoice raised against a specific billing profile has to say so once
 * it is a draft. Picking the profile at generation time and then finding a draft
 * that names no profile leaves an operator unable to tell whether the pick took
 * — and the only way to check would be to finalize and send it.
 *
 * The row obeys the same invisibility rule as every other profile surface: a
 * client with one profile had no choice to make, so it sees nothing.
 */

vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({
  updateDraftInvoiceProperties: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({ money: (value: number) => `$${(value / 100).toFixed(2)}` }),
}));
// The date pickers reach for the app's i18n provider; this card's subject is
// the profile row, not date entry.
vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id }: { id: string }) => <input id={id} readOnly />,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.defaultValue as string) ?? key,
  }),
}));

const DraftInvoiceDetailsCard = (await import('./DraftInvoiceDetailsCard')).default;

const invoice = (overrides: Record<string, unknown> = {}) => ({
  invoice_id: 'invoice-1',
  invoice_number: 'INV001012',
  status: 'draft',
  total_amount: 10000,
  currencyCode: 'USD',
  client: { name: 'Northstar Dental Group', logo: '', address: '' },
  invoice_date: '2026-09-25',
  due_date: '2026-10-25',
  ...overrides,
}) as any;

describe('draft invoice details — the profile it bills', () => {
  afterEach(() => {
    cleanup();
  });

  it('names the profile the draft was raised against', () => {
    render(
      <DraftInvoiceDetailsCard
        invoice={invoice({
          billing_profile_name: '12345',
          client_has_multiple_billing_profiles: true,
        })}
      />,
    );

    expect(screen.getByText('Billing Profile')).toBeTruthy();
    expect(screen.getByText('12345')).toBeTruthy();
  });

  it('falls back to naming the client default when the draft carries no profile', () => {
    render(
      <DraftInvoiceDetailsCard
        invoice={invoice({
          billing_profile_name: null,
          client_has_multiple_billing_profiles: true,
        })}
      />,
    );

    expect(screen.getByText("The client's default profile")).toBeTruthy();
  });

  it('shows no profile row for a client that holds a single profile', () => {
    render(
      <DraftInvoiceDetailsCard
        invoice={invoice({
          billing_profile_name: 'Northstar Dental Group',
          client_has_multiple_billing_profiles: false,
        })}
      />,
    );

    expect(screen.queryByText('Billing Profile')).toBeNull();
  });
});
