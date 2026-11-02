/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | { defaultValue?: string }) =>
      typeof opts === 'string' ? opts : (opts?.defaultValue ?? key),
  }),
  useFormatters: () => ({ formatDate: (d: string) => d, formatCalendarDate: (d: string) => d }),
  useOptionalI18n: () => null,
}));
vi.mock('@alga-psa/ui/hooks/useQuoteEnumOptions', () => ({
  useFormatQuoteStatus: () => (s: string) => s,
}));
vi.mock('@alga-psa/ui/editor', () => ({
  QuoteTermsContent: () => null,
  hasQuoteTermsContent: () => false,
}));

import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import { QuoteDocumentView } from './QuoteDocumentView';

afterEach(cleanup);

const quote = {
  quote_id: 'q1',
  quote_number: 'Q-100',
  title: 'Network refresh',
  currency_code: 'EUR',
  status: 'sent' as const,
};
const items = [
  {
    quote_item_id: 'i1',
    quote_id: 'q1',
    description: 'Firewall',
    quantity: 1,
    unit_price: 123456,
    total_price: 123456,
    display_order: 0,
    is_optional: false,
    is_selected: true,
  },
] as any;
const totals = { subtotal: 123456, discountTotal: 0, tax: 0, totalAmount: 123456 };

describe('QuoteDocumentView', () => {
  it('renders from props alone with the quote currency symbol (EUR, not USD)', () => {
    const { container } = render(
      <CurrencyFormatProvider currencyCode="USD" locale="en">
        <QuoteDocumentView quote={quote} items={items} locations={[]} totals={totals} pdfHref="/api/quote/x/pdf" />
      </CurrencyFormatProvider>,
    );
    expect(screen.getByText('Network refresh')).toBeTruthy();
    expect(screen.getByText('Firewall')).toBeTruthy();
    expect(container.textContent).toContain('€');
    expect(container.textContent).not.toContain('$');
    expect(container.querySelector('a[href="/api/quote/x/pdf"]')).toBeTruthy();
  });

  it('renders no switches without onToggle, and slots in order', () => {
    const { container } = render(
      <CurrencyFormatProvider currencyCode="JPY" locale="en">
        <QuoteDocumentView
          quote={{ ...quote, currency_code: 'JPY' }}
          items={items}
          locations={[]}
          totals={totals}
          topSlot={<div id="top">top</div>}
          footerSlot={<div id="foot">foot</div>}
        />
      </CurrencyFormatProvider>,
    );
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.querySelector('#top')).toBeTruthy();
    expect(container.querySelector('#foot')).toBeTruthy();
    expect(container.textContent).toContain('¥');
  });
});
